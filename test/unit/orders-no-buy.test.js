import assert from "node:assert/strict";
import test from "node:test";

globalThis.GM_getValue = () => null;
globalThis.GM_setValue = () => {};
globalThis.window = {
  jQuery: null,
  $: null,
  location: { href: "https://steamcommunity.com/id/test/badges" },
};
globalThis.document = {
  cookie: "",
  documentElement: { innerHTML: "" },
  getElementById: () => null,
  querySelector: () => null,
};
globalThis.unsafeWindow = {
  g_rgWalletInfo: {
    wallet_currency: 23,
    wallet_market_minimum: 7,
  },
};

const { state } = await import("../../src/state.js");
const { setActiveCurrencyContext, getCurrencyContextById } = await import(
  "../../src/services/currency.js"
);
const { buildBuyOrderPlan } = await import("../../src/features/orders.js");

const MARKET_HASH_NAME = "123-Test Card";
const noBuyOrderHtml = (() => {
  const renderContext = {
    queryData: JSON.stringify({
      queries: [{
        queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
        state: { data: { amtMinSellOrder: 32, eCurrency: 23, cBuyOrders: 0 } },
      }],
    }),
  };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
})();

const selected = [{
  appid: "123",
  gameName: "Test Game",
  level: 0,
  cards: [{
    name: "Test Card",
    marketHashName: MARKET_HASH_NAME,
    owned: 0,
  }],
}];

function makeUi() {
  return {
    queue: {
      fetch: async () => ({ status: 200, text: noBuyOrderHtml, data: null }),
    },
    log: () => {},
    setStatus: () => {},
  };
}

test("automatic ordering uses the currency minimum when Steam confirms there are no buy orders", async () => {
  setActiveCurrencyContext(getCurrencyContextById(23));
  Object.assign(state.cfg, {
    buyMode: "buy1",
    automaticPricingEnabled: true,
    automaticPriceStrategy: "balanced",
    automaticPriceAdjustment: 0,
    noBuyOrderMinimumFallback: true,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].basePriceCents, 21);
  assert.equal(result.plan[0].unitPriceCents, 21);
  assert.equal(result.plan[0].noBuyMinimumFallback, true);
  assert.equal(result.skipped.noBuyMinimumFallback, 1);
});

test("manual highest-buy ordering uses the same no-buy minimum fallback", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: false,
    orderPriceSource: "highest",
    priceAdjustment: 0,
    noBuyOrderMinimumFallback: true,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].unitPriceCents, 21);
  assert.equal(result.plan[0].noBuyMinimumFallback, true);
});

test("disabling the no-buy fallback preserves fail-closed ordering", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: true,
    noBuyOrderMinimumFallback: false,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 0);
  assert.equal(result.skipped.missingPrice, 1);
  assert.equal(result.skipped.noBuyMinimumFallback, 0);
});
