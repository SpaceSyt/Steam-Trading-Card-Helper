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
  getCurrencyContextById,
  setActiveCurrencyContext,
} = await import("../../src/services/currency.js");
const {
  loadSidebarGemPrice,
  resetSessionGemPrice,
} = await import("../../src/sidebar/gems.js");

beforeEach(() => {
  resetSessionGemPrice();
  resetPriceOverviewRateState();
  state.cfg.currencyId = 23;
  setActiveCurrencyContext(getCurrencyContextById(23));
});

afterEach(() => {
  resetSessionGemPrice();
  resetPriceOverviewRateState();
  clearActiveCurrencyContext();
});

test("the session gem request consumes one shared priceoverview slot", async () => {
  let requestCount = 0;
  const queue = new RequestQueue(0, state, null, null, {
    stopPredicate: () => false,
    fetch: async () => {
      requestCount++;
      return {
        status: 200,
        ok: true,
        text: async () => JSON.stringify({
          success: true,
          lowest_price: "¥ 4.50",
          median_price: "¥ 4.55",
          volume: "100",
        }),
      };
    },
  });

  await loadSidebarGemPrice(queue);
  await loadSidebarGemPrice(queue);

  assert.equal(requestCount, 1);
  assert.equal(getPriceOverviewRateState().count, 1);
  queue.stop();
});

test("gem price is requested once per page session without 429 retries", async () => {
  const calls = [];
  const firstQueue = {
    async fetch(url, options) {
      calls.push({ url, options });
      return {
        status: 200,
        data: {
          success: true,
          lowest_price: "¥ 4.50",
          median_price: "¥ 4.55",
          volume: "100",
        },
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
  assert.deepEqual(calls[0].options.requestPolicy, {
    base: "priceoverview",
    retry429: false,
  });
});
