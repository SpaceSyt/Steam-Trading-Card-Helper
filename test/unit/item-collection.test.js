import test, { afterEach } from "node:test";
import assert from "node:assert/strict";

const values = new Map();
globalThis.GM_getValue = (key, fallback) => values.has(key) ? values.get(key) : fallback;
globalThis.GM_setValue = (key, value) => values.set(key, value);
globalThis.window = {};
globalThis.unsafeWindow = {};

const { state } = await import("../../src/state.js");
const {
  ITEM_COLLECTION_STORAGE_KEY,
  addItemCollectionEntries,
  decodeItemCollection,
  getItemCollectionKey,
  isItemCollected,
  loadItemCollection,
  normalizeItemCollectionEntry,
  removeItemCollectionEntries,
} = await import("../../src/services/item-collection.js");

afterEach(() => {
  values.clear();
  state.itemCollectionItems = [];
  state.selectedItemCollection = new Set();
  state.itemCollectionHealthy = true;
});

function makeCard(overrides = {}) {
  return {
    category: "card",
    appid: "440",
    marketHashName: "440-Test Card",
    itemName: "Test Card",
    gameName: "Team Fortress 2",
    addedAt: 1_700_000_000_000,
    ...overrides,
  };
}

test("collection identity protects an item type without depending on asset ids", () => {
  const left = getItemCollectionKey(makeCard({ assets: [{ assetid: "1" }] }));
  const right = getItemCollectionKey(makeCard({ assets: [{ assetid: "2" }] }));
  const background = getItemCollectionKey(makeCard({ category: "background" }));

  assert.equal(left, right);
  assert.notEqual(left, background);
});

test("non-marketable community items can use their stable class description key", () => {
  const item = normalizeItemCollectionEntry({
    category: "emoticon",
    appid: "730",
    descriptionKey: "123_0",
    itemName: ":test:",
  }, 1234);

  assert.ok(item);
  assert.equal(item.addedAt, 1234);
  assert.match(item.key, /class/);
  assert.ok(normalizeItemCollectionEntry({
    category: "background",
    descriptionKey: "456_0",
    itemName: "Points Shop Background",
  }));
});

test("collection decoding rejects corrupt and unsupported storage", () => {
  assert.equal(decodeItemCollection("{").ok, false);
  assert.equal(decodeItemCollection(JSON.stringify({ schemaVersion: 2, items: [] })).ok, false);
  assert.deepEqual(decodeItemCollection(null).items, []);
});

test("stored collection entries round-trip, deduplicate, and remain protected", () => {
  loadItemCollection();
  const first = addItemCollectionEntries([makeCard(), makeCard({ itemName: "Updated" })]);

  assert.deepEqual(first, { ok: true, added: 1, total: 1 });
  assert.equal(state.itemCollectionItems[0].itemName, "Updated");
  assert.equal(state.itemCollectionItems[0].addedAt, 1_700_000_000_000);
  assert.equal(isItemCollected(makeCard()), true);

  state.itemCollectionItems = [];
  loadItemCollection();
  assert.equal(state.itemCollectionItems.length, 1);
  assert.equal(isItemCollected(makeCard()), true);
});

test("removal is key-based and corrupt storage fails closed", () => {
  loadItemCollection();
  addItemCollectionEntries([
    makeCard(),
    makeCard({ marketHashName: "440-Other Card", itemName: "Other" }),
  ]);
  const key = getItemCollectionKey(makeCard());
  assert.equal(isItemCollected(makeCard()), true);
  const removed = removeItemCollectionEntries([key]);
  assert.deepEqual(removed, { ok: true, removed: 1, total: 1 });
  assert.equal(isItemCollected(makeCard()), false);

  values.set(ITEM_COLLECTION_STORAGE_KEY, "broken");
  loadItemCollection();
  assert.equal(state.itemCollectionHealthy, false);
  assert.equal(addItemCollectionEntries([makeCard()]).ok, false);
  assert.equal(removeItemCollectionEntries([key]).ok, false);
});

test("collection lookup refreshes after a replacement and reuses the current key index", () => {
  let reads = 0;
  const key = getItemCollectionKey(makeCard());
  state.itemCollectionItems = [{ get key() { reads++; return key; } }];
  for (let i = 0; i < 100; i++) assert.equal(isItemCollected(makeCard()), true);
  assert.equal(reads, 1);
  state.itemCollectionItems = [];
  assert.equal(isItemCollected(makeCard()), false);
});
