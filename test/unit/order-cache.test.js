import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// order-cache imports runtime state; these harmless globals keep that module browser-compatible in Node.
const defaultGMGetValue = () => null;
const defaultGMSetValue = () => {};
globalThis.GM_getValue = defaultGMGetValue;
globalThis.GM_setValue = defaultGMSetValue;
globalThis.window = {};
globalThis.unsafeWindow = {};

const { state } = await import("../../src/state.js");
const {
  createOrderCacheEnvelope,
  decodeOrderCache,
  getCachedOrderResult,
  normalizeOrderResult,
  replaceOrderCachePartition,
  upsertOrderResult,
} = await import("../../src/services/order-cache.js");

const originalState = {
  cfg: state.cfg,
  currencyContext: state.currencyContext,
  orderResults: state.orderResults,
  selectedOrderResults: state.selectedOrderResults,
};

afterEach(() => {
  globalThis.GM_getValue = defaultGMGetValue;
  globalThis.GM_setValue = defaultGMSetValue;
  state.cfg = originalState.cfg;
  state.currencyContext = originalState.currencyContext;
  state.orderResults = originalState.orderResults;
  state.selectedOrderResults = originalState.selectedOrderResults;
});

const legacyStorage = JSON.parse(readFileSync(
  new URL("../fixtures-public/cache/v2.0.5-storage.json", import.meta.url),
  "utf8"
));
const [legacyItem] = legacyStorage.orderCache;

function makeOrderResult(appid, overrides = {}) {
  const cachedAt = overrides.cachedAt ?? Date.now();
  return normalizeOrderResult({
    appid,
    gameName: `Game ${appid}`,
    isFoil: false,
    level: 0,
    cards: [],
    cardPrices: [],
    cachedAt,
    ...overrides,
  }, cachedAt, overrides.currencyId ?? 23);
}

test("legacy v2.0 order cache migrates losslessly into the CNY partition", () => {
  const decoded = decodeOrderCache(JSON.stringify(legacyStorage.orderCache), { now: 1700000001000 });

  assert.equal(decoded.corrupt, false);
  assert.equal(decoded.migrated, true);
  const [migrated] = decoded.envelope.partitions["23"].items;
  assert.equal(migrated.appid, legacyItem.appid);
  assert.equal(migrated.gameName, legacyItem.gameName);
  assert.deepEqual(migrated.cards, legacyItem.cards);
  assert.deepEqual(migrated.cardPrices, legacyItem.cardPrices);
  assert.equal(migrated.currencyId, 23);

  const decodedAgain = decodeOrderCache(JSON.stringify(decoded.envelope));
  assert.equal(decodedAgain.corrupt, false);
  assert.equal(decodedAgain.migrated, false);
  assert.deepEqual(decodedAgain.envelope, decoded.envelope);
});

test("replacing a USD partition preserves the CNY order results", () => {
  const cnyEnvelope = replaceOrderCachePartition(
    createOrderCacheEnvelope(1700000000000),
    23,
    [legacyItem],
    1700000000000
  );
  const cnySnapshot = structuredClone(cnyEnvelope);
  const usdEnvelope = replaceOrderCachePartition(
    cnyEnvelope,
    1,
    [{ ...legacyItem, cheapestSetCostCents: 9 }],
    1700000002000
  );

  assert.equal(usdEnvelope.partitions["23"].items[0].cheapestSetCostCents, 12);
  assert.equal(usdEnvelope.partitions["1"].items[0].cheapestSetCostCents, 9);
  assert.equal(usdEnvelope.partitions["23"].items[0].currencyId, 23);
  assert.equal(usdEnvelope.partitions["1"].items[0].currencyId, 1);
  assert.deepEqual(cnyEnvelope, cnySnapshot);
});

test("incomplete prices remain unavailable after order-cache normalization", () => {
  const normalized = makeOrderResult("456", {
    hasIncompletePricing: true,
    cheapestSetCostCents: null,
    fullSetCostCents: 50,
    level5CostCents: 100,
  });

  assert.equal(normalized.hasIncompletePricing, true);
  assert.equal(normalized.cheapestSetCostCents, null);
  assert.equal(normalized.fullSetCostCents, null);
  assert.equal(normalized.level5CostCents, null);
  assert.equal(normalized.cheapestSetFormatted, "-");
  assert.equal(normalized.fullSetFormatted, "-");
  assert.equal(normalized.level5Formatted, "-");
});

test("corrupt cache is diagnosed without treating it as a migration", () => {
  const raw = "{not-json";
  const decoded = decodeOrderCache(raw);

  assert.equal(decoded.corrupt, true);
  assert.equal(decoded.migrated, false);
  assert.equal(decoded.raw, raw);
  assert.ok(decoded.error instanceof Error);
});

test("runtime lookup keeps first-match semantics while pruning only the active partition", () => {
  const now = Date.now();
  const first = makeOrderResult("10", { gameName: "first", cachedAt: now });
  const duplicate = makeOrderResult("10", { gameName: "second", cachedAt: now });
  const expired = makeOrderResult("99", { cachedAt: now - 10 * 86400000 });
  const usd = makeOrderResult("20", { currencyId: 1, cachedAt: now });

  let envelope = replaceOrderCachePartition(
    createOrderCacheEnvelope(now),
    23,
    [first, duplicate, expired],
    now
  );
  envelope = replaceOrderCachePartition(envelope, 1, [usd], now);
  let stored = JSON.stringify(envelope);
  let writeCount = 0;
  globalThis.GM_getValue = () => stored;
  globalThis.GM_setValue = (_key, value) => {
    writeCount += 1;
    stored = value;
  };
  state.cfg = { ...state.cfg, currencyId: 23, orderCacheDays: 3 };
  state.currencyContext = { currencyId: 23 };
  state.orderResults = [first, duplicate, expired];
  state.selectedOrderResults = new Set(["10_0", "99_0"]);

  const found = getCachedOrderResult({ appid: "10", isFoil: false });

  assert.equal(found.gameName, "first");
  assert.deepEqual(state.orderResults.map(item => item.gameName), ["first", "second"]);
  assert.deepEqual([...state.selectedOrderResults], ["10_0"]);
  assert.equal(writeCount, 1);
  const persisted = decodeOrderCache(stored).envelope;
  assert.deepEqual(
    persisted.partitions["23"].items.map(item => item.gameName),
    ["first", "second"]
  );
  assert.equal(persisted.partitions["1"].items[0].appid, "20");
});

test("runtime upsert replaces the first matching result and preserves other partitions", () => {
  const now = Date.now();
  const first = makeOrderResult("10", { gameName: "first", cachedAt: now });
  const duplicate = makeOrderResult("10", { gameName: "second", cachedAt: now });
  const usd = makeOrderResult("20", { currencyId: 1, cachedAt: now });
  let envelope = replaceOrderCachePartition(
    createOrderCacheEnvelope(now),
    23,
    [first, duplicate],
    now
  );
  envelope = replaceOrderCachePartition(envelope, 1, [usd], now);
  let stored = JSON.stringify(envelope);
  let writeCount = 0;
  globalThis.GM_getValue = () => stored;
  globalThis.GM_setValue = (_key, value) => {
    writeCount += 1;
    stored = value;
  };
  state.cfg = { ...state.cfg, currencyId: 23, orderCacheDays: 3 };
  state.currencyContext = { currencyId: 23 };
  state.orderResults = [first, duplicate];
  state.selectedOrderResults = new Set();

  upsertOrderResult(
    { ...first, gameName: "updated" },
    { cachedAt: now + 1, select: true }
  );

  assert.deepEqual(state.orderResults.map(item => item.gameName), ["updated", "second"]);
  assert.deepEqual([...state.selectedOrderResults], ["10_0"]);
  assert.equal(writeCount, 1);
  const persisted = decodeOrderCache(stored).envelope;
  assert.deepEqual(
    persisted.partitions["23"].items.map(item => item.gameName),
    ["updated", "second"]
  );
  assert.equal(persisted.partitions["1"].items[0].appid, "20");
});

test("runtime upsert can defer persistence for a batch checkpoint", () => {
  const now = Date.now();
  let writeCount = 0;
  globalThis.GM_getValue = () => JSON.stringify(createOrderCacheEnvelope(now));
  globalThis.GM_setValue = () => { writeCount += 1; };
  state.cfg = { ...state.cfg, currencyId: 23, orderCacheDays: 3 };
  state.currencyContext = { currencyId: 23 };
  state.orderResults = [];
  state.selectedOrderResults = new Set();

  const inserted = upsertOrderResult(makeOrderResult("10", { cachedAt: now }), {
    persist: false,
  });

  assert.equal(inserted.appid, "10");
  assert.equal(state.orderResults.length, 1);
  assert.equal(writeCount, 0);
});
