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
  upsertManyMarketCache,
  upsertManyStoredMarketCache,
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
  const legacySource = makeRecord({
    source: "legacy-source",
    highestBuyMinor: 29,
  });
  const otherApp = makeRecord({ appid: "440" });

  const cache = [overview, legacySource, otherApp].reduce(
    (current, record) => upsertMarketCache(current, record),
    createMarketCacheEnvelope()
  );

  assert.equal(cache.records.length, 3);
  assert.equal(findMarketCache(cache, legacySource).highestBuyMinor, 29);
  assert.equal(findMarketCache(cache, { ...legacySource, source: "missing" }), null);
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

test("bulk upsert is equivalent to sequential updates without mutating its input", () => {
  const original = createMarketCacheEnvelope([
    makeRecord({ marketHashName: "existing", observedAt: 100, lowestSellMinor: 10 }),
    makeRecord({ marketHashName: "untouched", observedAt: 150, lowestSellMinor: 15 }),
  ]);
  const snapshot = structuredClone(original);
  const updates = [
    makeRecord({ marketHashName: "existing", observedAt: 90, lowestSellMinor: 9 }),
    makeRecord({ marketHashName: "new", observedAt: 200, lowestSellMinor: 20 }),
    makeRecord({ marketHashName: "existing", observedAt: 300, lowestSellMinor: 30 }),
    makeRecord({ marketHashName: "new", observedAt: 200, lowestSellMinor: 21 }),
  ];
  const expected = updates.reduce(
    (cache, record) => upsertMarketCache(cache, record),
    original
  );

  const actual = upsertManyMarketCache(original, updates);

  assert.deepEqual(actual, expected);
  assert.deepEqual(original, snapshot);
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

test("single-entry overflow evicts the same oldest record while preserving order", () => {
  const cache = createMarketCacheEnvelope([
    makeRecord({ marketHashName: "old-first", observedAt: 100 }),
    makeRecord({ marketHashName: "old-second", observedAt: 100 }),
    makeRecord({ marketHashName: "latest", observedAt: 200 }),
  ]);

  const pruned = pruneMarketCache(cache, { ttlMs: Infinity, maxEntries: 2 });

  assert.deepEqual(
    pruned.records.map(record => record.marketHashName),
    ["old-second", "latest"]
  );
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

test("stored upsert reads and writes once while pruning a canonical envelope", () => {
  let readCount = 0;
  let writeCount = 0;
  let storedValue = JSON.stringify(createMarketCacheEnvelope([
    makeRecord({ marketHashName: "old", observedAt: 100 }),
    makeRecord({ marketHashName: "current", observedAt: 200 }),
  ]));

  const result = upsertStoredMarketCache(
    makeRecord({ marketHashName: "new", observedAt: 300 }),
    {
      ttlMs: Infinity,
      maxEntries: 2,
      getValue: () => {
        readCount += 1;
        return storedValue;
      },
      setValue: (_key, value) => {
        writeCount += 1;
        storedValue = value;
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(readCount, 1);
  assert.equal(writeCount, 1);
  assert.deepEqual(
    JSON.parse(storedValue).records.map(record => record.marketHashName),
    ["current", "new"]
  );
});

test("stored bulk upsert persists multiple observations in one transaction", () => {
  let readCount = 0;
  let writeCount = 0;
  const initial = createMarketCacheEnvelope([
    makeRecord({ marketHashName: "existing", observedAt: 100 }),
    makeRecord({ marketHashName: "current", observedAt: 200 }),
  ]);
  let storedValue = JSON.stringify(initial);
  const updates = [
    makeRecord({ marketHashName: "new", observedAt: 300 }),
    makeRecord({ marketHashName: "existing", observedAt: 400, lowestSellMinor: 20 }),
  ];
  const options = { ttlMs: Infinity, maxEntries: 2 };
  const expected = updates.reduce(
    (cache, record) => pruneMarketCache(upsertMarketCache(cache, record), options),
    initial
  );

  const result = upsertManyStoredMarketCache(updates, {
    ...options,
    getValue: () => {
      readCount += 1;
      return storedValue;
    },
    setValue: (_key, value) => {
      writeCount += 1;
      storedValue = value;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.saved, true);
  assert.equal(readCount, 1);
  assert.equal(writeCount, 1);
  const records = JSON.parse(storedValue).records;
  assert.deepEqual(records, expected.records);
  assert.deepEqual(records.map(record => record.marketHashName), ["new", "existing"]);
});

test("stored bulk upsert preserves order on the below-capacity fast path", () => {
  const initial = createMarketCacheEnvelope([
    makeRecord({ marketHashName: "existing", observedAt: 100 }),
    makeRecord({ marketHashName: "untouched", observedAt: 150 }),
  ]);
  let storedValue = JSON.stringify(initial);
  const updates = [
    makeRecord({ marketHashName: "new", observedAt: 200 }),
    makeRecord({ marketHashName: "existing", observedAt: 300, lowestSellMinor: 30 }),
  ];

  const result = upsertManyStoredMarketCache(updates, {
    ttlMs: Infinity,
    maxEntries: 10,
    getValue: () => storedValue,
    setValue: (_key, value) => { storedValue = value; },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    JSON.parse(storedValue).records.map(record => [record.marketHashName, record.lowestSellMinor]),
    [["existing", 30], ["untouched", 32], ["new", 32]]
  );
});

test("cache refuses records without a known currency id", () => {
  assert.throws(
    () => upsertMarketCache(createMarketCacheEnvelope(), makeRecord({ currencyId: null })),
    /currencyId/
  );
});
