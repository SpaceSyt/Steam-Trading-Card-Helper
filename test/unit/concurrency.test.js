import assert from "node:assert/strict";
import test from "node:test";

import {
  createRequestQueuePool,
  getHtmlRequestConcurrency,
  getOtherRequestConcurrency,
  runWithConcurrency,
} from "../../src/utils/concurrency.js";

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
