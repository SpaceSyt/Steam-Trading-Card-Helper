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
  submitBuyOrdersForSelection,
} = await import("../../src/features/orders.js");
const { RequestQueue } = await import("../../src/request/queue.js");

beforeEach(() => {
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
