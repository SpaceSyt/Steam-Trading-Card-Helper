import assert from "node:assert/strict";
import test from "node:test";

import { getAssetAmount, parseCommunityInventoryPage, parseGooValueParams } from "../../src/parsers/inventory.js";

test("asset quantities fail closed instead of manufacturing one item", () => {
  assert.equal(getAssetAmount({ amount: 3 }), 3);
  assert.equal(getAssetAmount({ amount: "2" }), 2);
  assert.equal(getAssetAmount({ amount: "2x" }), 0);
  assert.equal(getAssetAmount({ amount: 0 }), 0);
  assert.equal(getAssetAmount({ amount: -1 }), 0);
  assert.equal(getAssetAmount({}), 0);
});

test("community inventory pages share normalized assets, descriptions, and pagination", () => {
  const page = parseCommunityInventoryPage({
    assets: [{ assetid: "1", classid: "10", instanceid: "0" }],
    descriptions: [{ classid: "10", instanceid: "0", name: "Card" }],
    total_inventory_count: "7",
    more_items: true,
    last_assetid: 123,
  });
  assert.equal(page.assets.length, 1);
  assert.equal(page.descriptions.get("10_0").name, "Card");
  assert.equal(page.totalInventoryCount, 7);
  assert.equal(page.nextAssetId, "123");

  const empty = parseCommunityInventoryPage(null);
  assert.deepEqual(empty.assets, []);
  assert.equal(empty.descriptions.size, 0);
  assert.equal(empty.totalInventoryCount, 0);
  assert.equal(empty.nextAssetId, "");
});

test("foil card buckets must match the card's game and border", () => {
  const description = {
    market_fee_app: 730,
    market_bucket_id: "B730-2-1",
    tags: [
      { category: "item_class", internal_name: "item_class_2" },
      { category: "cardborder", internal_name: "cardborder_1" },
    ],
  };
  assert.deepEqual(parseGooValueParams(description), { appid: "730", itemType: "2", borderColor: "1" });
  for (const market_bucket_id of ["B730-2", "B570-2-1", "B730-2-3", ""]) {
    assert.equal(parseGooValueParams({ ...description, market_bucket_id }), null);
  }
});
