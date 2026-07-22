import test from "node:test";
import assert from "node:assert/strict";

import { getSurplusReservePolicy } from "../../src/services/surplus-policy.js";

test("ordinary and foil badges reserve every set still needed for max level", () => {
  assert.equal(getSurplusReservePolicy({ level: 2 }).reservePerCard, 3);
  assert.equal(getSurplusReservePolicy({ level: 5 }).reservePerCard, 0);
  assert.equal(getSurplusReservePolicy({ level: 0, isFoil: true }).reservePerCard, 1);
  assert.equal(getSurplusReservePolicy({ level: 1, isFoil: true }).reservePerCard, 0);
});

test("unlimited badges keep one set until the first level and are never hidden", () => {
  const uncrafted = getSurplusReservePolicy({ level: 0, isUnlimitedLevelBadge: true });
  assert.equal(uncrafted.eligible, true);
  assert.equal(uncrafted.reservePerCard, 1);

  const crafted = getSurplusReservePolicy({ level: 1, isUnlimitedLevelBadge: true });
  assert.equal(crafted.eligible, true);
  assert.equal(crafted.reservePerCard, 0);
});
