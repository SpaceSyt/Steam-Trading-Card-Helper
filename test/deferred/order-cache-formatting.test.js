import assert from "node:assert/strict";
import test from "node:test";
import { applyOrderCacheFormatting, formatCNY } from "../../src/deferred/order-cache-formatting.js";

test("CNY compatibility formatting omits grouping", () => {
  assert.equal(formatCNY(123456), "1234.56");
});

test("deferred formatted fields preserve unavailable prices", () => {
  const result = applyOrderCacheFormatting({ currencyId: 23, hasIncompletePricing: true });
  for (const field of ["cheapestSetFormatted", "fullSetFormatted", "level5Formatted", "cheapestSetCNY", "fullSetCNY", "level5CNY"]) {
    assert.equal(result[field], "-");
  }
});
