import test from "node:test";
import assert from "node:assert/strict";

import { applyItemRecommendation } from "../../src/services/item-recommendation.js";

function createItem(overrides = {}) {
  return {
    marketHashName: "753-Test Item",
    marketableCount: 1,
    gemValue: 100,
    totalGems: 300,
    priceCents: 0,
    ...overrides,
  };
}

test("item recommendation prefers grinding when the market is unavailable or worth less", () => {
  const unavailable = applyItemRecommendation(createItem({ priceCents: 0 }), 400);
  assert.equal(unavailable.recommendationKey, "grind");
  assert.equal(unavailable.recommendationLabel, "分解");

  const lowMarket = applyItemRecommendation(createItem({ priceCents: 21 }), 400);
  assert.equal(lowMarket.recommendationKey, "grind");
});

test("item recommendation labels a higher-value market item for sale", () => {
  const item = applyItemRecommendation(createItem({ priceCents: 100 }), 400);
  assert.equal(item.recommendationKey, "sell");
  assert.equal(item.recommendationLabel, "出售");
});

test("item recommendation remains unknown when the gem sack price is missing", () => {
  const item = applyItemRecommendation(createItem({ priceCents: 100 }), 0);
  assert.equal(item.recommendationKey, "unknown");
  assert.equal(item.recommendationLabel, "缺宝石价");
});

test("a failed market request never becomes a destructive grind recommendation", () => {
  const item = applyItemRecommendation(createItem({
    priceCents: 0,
    priceLookupFailed: true,
  }), 400);

  assert.equal(item.recommendationKey, "unknown");
  assert.equal(item.recommendationLabel, "缺市场价");
});

test("the same 10-gem threshold can yield a sale, a tie or a grind for 40 gems", async () => {
  const { getCurrencyContextById, setActiveCurrencyContext, clearActiveCurrencyContext } = await import("../../src/services/currency.js");
  const { getGemBreakEvenBuyerPrice } = await import("../../src/utils/market-fees.js");
  setActiveCurrencyContext(getCurrencyContextById(23));
  try {
    for (const [sack, value, key, formatted] of [
      [429, 14.96, "sell", "¥0.1496"],
      [430, 15, "grind", "¥0.15"],
      [431, 15.04, "grind", "¥0.1504"],
    ]) {
      const item = applyItemRecommendation(createItem({ gemValue: 40, totalGems: 80, priceCents: 29 }), sack);
      assert.equal(getGemBreakEvenBuyerPrice(10, sack), 18);
      assert.equal(item.marketNetCents, 15);
      assert.equal(item.unitGemValueNetCents, value);
      assert.equal(item.recommendationKey, key);
      assert.equal(item.unitGemValueText, formatted);
    }
  } finally {
    clearActiveCurrencyContext();
  }
});
