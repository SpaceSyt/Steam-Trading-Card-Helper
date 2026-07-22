import assert from "node:assert/strict";
import test from "node:test";

import { getAssetAmount } from "../../src/parsers/inventory.js";

test("asset quantities fail closed instead of manufacturing one item", () => {
  assert.equal(getAssetAmount({ amount: 3 }), 3);
  assert.equal(getAssetAmount({ amount: "2" }), 2);
  assert.equal(getAssetAmount({ amount: "2x" }), 0);
  assert.equal(getAssetAmount({ amount: 0 }), 0);
  assert.equal(getAssetAmount({ amount: -1 }), 0);
  assert.equal(getAssetAmount({}), 0);
});
