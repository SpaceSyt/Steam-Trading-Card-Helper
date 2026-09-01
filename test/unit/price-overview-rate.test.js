import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  getPriceOverviewRateState,
  reservePriceOverviewRequest,
  resetPriceOverviewRateState,
} from "../../src/request/price-overview-rate.js";

afterEach(resetPriceOverviewRateState);

test("priceoverview requests share a fixed 20 request window", () => {
  for (let index = 0; index < 20; index++) {
    assert.equal(reservePriceOverviewRequest(1000), 0);
  }
  assert.deepEqual(getPriceOverviewRateState(1000), {
    count: 20,
    limit: 20,
    resetInMs: 60000,
  });
  assert.equal(reservePriceOverviewRequest(1000), 60000);
  assert.equal(reservePriceOverviewRequest(60999), 1);
  assert.equal(reservePriceOverviewRequest(61000), 0);
  assert.deepEqual(getPriceOverviewRateState(61000), {
    count: 1,
    limit: 20,
    resetInMs: 60000,
  });
});
