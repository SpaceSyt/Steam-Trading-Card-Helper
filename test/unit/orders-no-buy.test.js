import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach, beforeEach } from "node:test";

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
const {
  clearActiveCurrencyContext,
  setActiveCurrencyContext,
  getCurrencyContextById,
} = await import(
  "../../src/services/currency.js"
);
const {
  buildBuyOrderPlan,
  loadActiveBuyOrders,
} = await import("../../src/features/orders.js");

beforeEach(() => {
  state.cfg.currencyId = 23;
  setActiveCurrencyContext(getCurrencyContextById(23));
});

afterEach(() => {
  state.marketOrderDepths.clear();
  state.highestBuyPrices.clear();
  state.automaticPricingDraft = null;
  state.cfg.currencyId = 23;
});

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

function makeOrderbookHtml(data) {
  const renderContext = {
    queryData: JSON.stringify({
      queries: [{
        queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
        state: { data },
      }],
    }),
  };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
}

test("automatic ordering keeps the unadjusted reference separate from a temporary no-wall offset", async () => {
  setActiveCurrencyContext(getCurrencyContextById(23));
  Object.assign(state.cfg, {
    buyMode: "buy1",
    automaticPricingEnabled: true,
    automaticPriceStrategy: "conservative",
    minimumPriceFallback: true,
  });
  state.automaticPricingDraft = {
    strategy: "conservative",
    wallAnchor: "bottom",
    wallOffsetMinor: 0,
    noWallOffsetMinor: -3,
  };
  const ui = makeUi();
  ui.queue.fetch = async () => ({
    status: 200,
    text: makeOrderbookHtml({
      amtMaxBuyOrder: 45,
      amtMinSellOrder: 60,
      eCurrency: 23,
      cBuyOrders: 42,
      rgCompactBuyOrders: [45, 10, 44, 12, 43, 11, 42, 9],
    }),
    data: null,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), ui);

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].basePriceCents, 45);
  assert.equal(result.plan[0].strategyOffsetCents, -3);
  assert.equal(result.plan[0].unitPriceCents, 42);
});

test("automatic ordering uses the currency minimum when Steam confirms there are no buy orders", async () => {
  setActiveCurrencyContext(getCurrencyContextById(23));
  Object.assign(state.cfg, {
    buyMode: "buy1",
    automaticPricingEnabled: true,
    automaticPriceStrategy: "balanced",
    minimumPriceFallback: true,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].basePriceCents, 21);
  assert.equal(result.plan[0].unitPriceCents, 21);
  assert.equal(result.plan[0].minimumPriceFallback, true);
  assert.equal(result.plan[0].minimumFallbackReason, "no-buy-orders");
  assert.equal(result.skipped.minimumPriceFallback, 1);
});

test("manual highest-buy ordering uses the same no-buy minimum fallback", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: false,
    orderPriceSource: "highest",
    priceAdjustment: 0,
    minimumPriceFallback: true,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].unitPriceCents, 21);
  assert.equal(result.plan[0].minimumPriceFallback, true);
});

test("disabling the no-buy fallback preserves fail-closed ordering", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: true,
    minimumPriceFallback: false,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 0);
  assert.equal(result.skipped.missingPrice, 1);
  assert.equal(result.skipped.minimumPriceFallback, 0);
});

test("manual ordering uses the market minimum when the scanned price is missing", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: false,
    orderPriceSource: "lowest",
    priceAdjustment: 0,
    minimumPriceFallback: true,
  });

  const result = await buildBuyOrderPlan(selected, new Map(), makeUi());

  assert.equal(result.plan.length, 1);
  assert.equal(result.plan[0].unitPriceCents, 21);
  assert.equal(result.plan[0].minimumFallbackReason, "missing-price");
});

test("automatic ordering fails closed when the pricing request fails", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: true,
    automaticPriceStrategy: "balanced",
    minimumPriceFallback: true,
  });
  state.marketOrderDepths.clear();
  const ui = makeUi();
  ui.queue.fetch = async () => ({ status: 500, text: "", data: null });

  const result = await buildBuyOrderPlan(selected, new Map(), ui);

  assert.equal(result.plan.length, 0);
  assert.equal(result.skipped.missingPrice, 1);
  assert.equal(result.skipped.minimumPriceFallback, 0);
});

test("legacy order-spread markup is not used when SSR orderbook data is missing", async () => {
  Object.assign(state.cfg, {
    automaticPricingEnabled: false,
    orderPriceSource: "highest",
    priceAdjustment: 0,
    minimumPriceFallback: true,
  });
  let requestCount = 0;
  const ui = makeUi();
  ui.queue.fetch = async () => {
    requestCount += 1;
    return {
      status: 200,
      text: "<script>Market_LoadOrderSpread(123456);</script>",
      data: null,
    };
  };

  const result = await buildBuyOrderPlan(selected, new Map(), ui);

  assert.equal(requestCount, 1);
  assert.equal(result.plan.length, 0);
  assert.equal(result.skipped.missingPrice, 1);
});

test("ordering is blocked when neither the wallet nor settings identify a currency", async () => {
  clearActiveCurrencyContext();
  state.cfg.currencyId = null;

  await assert.rejects(
    () => buildBuyOrderPlan(selected, new Map(), makeUi()),
    /无法确认 Steam 钱包币种/,
  );
});

test("existing-order parse diagnostics block order planning", async () => {
  const fixtureUrl = new URL(
    "../fixtures-public/market/mylistings-buy-orders.json",
    import.meta.url,
  );
  const data = JSON.parse(await readFile(fixtureUrl, "utf8"));

  await assert.rejects(
    () => loadActiveBuyOrders({ fetch: async () => ({ data }) }),
    /无法完整解析现有 Steam 订购单（1 项）/,
  );
});
