import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePriceOverviewCycleTiming,
  formatTimingSeconds,
} from "../../src/services/request-timing.js";

test("priceoverview cycle timing uses interval times batch plus the pause", () => {
  assert.deepEqual(calculatePriceOverviewCycleTiming(350, 20, 53000), {
    requestIntervalMs: 350,
    batchSize: 20,
    pauseMs: 53000,
    requestDurationMs: 7000,
    cycleDurationMs: 60000,
  });
});

test("cycle timing normalizes invalid inputs and formats fractional seconds", () => {
  assert.deepEqual(calculatePriceOverviewCycleTiming(-10, 0, "bad"), {
    requestIntervalMs: 0,
    batchSize: 1,
    pauseMs: 0,
    requestDurationMs: 0,
    cycleDurationMs: 0,
  });
  assert.equal(formatTimingSeconds(6600), "6.6");
  assert.equal(formatTimingSeconds(60000), "60");
});
