import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";

import { RequestQueue } from "../../src/request/queue.js";
import {
  getPriceOverviewRateState,
  resetPriceOverviewRateState,
} from "../../src/request/price-overview-rate.js";

globalThis.GM_getValue = (_key, fallback) => fallback;
globalThis.GM_setValue = () => {};
globalThis.window = { jQuery: null, $: null };
globalThis.unsafeWindow = { jQuery: null, $: null };

const { state } = await import("../../src/state.js");
const {
  clearActiveCurrencyContext,
  setActiveCurrencyContext,
} = await import("../../src/services/currency.js");
const {
  loadSidebarGemPrice,
  resetSessionGemPrice,
} = await import("../../src/sidebar/gems.js");

function makeListingHtml(price = 450, currencyId = 23) {
  const renderContext = {
    queryData: JSON.stringify({ queries: [{
      queryKey: ["market", "orderbook", 753, "753-Sack of Gems"],
      state: { data: {
        amtMinSellOrder: price,
        amtMaxBuyOrder: price - 1,
        eCurrency: currencyId,
      } },
    }] }),
  };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
}

beforeEach(() => {
  resetSessionGemPrice();
  resetPriceOverviewRateState();
  state.cfg.currencyId = 23;
  setActiveCurrencyContext({ wallet_currency: 23, wallet_market_minimum: 7 });
});

afterEach(() => {
  resetSessionGemPrice();
  resetPriceOverviewRateState();
  clearActiveCurrencyContext();
});

test("the session gem request uses listing data without consuming a priceoverview slot", async () => {
  let requestCount = 0;
  const queue = new RequestQueue(0, state, null, null, {
    stopPredicate: () => false,
    fetch: async () => {
      requestCount++;
      return {
        status: 200,
        ok: true,
        text: async () => makeListingHtml(),
      };
    },
  });

  await loadSidebarGemPrice(queue);
  await loadSidebarGemPrice(queue);

  assert.equal(requestCount, 1);
  assert.equal(getPriceOverviewRateState().count, 0);
  queue.stop();
});

test("gem price is requested once per page session without 429 retries", async () => {
  const calls = [];
  const firstQueue = {
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        status: 200,
        text: makeListingHtml(),
      };
    },
  };
  const unusedQueue = {
    async fetch() {
      assert.fail("session gem price should not be requested again");
    },
  };

  const first = await loadSidebarGemPrice(firstQueue);
  const second = await loadSidebarGemPrice(unusedQueue);

  assert.strictEqual(second, first);
  assert.equal(first.priceCents, 450);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.requestPolicy, "default");

  resetSessionGemPrice();
  await loadSidebarGemPrice(firstQueue);
  assert.equal(calls.length, 2);
});

test("changing the active currency replaces a pending session gem quote", async () => {
  let finishUsd;
  setActiveCurrencyContext({ wallet_currency: 1, wallet_market_minimum: 1 });
  const usd = loadSidebarGemPrice({
    fetch: () => new Promise(resolve => { finishUsd = resolve; }),
  });
  setActiveCurrencyContext({ wallet_currency: 23, wallet_market_minimum: 7 });
  const cny = loadSidebarGemPrice({
    fetch: async () => ({ status: 200, text: makeListingHtml(435, 23) }),
  });
  await Promise.resolve();
  finishUsd({ status: 200, text: makeListingHtml(60, 1) });

  assert.equal((await usd).currencyId, 1);
  assert.equal((await cny).currencyId, 23);
  assert.equal((await cny).priceCents, 435);
  assert.strictEqual(loadSidebarGemPrice(), cny);
});

test("gem price falls back to one-shot priceoverview when listing parsing fails", async () => {
  const calls = [];
  const queue = {
    async fetch(url, options) {
      calls.push({ url, options });
      if (url.includes("/market/listings/")) return { status: 200, text: "invalid" };
      return {
        status: 200,
        data: { success: true, lowest_price: "¥ 4.50", median_price: "¥ 4.55", volume: "100" },
      };
    },
  };

  const price = await loadSidebarGemPrice(queue);
  assert.equal(price.priceCents, 450);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].options.requestPolicy, {
    base: "priceoverview",
    retry429: false,
  });
});
