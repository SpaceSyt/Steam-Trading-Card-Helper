import assert from "node:assert/strict";
import test from "node:test";

import {
  getHtmlRequestConcurrency,
  runWithConcurrency,
} from "../../src/utils/concurrency.js";

test("HTML request concurrency uses the shared setting", () => {
  assert.equal(getHtmlRequestConcurrency({ parallelOrderPricingEnabled: false }), 1);
  assert.equal(getHtmlRequestConcurrency({
    parallelOrderPricingEnabled: true,
    parallelOrderPricingConcurrency: 6,
  }), 6);
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
