import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBlacklistPriceEntry,
  parseBlacklistPriceData,
  setBlacklistPriceEntry,
} from "../../src/services/blacklist-price.js";

test("blacklist price entries preserve price, currency, and accuracy", () => {
  assert.deepEqual(normalizeBlacklistPriceEntry({
    priceMinor: 428,
    currencyId: 23,
    accuracy: "exact",
    reason: "complete",
    observedAt: 1234.9,
  }), {
    priceMinor: 428,
    currencyId: 23,
    accuracy: "exact",
    reason: "complete",
    observedAt: 1234,
  });
});

test("blacklist price storage drops malformed appids and entries", () => {
  assert.deepEqual(parseBlacklistPriceData(JSON.stringify({
    123: { priceMinor: 99, currencyId: 23, accuracy: "estimated", reason: "prediction" },
    bad: { priceMinor: 100, currencyId: 23, accuracy: "exact" },
    456: { priceMinor: -1, currencyId: 23, accuracy: "exact" },
  })), {
    123: {
      priceMinor: 99,
      currencyId: 23,
      accuracy: "estimated",
      reason: "prediction",
      observedAt: 0,
    },
  });
});

test("setting a blacklist price entry keeps other valid games", () => {
  const updated = setBlacklistPriceEntry({
    123: { priceMinor: 99, currencyId: 23, accuracy: "exact" },
  }, "456", {
    priceMinor: 250,
    currencyId: 1,
    accuracy: "estimated",
    reason: "fallback",
  });
  assert.equal(updated["123"].priceMinor, 99);
  assert.equal(updated["456"].currencyId, 1);
  assert.equal(updated["456"].accuracy, "estimated");
});
