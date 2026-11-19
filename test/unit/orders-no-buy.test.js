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
  createLongTermBuyOrder,
  submitBuyOrdersForSelection,
} = await import("../../src/features/orders.js");
const { getOrderWalletRules } = await import("../../src/services/market-orders.js");
const { RequestQueue } = await import("../../src/request/queue.js");

beforeEach(() => {
  unsafeWindow.g_rgWalletInfo = { wallet_currency: 23, wallet_market_minimum: 7 };
  state.cfg.currencyId = 23;
  setActiveCurrencyContext(getCurrencyContextById(23));
});

afterEach(() => {
  state.marketOrderDepths.clear();
  state.highestBuyPrices.clear();
  state.automaticPricingDraft = null;
  state.cfg.currencyId = 23;
  state.cfg.parallelOrderPricingEnabled = false;
  state.cfg.parallelOrderPricingConcurrency = 4;
  delete window.fetch;
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

function makeOrderbookHtml(data, marketHashName = MARKET_HASH_NAME) {
  const renderContext = {
    queryData: JSON.stringify({
      queries: [{
        queryKey: ["market", "orderbook", 753, marketHashName],
        state: { data },
      }],
    }),
  };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
}

test("optional order pricing limits parallel listing requests to the configured concurrency", async () => {
  Object.assign(state.cfg, {
    buyMode: "buy1",
    automaticPricingEnabled: true,
    automaticPriceStrategy: "balanced",
    minimumPriceFallback: true,
    parallelOrderPricingEnabled: true,
    parallelOrderPricingConcurrency: 2,
  });
  const marketHashNames = ["123-Card A", "123-Card B", "123-Card C"];
  const parallelSelection = [{
    appid: "123",
    gameName: "Parallel Test",
    level: 0,
    cards: marketHashNames.map((marketHashName, index) => ({
      name: `Card ${index + 1}`,
      marketHashName,
      owned: 0,
    })),
  }];
  let active = 0;
  let maximumActive = 0;
  let requestCount = 0;
  window.fetch = async url => {
    requestCount++;
    active++;
    maximumActive = Math.max(maximumActive, active);
    await new Promise(resolve => setTimeout(resolve, 10));
    active--;
    const marketHashName = decodeURIComponent(String(url).split("/").pop().split("?")[0]);
    const html = makeOrderbookHtml({
      amtMaxBuyOrder: 45,
      amtMinSellOrder: 60,
      eCurrency: 23,
      cBuyOrders: 10,
      rgCompactBuyOrders: [45, 10],
    }, marketHashName);
    return {
      status: 200,
      ok: true,
      text: async () => html,
    };
  };

  const result = await buildBuyOrderPlan(parallelSelection, new Map(), makeUi());

  assert.equal(requestCount, 3);
  assert.equal(maximumActive, 2);
  assert.equal(result.plan.length, 3);
});

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
  delete unsafeWindow.g_rgWalletInfo;
  state.cfg.currencyId = null;

  await assert.rejects(
    () => buildBuyOrderPlan(selected, new Map(), makeUi()),
    /无法确认 Steam 钱包币种/,
  );
});

test("preview fetches matching market wallet rules only when missing", async () => {
  const id = "76561198000000000";
  unsafeWindow.g_steamID = id;
  unsafeWindow.g_rgWalletInfo = { wallet_currency: 21 };
  setActiveCurrencyContext(getCurrencyContextById(21));
  const requests = [];
  const wallet = { wallet_currency: 21, wallet_market_minimum: 2, wallet_fee_minimum: 2, wallet_currency_increment: 1 };
  let marketAccount = "76561198000000001";
  const queue = { fetch: async url => {
    requests.push(url);
    return { text: `<script>var g_steamID='${marketAccount}';var g_rgWalletInfo=${JSON.stringify(wallet)};</script>` };
  } };
  try {
    await assert.rejects(getOrderWalletRules(queue), /无法确认 Steam 钱包币种/);
    marketAccount = id;
    wallet.wallet_currency = 1;
    await assert.rejects(getOrderWalletRules(queue), /钱包币种已改变/);
    wallet.wallet_currency = 21;
    const rules = await getOrderWalletRules(queue);
    assert.equal(rules.currencyId, 21);
    assert.equal(rules.minimumBuyerMinor, 6);
    assert.equal((await getOrderWalletRules(queue)).currencyId, 21);
    assert.deepEqual(requests, Array(3).fill("https://steamcommunity.com/market/"));
    setActiveCurrencyContext({ wallet_currency: 999 });
    state.cfg.currencyId = 23;
    await assert.rejects(getOrderWalletRules(queue), /无法确认 Steam 钱包币种/);
    assert.equal(requests.length, 3);
  } finally { delete unsafeWindow.g_steamID; }
});

test("a fresh ambiguous wallet shares the first authenticated read across pricing and order previews", async () => {
  const { initializeCurrencyContext } = await import("../../src/services/currency.js");
  const { getWalletForPricing } = await import("../../src/services/market-wallet.js");
  delete unsafeWindow.g_rgWalletInfo;
  state.cfg.currencyId = null;
  unsafeWindow.g_steamID = "76561198000000000";
  const current = initializeCurrencyContext({ pageText: "$10.00", pageHtml: "", document: {}, configuredCurrencyId: null });
  assert.equal(current.currencyId, null);
  let cacheLoads = 0;
  state.loadOrderCache = currencyId => { cacheLoads++; return [{ appid: "123", currencyId }]; };
  let reads = 0;
  const queue = { fetch: async url => {
    reads++;
    assert.equal(url, "https://steamcommunity.com/market/");
    return { text: `<div>var g_rgWalletInfo={"wallet_currency":1};</div><script>g_steamID='${unsafeWindow.g_steamID}'; g_rgWalletInfo={"wallet_currency":21,"wallet_market_minimum":1};</script>` };
  } };
  try {
    const [pricing, order] = await Promise.all([getWalletForPricing(queue), getOrderWalletRules(queue)]);
    assert.equal(pricing.code, "AUD");
    assert.equal(order.minimumBuyerMinor, 3);
    assert.equal(state.currencyContext.currencyId, 21);
    assert.equal((await getWalletForPricing(queue)).currencyId, 21);
    assert.equal(reads, 1);
    assert.equal(cacheLoads, 1);
    assert.deepEqual(state.orderResults, [{ appid: "123", currencyId: 21 }]);
  } finally { delete unsafeWindow.g_steamID; state.orderResults = []; delete state.loadOrderCache; }
});

test("an independent wallet preview can take over a cancelled read only on the same account", async t => {
  const owner = "76561198000000000";
  t.after(() => { delete unsafeWindow.g_steamID; });
  for (const sameAccount of [true, false]) {
    unsafeWindow.g_steamID = owner;
    unsafeWindow.g_rgWalletInfo = { wallet_currency: 21 };
    setActiveCurrencyContext(getCurrencyContextById(21));
    let cancel, reads = 0;
    const first = { fetch: () => new Promise((_resolve, reject) => { cancel = reject; }) };
    const second = { fetch: async () => {
      reads++;
      return { text: `<script>var g_steamID='${owner}';var g_rgWalletInfo={"wallet_currency":21,"wallet_market_minimum":1};</script>` };
    } };
    const result = Promise.allSettled([getOrderWalletRules(first), getOrderWalletRules(second), getOrderWalletRules(second)]);
    if (!sameAccount) unsafeWindow.g_steamID = "76561198000000001";
    cancel({ status: 0, error: "stopped" });
    const [leader, ...others] = await result;
    assert.equal(leader.status, "rejected");
    for (const other of others) {
      assert.equal(other.status, sameAccount ? "fulfilled" : "rejected");
      if (sameAccount) assert.equal(other.value.minimumBuyerMinor, 3);
    }
    assert.equal(reads, Number(sameAccount));
  }
});

test("AUD preview and mock submission keep the wallet and amount", async () => {
  unsafeWindow.g_rgWalletInfo = { wallet_currency: 21, wallet_market_minimum: 1 };
  setActiveCurrencyContext(unsafeWindow.g_rgWalletInfo);
  Object.assign(state.cfg, { buyMode: "buy1", automaticPricingEnabled: false, orderPriceSource: "lowest", priceAdjustment: 0.02 });
  const data = [{ ...selected[0], currencyId: 21, cards: [{ ...selected[0].cards[0], priceSource: "lowest", lowestCents: 123 }] }];
  const { plan } = await buildBuyOrderPlan(data, new Map(), makeUi());
  assert.equal(plan[0].unitPriceCents, 125);
  assert.equal(plan[0].currencyId, 21);
  const requests = [];
  unsafeWindow.g_sessionID = "fixture";
  window.fetch = async (url, { body }) => {
    requests.push([new URL(url).pathname, new URLSearchParams(body)]);
    return { ok: true, text: async () => JSON.stringify({ success: 1, buy_orderid: "123" }) };
  };
  try {
    await createLongTermBuyOrder(plan[0]);
    assert.equal(requests[0][0], "/market/createbuyorder/");
    assert.equal(requests[0][1].get("currency"), "21");
    assert.equal(requests[0][1].get("price_total"), "125");
    unsafeWindow.g_rgWalletInfo.wallet_currency = 1;
    await assert.rejects(createLongTermBuyOrder(plan[0]), /钱包币种已改变/);
    assert.equal(requests.length, 1);
  } finally { delete unsafeWindow.g_sessionID; }
});

test("a whole-unit wallet applies its increment before quantity and guards the lowest ask", async () => {
  unsafeWindow.g_rgWalletInfo = { wallet_currency: 8, wallet_market_minimum: 100, wallet_currency_increment: 100 };
  setActiveCurrencyContext(unsafeWindow.g_rgWalletInfo);
  Object.assign(state.cfg, { buyMode: "buy1", automaticPricingEnabled: true, automaticPriceStrategy: "aggressive" });
  state.automaticPricingDraft = { strategy: "aggressive", noWallOffsetMinor: 120, wallOffsetMinor: 120 };
  const ui = makeUi();
  ui.queue.fetch = async () => ({ text: makeOrderbookHtml({ eCurrency: 8, amtMaxBuyOrder: 900, cBuyOrders: 1,
    rgCompactBuyOrders: [900, 1], amtMinSellOrder: 1000 }) });
  const { plan } = await buildBuyOrderPlan(selected, new Map(), ui);
  assert.equal(plan[0].unitPriceCents, 900);
  assert.equal(plan[0].currencyId, 8);
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

test("unknown or contradictory buy data never enables the no-buy fallback", async () => {
  for (const automaticPricingEnabled of [true, false]) {
    for (const data of [
      { eCurrency: 23 },
      { eCurrency: 23, cBuyOrders: 10 },
      { eCurrency: 23, cBuyOrders: 10, amtMaxBuyOrder: 0 },
      { eCurrency: 23, cBuyOrders: 0, amtMaxBuyOrder: "invalid" },
      { eCurrency: 23, cBuyOrders: 0, rgCompactBuyOrders: [45, 10] },
      { cBuyOrders: 0 },
      { eCurrency: 1, cBuyOrders: 0 },
    ]) {
      Object.assign(state.cfg, {
        buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest",
        automaticPriceStrategy: "aggressive", minimumPriceFallback: true,
      });
      const ui = makeUi();
      ui.queue.fetch = async () => ({ status: 200, text: makeOrderbookHtml(data) });
      const result = await buildBuyOrderPlan(selected, new Map(), ui);
      assert.equal(result.plan.length, 0, JSON.stringify(data));
      assert.equal(result.skipped.minimumPriceFallback, 0);
      assert.equal(result.skipped.missingPrice, 1);
      assert.ok(result.firstPricingError);
    }
  }
});

test("invalid zero-buy evidence never enables the minimum-price fallback", async () => {
  const invalidValues = [
    "", " ", "\t\n", ".", ",", "'", "’", false, true,
    [], [0], [0, 0], {}, { value: 0 }, "invalid", "1e-999", "0x0",
  ];
  const payloads = [
    ...[...invalidValues, null, undefined, 1, -1, "1", "-1", "0.1"].map(cBuyOrders => ({
      eCurrency: 23, cBuyOrders, amtMaxBuyOrder: 0,
    })),
    ...invalidValues.map(amtMaxBuyOrder => ({
      eCurrency: 23, cBuyOrders: 0, amtMaxBuyOrder,
    })),
    ...[null, false, "", {}, [0, 0], [45, 10]].map(rgCompactBuyOrders => ({
      eCurrency: 23, cBuyOrders: 0, amtMaxBuyOrder: 0, rgCompactBuyOrders,
    })),
  ];
  for (const automaticPricingEnabled of [true, false]) {
    Object.assign(state.cfg, {
      buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest",
      minimumPriceFallback: true,
    });
    for (const data of payloads) {
      state.highestBuyPrices.clear();
      state.marketOrderDepths.clear();
      const ui = makeUi();
      ui.queue.fetch = async () => ({ status: 200, text: makeOrderbookHtml(data) });
      const result = await buildBuyOrderPlan(selected, new Map(), ui);
      assert.equal(result.skipped.minimumPriceFallback, 0, JSON.stringify(data));
      assert.ok(result.plan.every(item => !item.minimumPriceFallback), JSON.stringify(data));
      // Positive prices retain their existing non-fallback pricing behavior.
      if (!(Number(data.amtMaxBuyOrder) > 0)) {
        assert.equal(result.plan.length, 0, JSON.stringify(data));
        assert.equal(result.skipped.missingPrice, 1);
        assert.ok(result.firstPricingError);
      }
    }
  }
});

test("explicit numeric zeros retain fallback with absent or empty compact depth", async () => {
  const zeros = [0, -0, "0", "00", " 0 ", "+0", "-0", "0.0", ".0", "0.", "0e0", "0e+4"];
  const payloads = [
    ...zeros.map(cBuyOrders => ({ eCurrency: 23, cBuyOrders, amtMaxBuyOrder: 0 })),
    ...[...zeros, null, undefined].map(amtMaxBuyOrder => ({
      eCurrency: 23, cBuyOrders: 0, amtMaxBuyOrder, rgCompactBuyOrders: [],
    })),
  ];
  for (const automaticPricingEnabled of [true, false]) {
    Object.assign(state.cfg, {
      buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest",
      minimumPriceFallback: true,
    });
    for (const data of payloads) {
      const ui = makeUi();
      ui.queue.fetch = async () => ({ status: 200, text: makeOrderbookHtml(data) });
      const result = await buildBuyOrderPlan(selected, new Map(), ui);
      assert.equal(result.plan.length, 1, JSON.stringify(data));
      assert.equal(result.plan[0].minimumFallbackReason, "no-buy-orders");
      assert.equal(result.skipped.minimumPriceFallback, 1);
      assert.equal(result.firstPricingError, "");
    }
  }
});

test("real queue HTTP errors preserve status without leaking response bodies", async () => {
  Object.assign(state.cfg, { buyMode: "buy1", automaticPricingEnabled: true, minimumPriceFallback: true });
  for (const status of [429, 500]) {
    const queue = new RequestQueue(0, state, null, null, {
      fetch: async () => ({ status, ok: false, text: async () => "PRIVATE_RESPONSE_SENTINEL" }),
    });
    const logs = [];
    try {
      const result = await buildBuyOrderPlan(selected, new Map(), { queue, log: text => logs.push(text), setStatus: () => {} });
      assert.equal(result.plan.length, 0);
      assert.equal(result.firstPricingError, `HTTP ${status}`);
      assert.match(logs.join(""), new RegExp(`HTTP ${status}`));
      assert.doesNotMatch(logs.join(""), /object Object|PRIVATE_RESPONSE_SENTINEL/);
    } finally {
      queue.stop();
    }
  }
});

test("empty submission preserves pricing errors and distinguishes missing identity and owned cards", async () => {
  const originalFetch = RequestQueue.prototype.fetch;
  const originalGetElement = document.getElementById;
  const originalResults = state.orderResults;
  const originalSelection = state.selectedOrderResults;
  const status = { textContent: "", style: {} };
  let listingRequests = 0;
  document.getElementById = id => id === "stch-order-status" ? status : null;
  RequestQueue.prototype.fetch = async (url, options = {}) => {
    assert.equal(options.method || "GET", "GET");
    if (url.includes("/market/mylistings?")) return { data: { success: true, results_html: "" } };
    assert.ok(url.includes("/market/listings/753/"));
    listingRequests++;
    throw { status: 429, text: "PRIVATE_RESPONSE_SENTINEL" };
  };
  try {
    Object.assign(state.cfg, { buyMode: "complete1", automaticPricingEnabled: true, minimumPriceFallback: true });
    state.selectedOrderResults = new Set(["123_0"]);
    state.orderResults = [{ ...selected[0], cards: [
      selected[0].cards[0],
      { name: "Missing", owned: 0 },
      { name: "Owned", marketHashName: "123-Owned", owned: 1 },
    ] }];
    await submitBuyOrdersForSelection("order");
    assert.equal(listingRequests, 1);
    assert.match(status.textContent, /1 种卡牌缺少市场标识/);
    assert.match(status.textContent, /1 种卡牌无法定价/);
    assert.match(status.textContent, /1 种卡牌在当前模式下无需购买/);
    assert.match(status.textContent, /HTTP 429/);
    assert.doesNotMatch(status.textContent, /object Object|PRIVATE_RESPONSE_SENTINEL|已被订单/);
    assert.equal(state.orderSubmissionRunning, false);
  } finally {
    RequestQueue.prototype.fetch = originalFetch;
    document.getElementById = originalGetElement;
    state.orderResults = originalResults;
    state.selectedOrderResults = originalSelection;
  }
});

test("modern SSR supports order pricing with one listing GET and no fallback", async () => {
  for (const automaticPricingEnabled of [false, true]) {
    Object.assign(state.cfg, {
      buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest",
      automaticPriceStrategy: "aggressive", minimumPriceFallback: true,
    });
    state.highestBuyPrices.clear();
    state.marketOrderDepths.clear();
    let requests = 0;
    const ui = makeUi();
    ui.queue.fetch = async (url, options = {}) => {
      requests++;
      assert.equal(options.method || "GET", "GET");
      assert.ok(url.includes(encodeURIComponent(MARKET_HASH_NAME)));
      const legacy = makeOrderbookHtml({ eCurrency: 23, amtMaxBuyOrder: 45, cBuyOrders: 10, rgCompactBuyOrders: [45, 10] });
      const context = JSON.parse(JSON.parse(legacy.match(/JSON\.parse\((.*)\);/)[1]));
      return { status: 200, text: `<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext: context })}</script>` };
    };
    const result = await buildBuyOrderPlan(selected, new Map(), ui);
    assert.equal(requests, 1);
    assert.equal(result.plan.length, 1);
    assert.equal(result.skipped.minimumPriceFallback, 0);
    assert.equal(result.firstPricingError, "");
  }
});

test("modern SSR mismatches and incomplete depth never trigger minimum-price fallback", async () => {
  for (const automaticPricingEnabled of [false, true]) {
    for (const kind of ["currency", "item", "truncated", "contradictory-zero", "invalid-zero"]) {
      if (!automaticPricingEnabled && kind === "truncated") continue;
      state.highestBuyPrices.clear();
      state.marketOrderDepths.clear();
      Object.assign(state.cfg, {
        buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest",
        automaticPriceStrategy: "aggressive", minimumPriceFallback: true,
      });
      const data = { eCurrency: kind === "currency" ? 1 : 23, amtMaxBuyOrder: 45, cBuyOrders: 10, rgCompactBuyOrders: [45, kind === "truncated" ? 9 : 10] };
      if (kind === "contradictory-zero") { data.cBuyOrders = 0; data.amtMaxBuyOrder = 0; }
      if (kind === "invalid-zero") { data.cBuyOrders = false; data.amtMaxBuyOrder = 0; data.rgCompactBuyOrders = []; }
      const legacy = makeOrderbookHtml(data, kind === "item" ? "123-Other Card" : MARKET_HASH_NAME);
      const context = JSON.parse(JSON.parse(legacy.match(/JSON\.parse\((.*)\);/)[1]));
      const ui = makeUi();
      let requests = 0;
      ui.queue.fetch = async () => {
        requests++;
        return { status: 200, text: `<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext: context })}</script>` };
      };
      const result = await buildBuyOrderPlan(selected, new Map(), ui);
      assert.equal(requests, 1);
      assert.equal(result.plan.length, 0, `${automaticPricingEnabled}/${kind}`);
      assert.equal(result.skipped.minimumPriceFallback, 0);
      assert.ok(result.firstPricingError);
    }
  }
});

test("modern SSR explicit zero buy orders retain the configured minimum-price fallback", async () => {
  for (const automaticPricingEnabled of [false, true]) {
    Object.assign(state.cfg, {
      buyMode: "buy1", automaticPricingEnabled, orderPriceSource: "highest", minimumPriceFallback: true,
    });
    const legacy = makeOrderbookHtml({ eCurrency: 23, cBuyOrders: 0, amtMaxBuyOrder: 0, rgCompactBuyOrders: [] });
    const context = JSON.parse(JSON.parse(legacy.match(/JSON\.parse\((.*)\);/)[1]));
    const ui = makeUi();
    ui.queue.fetch = async () => ({ status: 200, text: `<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext: context })}</script>` });
    const result = await buildBuyOrderPlan(selected, new Map(), ui);
    assert.equal(result.plan.length, 1);
    assert.equal(result.plan[0].minimumFallbackReason, "no-buy-orders");
    assert.equal(result.skipped.minimumPriceFallback, 1);
  }
});

test("active orders show each scanned unit quote and discard stale prices on a partial rescan", async () => {
  const { querySelectedOrderPrices } = await import("../../src/features/active-orders.js");
  const { formatMoney } = await import("../../src/utils/format.js");
  Object.assign(state.cfg, { automaticPricingEnabled: true, automaticPriceStrategy: "balanced" });
  const groups = [85, 83, 84].map((frozenMinor, index) => ({
    key: String(index),
    appid: "730",
    marketHashName: `Item ${index}`,
    frozenMinor,
    remainingQuantity: 2,
    _smartCell: { isConnected: true },
  }));
  state.activeBuyOrderGroups = groups;
  state.selectedActiveBuyOrderGroups = new Set(groups.map(group => group.key));
  const calls = [];
  let includeDepth = true;
  let listingCurrency = 23;
  window.fetch = async url => {
    calls.push(String(url));
    if (new URL(url).pathname.includes("/priceoverview/")) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ success: true, lowest_price: "¥0.62" }) };
    }
    const marketHashName = decodeURIComponent(new URL(url).pathname.split("/").pop());
    const orderbook = {
      amtMaxBuyOrder: 43, amtMinSellOrder: 55, eCurrency: listingCurrency, cBuyOrders: 4,
      ...(includeDepth ? { rgCompactBuyOrders: [43, 4] } : {}),
    };
    const queries = [753, 730].map(appid => ({
      queryKey: ["market", "orderbook", appid, marketHashName],
      state: { data: appid === 730 ? orderbook : {
        amtMaxBuyOrder: 70, amtMinSellOrder: 90, eCurrency: 23, cBuyOrders: 1, rgCompactBuyOrders: [70, 1],
      } },
    }));
    const renderContext = { queryData: JSON.stringify({ queries }) };
    return { ok: true, status: 200, text: async () =>
      `<script type="application/json" id="valve-ssr-data">${JSON.stringify({ renderContext })}</script>` };
  };

  try {
    await querySelectedOrderPrices();
    assert.equal(calls.length, 3);
    assert.ok(calls.every(url => url.includes("/listings/730/")));
    assert.deepEqual(groups.map(group => group.lowestSellMinor), [55, 55, 55]);
    assert.deepEqual(groups.map(group => group.suggestedMinor), [42, 42, 42]);
    assert.deepEqual(groups.map(group => group.quoteCurrencyId), [23, 23, 23]);
    assert.deepEqual(groups.map(group => group._smartCell.className), [
      "stch-active-order-smart saving", "stch-active-order-smart increase", "stch-active-order-smart",
    ]);
    assert.deepEqual(groups.map(group => group._smartCell.textContent),
      ["↓ ", "↑ ", ""].map(prefix => prefix + formatMoney(42, 23)));

    includeDepth = false;
    state.selectedActiveBuyOrderGroups = new Set(["0"]);
    await querySelectedOrderPrices();
    assert.equal(calls.length, 4);
    assert.equal(groups[0].lowestSellMinor, 55);
    assert.equal(groups[0].suggestedMinor, null);
    assert.equal(groups[0].quoteCurrencyId, null);
    assert.equal(groups[0]._smartCell.textContent, "无可用买价");
    assert.equal(groups[1].suggestedMinor, 42);

    includeDepth = true;
    listingCurrency = 1;
    state.selectedActiveBuyOrderGroups = new Set(["1"]);
    await querySelectedOrderPrices();
    assert.equal(calls.length, 6);
    assert.equal(groups[1].lowestSellMinor, 62);
    assert.equal(groups[1].suggestedMinor, null);
    assert.equal(groups[1].quoteCurrencyId, null);
  } finally {
    state.activeBuyOrderGroups = [];
    state.selectedActiveBuyOrderGroups.clear();
    state.activeOrderLowestPrices.clear();
  }
});
