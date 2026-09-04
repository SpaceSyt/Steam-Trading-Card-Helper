import assert from "node:assert/strict";
import test from "node:test";

import {
  countSelected,
  pruneSelection,
  setItemsSelected,
} from "../../src/utils/selection.js";

const items = [{ key: "a" }, { key: "b" }];
const getKey = item => item.key;

test("shared selection helpers update, count, and prune keys in place", () => {
  const selection = new Set(["stale"]);
  setItemsSelected(selection, items, getKey, true);
  assert.equal(countSelected(selection, items, getKey), 2);
  pruneSelection(selection, items, getKey);
  assert.deepEqual([...selection], ["a", "b"]);
  setItemsSelected(selection, [items[0]], getKey, false);
  assert.deepEqual([...selection], ["b"]);
});
