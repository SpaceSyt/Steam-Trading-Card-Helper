import assert from "node:assert/strict";
import test from "node:test";

import {
  createBadgePriceScheduler,
  createRequestQueuePool,
  getHtmlRequestConcurrency,
  getOtherRequestConcurrency,
  runWithConcurrency,
} from "../../src/utils/concurrency.js";

test("badge listings continue across sets while one fallback waits and another is skipped", async () => {
  let resume;
  const waiting = new Promise(resolve => { resume = resolve; });
  const overviews = [];
  const schedule = createBadgePriceScheduler({ fetch(card) { overviews.push(card); return waiting; } });
  const htmlQueue = { async fetch(card) { return card.startsWith("priced"); } };
  const results = [];
  async function priceOne(card, queue) {
    if (!await queue.fetch(card, { requestPolicy: "default" })) {
      await queue.fetch(card, { requestPolicy: "priceoverview" });
    }
    results.push(card);
  }
  const first = await schedule(["missing", "priced A"], 1, htmlQueue, () => false, priceOne);
  let skip = false;
  const second = await schedule(["skipped"], 1, htmlQueue, () => skip, priceOne);
  skip = true;
  const third = await schedule(["priced C"], 1, htmlQueue, () => false, priceOne);
  await third.complete;
  assert.deepEqual(results, ["priced A", "priced C"]);
  assert.deepEqual(overviews, ["missing"]);
  resume();
  await first.complete;
  await assert.rejects(second.complete, error => error.error === "skipped");
  assert.deepEqual(overviews, ["missing"]);
  assert.deepEqual(results, ["priced A", "priced C", "missing"]);
});

test("HTML request concurrency uses the shared setting", () => {
  assert.equal(getHtmlRequestConcurrency({ parallelOrderPricingEnabled: false }), 1);
  assert.equal(getHtmlRequestConcurrency({
    parallelOrderPricingEnabled: true,
    parallelOrderPricingConcurrency: 6,
  }), 6);
});

test("other request concurrency defaults to enabled with eight workers", () => {
  assert.equal(getOtherRequestConcurrency({}), 8);
  assert.equal(getOtherRequestConcurrency({ parallelOtherRequestsEnabled: false }), 1);
  assert.equal(getOtherRequestConcurrency({
    parallelOtherRequestsEnabled: true,
    parallelOtherRequestsConcurrency: 12,
  }), 12);
});

test("request queue pool balances work and stops every queue", async () => {
  const queues = Array.from({ length: 3 }, () => ({
    stopped: false,
    active: 0,
    async fetch(value) {
      this.active++;
      await new Promise(resolve => setTimeout(resolve, 5));
      this.active--;
      return value;
    },
    stop() { this.stopped = true; },
  }));
  let next = 0;
  const pool = createRequestQueuePool(3, () => queues[next++]);
  assert.deepEqual(await Promise.all([1, 2, 3, 4, 5].map(value => pool.fetch(value))), [1, 2, 3, 4, 5]);
  pool.stop();
  assert.equal(pool.stopped, true);
  assert.ok(queues.every(queue => queue.stopped));
});

test("request queue pool creates workers only when needed", async () => {
  let created = 0;
  const pool = createRequestQueuePool(8, () => {
    created++;
    return {
      stopped: false,
      async fetch(value) { return value; },
      stop() { this.stopped = true; },
    };
  });
  assert.equal(await pool.fetch("one"), "one");
  assert.equal(created, 1);
  pool.stop();
});

test("shared concurrency runner respects its worker limit", async () => {
  let active = 0;
  let peak = 0;
  await runWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
  });
  assert.equal(peak, 2);
});
