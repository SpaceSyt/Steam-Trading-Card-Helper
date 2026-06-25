import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const scriptUrl = new URL("../steam-trading-card-helper.user.js", import.meta.url);
let source = fs.readFileSync(scriptUrl, "utf8");

source = source.replace(
  /\}\)\(\);\s*$/,
  `globalThis.__stchTest = {
    DEFAULT_CONFIG,
    RequestQueue,
    state,
    buildBuyOrderPlan,
    getOrderPriceSourceLabel,
    parseMarketOrderbookFromListingHtml,
  };
})();`
);

let now = 0;
class FakeDate extends Date {
  static now() {
    return now;
  }
}

const elements = new Map();
const storage = new Map();
const context = {
  console,
  URL,
  URLSearchParams,
  Map,
  Set,
  Math,
  Number,
  String,
  JSON,
  Object,
  Array,
  parseInt,
  parseFloat,
  isNaN,
  encodeURIComponent,
  decodeURIComponent,
  Date: FakeDate,
  setTimeout(resolve, ms) {
    now += Math.max(0, ms || 0);
    queueMicrotask(resolve);
    return 1;
  },
  clearTimeout() {},
  setInterval() {
    return 1;
  },
  clearInterval() {},
  GM_addStyle() {},
  GM_getValue(key, fallback) {
    return storage.has(key) ? storage.get(key) : fallback;
  },
  GM_setValue(key, value) {
    storage.set(key, value);
  },
  DOMParser: class {},
  MutationObserver: class {},
  document: {
    readyState: "loading",
    cookie: "",
    addEventListener() {},
    querySelector() {
      return null;
    },
    getElementById(id) {
      return elements.get(id) || null;
    },
  },
  location: {
    href: "https://steamcommunity.com/id/test/badges/",
  },
};
context.window = context;
context.unsafeWindow = context;
context.jQuery = () => ({ trigger() {} });
context.g_rgWalletInfo = {
  wallet_currency: 23,
  wallet_market_minimum: 7,
};

vm.createContext(context);
vm.runInContext(source, context, {
  filename: "steam-trading-card-helper.user.js",
});

const {
  DEFAULT_CONFIG,
  RequestQueue,
  state,
  buildBuyOrderPlan,
  getOrderPriceSourceLabel,
  parseMarketOrderbookFromListingHtml,
} = context.__stchTest;

assert.equal(DEFAULT_CONFIG.requestInterval, 330);
assert.equal(DEFAULT_CONFIG.batchSize, 20);
assert.equal(DEFAULT_CONFIG.batchPause, 53000);
assert.equal(DEFAULT_CONFIG.scanInterval, 0);
assert.equal(DEFAULT_CONFIG.priceAdjustment, 0);

async function runQueue({
  urls,
  latencies,
  statuses,
  interval = 330,
  batchSize = 99,
  batchPause = 53000,
  otherInterval = 0,
  initialRequestCount = 0,
}) {
  now = 0;
  const starts = [];
  let responseIndex = 0;
  context.window.fetch = async () => {
    starts.push(now);
    now += latencies[responseIndex] || 0;
    const status = statuses[responseIndex++] || 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      async text() {
        return '{"success":true}';
      },
    };
  };
  const queue = new RequestQueue(
    interval,
    batchSize,
    batchPause,
    { stopRequested: false, skipCurrent: false },
    null,
    null,
    otherInterval
  );
  queue._reqCount = initialRequestCount;
  await Promise.all(urls.map(url => queue.fetch(url).catch(error => error)));
  while (queue.running) await Promise.resolve();
  return starts;
}

const priceUrl =
  "https://steamcommunity.com/market/priceoverview/?appid=753";

assert.deepEqual(
  await runQueue({
    urls: [priceUrl, priceUrl, priceUrl],
    latencies: [100, 400, 50],
    statuses: [200, 200, 200],
  }),
  [0, 330, 730]
);
assert.deepEqual(
  await runQueue({
    urls: ["/gamecards/1", "/gamecards/2"],
    latencies: [50, 50],
    statuses: [200, 200],
  }),
  [0, 50]
);
assert.deepEqual(
  await runQueue({
    urls: ["/gamecards/1", "/gamecards/2"],
    latencies: [30, 30],
    statuses: [200, 200],
    otherInterval: 100,
  }),
  [0, 100]
);
assert.deepEqual(
  await runQueue({
    urls: [priceUrl, priceUrl, priceUrl],
    latencies: [100, 100, 100],
    statuses: [200, 200, 200],
    batchSize: 2,
  }),
  [0, 330, 53430]
);
assert.deepEqual(
  await runQueue({
    urls: [priceUrl, priceUrl],
    latencies: [50, 50, 50],
    statuses: [429, 200, 200],
    batchSize: 20,
    batchPause: 1000,
    initialRequestCount: 19,
  }),
  [0, 1050, 1380]
);

const marketHashName = "363890-Her Thanks";
const queryData = JSON.stringify({
  queries: [{
    queryKey: ["market", "orderbook", 753, marketHashName],
    state: {
      data: {
        amtMaxBuyOrder: 24,
        amtMinSellOrder: 40,
        eCurrency: 23,
      },
    },
  }],
});
const renderContext = JSON.stringify({ queryData });
const listingHtml =
  `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(renderContext)});</script>`;
assert.deepEqual(
  JSON.parse(JSON.stringify(
    parseMarketOrderbookFromListingHtml(listingHtml, marketHashName)
  )),
  {
    highestBuyCents: 24,
    currency: 23,
  }
);

assert.equal(getOrderPriceSourceLabel("lowest"), "在售最低");
assert.equal(getOrderPriceSourceLabel("median"), "平均价格");
assert.equal(getOrderPriceSourceLabel("highest"), "求购最高");

const selected = [{
  appid: "363890",
  gameName: "RPG Maker MV",
  level: 1,
  cards: [
    {
      name: "Covered Card",
      marketHashName: "363890-Covered",
      owned: 1,
      lowestCents: 38,
      medianCents: 35,
      priceSource: "lowest",
    },
    {
      name: "Her Thanks",
      marketHashName,
      owned: 0,
      lowestCents: 40,
      medianCents: 39,
      priceSource: "lowest",
    },
  ],
}];
state.cfg.buyMode = "complete5";
const activeOrders = new Map([
  ["363890-Covered", { quantity: 3, orderIds: ["1"] }],
]);
elements.set("stch-order-price-source", { value: "highest" });
elements.set("stch-price-adjustment", { value: "0" });
context.window.fetch = async url => {
  assert.match(String(url), /market\/listings\/753\//);
  return {
    ok: true,
    status: 200,
    async text() {
      return listingHtml;
    },
  };
};

const planData = await buildBuyOrderPlan(selected, activeOrders);
assert.equal(planData.plan.length, 1);
assert.equal(planData.plan[0].marketHashName, marketHashName);
assert.equal(planData.plan[0].quantity, 4);
assert.equal(planData.plan[0].unitPriceCents, 24);
assert.equal(planData.skipped.covered, 1);

elements.get("stch-order-price-source").value = "median";
state.highestBuyPrices.clear();
const medianPlan = await buildBuyOrderPlan(selected, activeOrders);
assert.equal(medianPlan.plan[0].unitPriceCents, 39);

elements.get("stch-order-price-source").value = "lowest";
elements.get("stch-price-adjustment").value = "-1";
const clampedPlan = await buildBuyOrderPlan(selected, activeOrders);
assert.equal(clampedPlan.plan[0].unitPriceCents, 21);
assert.equal(clampedPlan.skipped.clamped, 1);

const literalRefs = [
  ...fs.readFileSync(scriptUrl, "utf8").matchAll(
    /getElementById\("([^"]+)"\)/g
  ),
].map(match => match[1]);
const declaredIds = new Set([
  ...fs.readFileSync(scriptUrl, "utf8").matchAll(/id="([^"]+)"/g),
].map(match => match[1]));
const createdIds = new Set([
  ...fs.readFileSync(scriptUrl, "utf8").matchAll(
    /\.id\s*=\s*"([^"]+)"/g
  ),
].map(match => match[1]));
const missingIds = [...new Set(literalRefs)].filter(
  id => !declaredIds.has(id) && !createdIds.has(id)
);
assert.deepEqual(missingIds, []);

const finalSource = fs.readFileSync(scriptUrl, "utf8");
assert.match(finalSource, /@version\s+1\.4\.3/);
assert.match(finalSource, /stch_onboarding_seen/);
assert.doesNotMatch(
  finalSource,
  /Steam Badge Helper|Steam-Badge-Helper|steam-badge-helper|\bsbc\b|\bSBC\b/
);

console.log("Steam Trading Card Helper regression tests passed");
