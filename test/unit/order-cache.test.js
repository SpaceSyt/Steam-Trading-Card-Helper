import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// order-cache imports runtime state; these harmless globals keep that module browser-compatible in Node.
globalThis.GM_getValue = () => null;
globalThis.GM_setValue = () => {};
globalThis.window = {};
globalThis.unsafeWindow = {};

const {
  createOrderCacheEnvelope,
  decodeOrderCache,
  replaceOrderCachePartition,
} = await import("../../src/services/order-cache.js");

const legacyStorage = JSON.parse(readFileSync(
  new URL("../fixtures-public/cache/v2.0.5-storage.json", import.meta.url),
  "utf8"
));
const [legacyItem] = legacyStorage.orderCache;

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
});

test("corrupt cache is diagnosed without treating it as a migration", () => {
  const raw = "{not-json";
  const decoded = decodeOrderCache(raw);

  assert.equal(decoded.corrupt, true);
  assert.equal(decoded.migrated, false);
  assert.equal(decoded.raw, raw);
  assert.ok(decoded.error instanceof Error);
});
