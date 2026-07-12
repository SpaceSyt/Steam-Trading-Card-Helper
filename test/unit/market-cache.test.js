import assert from "node:assert/strict";
import test from "node:test";

import {
  MARKET_DATA_SCHEMA_VERSION,
  MARKET_DATA_SOURCES,
} from "../../src/services/market-data.js";
import {
  MARKET_CACHE_SCHEMA_VERSION,
  createMarketCacheEnvelope,
  decodeMarketCache,
  findMarketCache,
  getMarketCacheKey,
  loadMarketCache,
  normalizeMarketCache,
  pruneMarketCache,
  saveMarketCache,
  upsertMarketCache,
  upsertStoredMarketCache,
} from "../../src/services/market-cache.js";

function makeRecord(overrides = {}) {
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    appid: "753",
    marketHashName: "570-Test Synthetic Card",
    currencyId: 23,
    currencyCode: "CNY",
    lowestSellMinor: 32,
    medianMinor: 35,
    highestBuyMinor: null,
    volume: 100,
    observedAt: 1_000,
    source: MARKET_DATA_SOURCES.PRICE_OVERVIEW,
    ...overrides,
  };
}

test("same item CNY and USD records remain isolated in cache", () => {
  const cny = makeRecord();
  const usd = makeRecord({
    currencyId: 1,
    currencyCode: "USD",
    lowestSellMinor: 3,
    medianMinor: 4,
  });

  assert.notEqual(getMarketCacheKey(cny), getMarketCacheKey(usd));

  const cache = upsertMarketCache(upsertMarketCache(createMarketCacheEnvelope(), cny), usd);
  assert.equal(cache.records.length, 2);
  assert.equal(findMarketCache(cache, cny).lowestSellMinor, 32);
  assert.equal(findMarketCache(cache, usd).lowestSellMinor, 3);
  assert.equal(findMarketCache(cache, { ...cny, currencyId: 3 }), null);
});

test("cache key also isolates source and appid", () => {
  const overview = makeRecord();
  const histogram = makeRecord({
    source: MARKET_DATA_SOURCES.ITEM_ORDERS_HISTOGRAM,
    highestBuyMinor: 29,
  });
  const otherApp = makeRecord({ appid: "440" });

  const cache = [overview, histogram, otherApp].reduce(
    (current, record) => upsertMarketCache(current, record),
    createMarketCacheEnvelope()
  );

  assert.equal(cache.records.length, 3);
  assert.equal(findMarketCache(cache, histogram).highestBuyMinor, 29);
  assert.equal(findMarketCache(cache, { ...histogram, source: "missing" }), null);
});

test("upsert is immutable and keeps the newest observation by default", () => {
  const original = createMarketCacheEnvelope([makeRecord({ observedAt: 2_000 })]);
  const snapshot = structuredClone(original);
  const ignoredOlder = upsertMarketCache(original, makeRecord({ observedAt: 1_000, lowestSellMinor: 10 }));
  const updated = upsertMarketCache(original, makeRecord({ observedAt: 3_000, lowestSellMinor: 40 }));

  assert.deepEqual(original, snapshot);
  assert.deepEqual(ignoredOlder, original);
  assert.equal(updated.records[0].lowestSellMinor, 40);
  assert.equal(original.records[0].lowestSellMinor, 32);
});

test("prune applies TTL first and then retains newest entries up to the limit", () => {
  const cache = normalizeMarketCache({
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records: [
      makeRecord({ marketHashName: "expired", observedAt: 400 }),
      makeRecord({ marketHashName: "new-a", observedAt: 900 }),
      makeRecord({ marketHashName: "older-b", observedAt: 700 }),
      makeRecord({ marketHashName: "new-c", observedAt: 950 }),
    ],
  });
  const snapshot = structuredClone(cache);
  const pruned = pruneMarketCache(cache, {
    now: 1_000,
    ttlMs: 500,
    maxEntries: 2,
  });

  assert.deepEqual(cache, snapshot);
  assert.deepEqual(pruned.records.map(record => record.marketHashName), ["new-a", "new-c"]);
  assert.equal(findMarketCache(cache, makeRecord({ marketHashName: "expired" }), {
    now: 1_000,
    ttlMs: 500,
  }), null);
});

test("decode reports malformed JSON without manufacturing an empty success", () => {
  const decoded = decodeMarketCache("{ definitely-not-json");

  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope, null);
  assert.equal(decoded.diagnostics[0].code, "invalid-json");
});

test("decode reports invalid records and does not silently make them cacheable", () => {
  const decoded = decodeMarketCache(JSON.stringify({
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records: [
      makeRecord(),
      makeRecord({ currencyId: null, marketHashName: "unknown-currency" }),
    ],
  }));

  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope.records.length, 1);
  assert.equal(decoded.diagnostics[0].code, "invalid-records-dropped");
});

test("decode diagnoses unsupported record schemas", () => {
  const decoded = decodeMarketCache({
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records: [makeRecord({ schemaVersion: 99 })],
  });

  assert.equal(decoded.ok, false);
  assert.equal(decoded.envelope.records.length, 0);
  assert.equal(decoded.diagnostics[0].code, "unsupported-record-schema");
});

test("legacy array envelope migrates in memory and is not rewritten by decode", () => {
  const raw = JSON.stringify([makeRecord()]);
  const decoded = decodeMarketCache(raw);

  assert.equal(decoded.ok, true);
  assert.equal(decoded.needsMigration, true);
  assert.equal(decoded.envelope.schemaVersion, MARKET_CACHE_SCHEMA_VERSION);
  assert.equal(decoded.envelope.records.length, 1);
  assert.equal(decoded.diagnostics[0].code, "legacy-array-envelope");
});

test("GM wrappers round-trip a canonical envelope", () => {
  const store = new Map();
  const storageKey = "test-market-cache";
  const setValue = (key, value) => store.set(key, value);
  const getValue = (key, fallback) => store.has(key) ? store.get(key) : fallback;
  const cache = createMarketCacheEnvelope([makeRecord()]);

  const saved = saveMarketCache(cache, { storageKey, setValue });
  const loaded = loadMarketCache({ storageKey, getValue });

  assert.equal(saved.ok, true);
  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.envelope, cache);
  assert.equal(loaded.raw, store.get(storageKey));
});

test("safe stored upsert refuses to overwrite corrupt raw GM data", () => {
  const raw = "{ corrupt-cache";
  let writeCount = 0;
  let storedValue = raw;
  const result = upsertStoredMarketCache(makeRecord(), {
    getValue: () => storedValue,
    setValue: (_key, value) => {
      writeCount += 1;
      storedValue = value;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.saved, false);
  assert.equal(result.raw, raw);
  assert.equal(result.diagnostics[0].code, "invalid-json");
  assert.equal(writeCount, 0);
  assert.equal(storedValue, raw);
});

test("cache refuses records without a known currency id", () => {
  assert.throws(
    () => upsertMarketCache(createMarketCacheEnvelope(), makeRecord({ currencyId: null })),
    /currencyId/
  );
});
