import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  aggregateActiveBuyOrders,
  isCancelBuyOrderResponseSuccessful,
  parseActiveBuyOrdersResponse,
} from "../../src/services/active-buy-orders.js";

const fixtureUrl = new URL("../fixtures-public/market/mylistings-buy-orders.json", import.meta.url);

test("parses localized active buy order rows without DOM globals", async () => {
  const data = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const snapshot = parseActiveBuyOrdersResponse(data, { minorDigits: 2, observedAt: 1234 });

  assert.equal(snapshot.detectedRowCount, 4);
  assert.equal(snapshot.orders.length, 3);
  assert.equal(snapshot.diagnostics.length, 1);
  assert.equal(snapshot.diagnostics[0].code, "missing-listing-identity");
  assert.deepEqual(snapshot.orders[0], {
    orderId: "10001",
    appid: "753",
    marketHashName: "100-Test Card",
    displayName: "Test & Card",
    gameName: "Fixture Game Trading Card",
    imageUrl: "https://example.invalid/a.png",
    listingUrl: "https://steamcommunity.com/market/listings/753/100-Test%20Card",
    remainingQuantity: 2,
    unitPriceMinor: 26,
    frozenMinor: 52,
  });
  assert.equal(snapshot.observedAt, 1234);
  assert.equal(snapshot.sellListingCount, 2);
});

test("aggregates duplicate item orders and preserves exact order ids", async () => {
  const data = JSON.parse(await readFile(fixtureUrl, "utf8"));
  const groups = aggregateActiveBuyOrders(parseActiveBuyOrdersResponse(data).orders);
  const group = groups.find(item => item.marketHashName === "100-Test Card");

  assert.equal(groups.length, 2);
  assert.equal(group.orderCount, 2);
  assert.equal(group.remainingQuantity, 3);
  assert.equal(group.frozenMinor, 79);
  assert.equal(group.minPriceMinor, 26);
  assert.equal(group.maxPriceMinor, 27);
  assert.deepEqual(group.orders.map(order => order.orderId), ["10001", "10002"]);
});

test("buy-order rows are independent of sell-listing pagination metadata", async () => {
  const data = JSON.parse(await readFile(fixtureUrl, "utf8"));
  data.pagesize = 1;
  data.total_count = 44;
  const snapshot = parseActiveBuyOrdersResponse(data);

  assert.equal(snapshot.pageSize, 1);
  assert.equal(snapshot.sellListingCount, 44);
  assert.equal(snapshot.detectedRowCount, 4);
  assert.equal(snapshot.orders.length, 3);
});

test("rejects unsuccessful mylistings responses", () => {
  assert.throws(
    () => parseActiveBuyOrdersResponse({ success: false, results_html: "" }),
    /未返回现有订购单/
  );
});

test("requires an unambiguous successful cancellation response", () => {
  assert.equal(isCancelBuyOrderResponseSuccessful(true, {}), false);
  assert.equal(isCancelBuyOrderResponseSuccessful(true, { success: 1 }), true);
  assert.equal(isCancelBuyOrderResponseSuccessful(true, { success: true }), false);
  assert.equal(isCancelBuyOrderResponseSuccessful(true, { success: "1" }), false);
  assert.equal(isCancelBuyOrderResponseSuccessful(true, { success: 0 }), false);
  assert.equal(isCancelBuyOrderResponseSuccessful(false, { success: 1 }), false);
  assert.equal(isCancelBuyOrderResponseSuccessful(true, null), false);
});
