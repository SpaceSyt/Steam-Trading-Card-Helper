import assert from "node:assert/strict";
import test from "node:test";

import { calculateResultPricingTotals } from "../../src/services/pricing-estimate.js";

const result = {
  level: 1,
  targetLevel: 5,
  cheapestSetCostCents: 100,
  fullSetCostCents: 300,
  level5CostCents: 1070,
  cards: [
    { owned: 0, lowestCents: 100, medianCents: 110 },
    { owned: 1, lowestCents: 200, medianCents: 220 },
  ],
};

test("price adjustment updates completion, full-set, and level totals", () => {
  assert.deepEqual(calculateResultPricingTotals(result, {
    priceSource: "lowest",
    adjustmentMinor: 1,
    minimumPriceMinor: 3,
  }), {
    completionCents: 101,
    fullCents: 302,
    levelCents: 1077,
  });
});

test("median mode recalculates all totals without remote data", () => {
  assert.deepEqual(calculateResultPricingTotals(result, {
    priceSource: "median",
    resolveBasePriceMinor: card => card.medianCents,
    minimumPriceMinor: 3,
  }), {
    completionCents: 110,
    fullCents: 330,
    levelCents: 1100,
  });
});

test("cached final strategy prices can drive automatic estimates", () => {
  assert.deepEqual(calculateResultPricingTotals(result, {
    automatic: true,
    priceSource: "balanced",
    resolveFinalPriceMinor: card => card.lowestCents - 2,
  }), {
    completionCents: 98,
    fullCents: 296,
    levelCents: 986,
  });
});
