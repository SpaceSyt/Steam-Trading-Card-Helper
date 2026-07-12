import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MARKET_DATA_SCHEMA_VERSION,
  MARKET_DATA_SOURCES,
  fromLegacyPriceResult,
  normalizeItemOrdersHistogram,
  normalizeListingOrderbook,
  normalizePriceHistory,
  normalizePriceOverview,
  parseMajorAmountToMinor,
  toLegacyPriceResult,
} from "../../src/services/market-data.js";

async function readFixture(name) {
  const url = new URL(`../fixtures-public/market/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

const baseContext = Object.freeze({
  appid: 753,
  marketHashName: "570-Test Synthetic Card",
  observedAt: 1_720_000_000_000,
  minorDigits: 2,
});

test("priceoverview produces canonical CNY, USD, and HKD records in minor units", async () => {
  const [cnyPayload, usdPayload, hkdPayload] = await Promise.all([
    readFixture("priceoverview-cny.json"),
    readFixture("priceoverview-usd.json"),
    readFixture("priceoverview-hkd.json"),
  ]);

  const cny = normalizePriceOverview(cnyPayload, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "cny",
  });
  const usd = normalizePriceOverview(usdPayload, {
    ...baseContext,
    currencyId: 1,
    currencyCode: "usd",
  });
  const hkd = normalizePriceOverview(hkdPayload, {
    ...baseContext,
    currencyId: 29,
    currencyCode: "hkd",
  });

  assert.deepEqual(cny, {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    appid: "753",
    marketHashName: baseContext.marketHashName,
    currencyId: 23,
    currencyCode: "CNY",
    lowestSellMinor: 32,
    medianMinor: 35,
    highestBuyMinor: null,
    volume: 1234,
    observedAt: baseContext.observedAt,
    source: MARKET_DATA_SOURCES.PRICE_OVERVIEW,
  });
  assert.equal(usd.currencyId, 1);
  assert.equal(usd.currencyCode, "USD");
  assert.equal(usd.lowestSellMinor, 3);
  assert.equal(usd.medianMinor, 4);
  assert.equal(usd.volume, 987);
  assert.equal(hkd.currencyId, 29);
  assert.equal(hkd.currencyCode, "HKD");
  assert.equal(hkd.lowestSellMinor, 31);
  assert.equal(hkd.medianMinor, 31);
  assert.equal(hkd.volume, 9034);
});

test("missing endpoint prices stay null instead of becoming zero", () => {
  const record = normalizePriceOverview({ success: true }, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });

  assert.equal(record.lowestSellMinor, null);
  assert.equal(record.medianMinor, null);
  assert.equal(record.highestBuyMinor, null);
  assert.equal(record.volume, null);

  const zeroSentinels = normalizeItemOrdersHistogram({
    success: 1,
    lowest_sell_order: "0",
    highest_buy_order: 0,
  }, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });
  assert.equal(zeroSentinels.lowestSellMinor, null);
  assert.equal(zeroSentinels.highestBuyMinor, null);
});

test("explicit endpoint failures are not cacheable observations", () => {
  const context = { ...baseContext, currencyId: 23, currencyCode: "CNY" };
  assert.equal(normalizePriceOverview({ success: false }, context), null);
  assert.equal(normalizeItemOrdersHistogram({ success: 0 }, context), null);
  assert.deepEqual(normalizePriceHistory({ success: false, prices: [] }, context), []);
});

test("localized major-unit parsing handles decimal and thousands separators", () => {
  assert.equal(parseMajorAmountToMinor("¥ 1,234.56", 2), 123456);
  assert.equal(parseMajorAmountToMinor("1.234,56 €", 2), 123456);
  assert.equal(parseMajorAmountToMinor("1,234", 2), 123400);
  assert.equal(parseMajorAmountToMinor("-0.01", 2), null);
});

test("listing orderbook uses only explicit minor-unit order fields", async () => {
  const payload = await readFixture("listing-orderbook.json");
  const record = normalizeListingOrderbook(payload, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });

  assert.equal(record.lowestSellMinor, 32);
  assert.equal(record.highestBuyMinor, 29);
  assert.equal(record.medianMinor, null);
  assert.equal(record.volume, null);
  assert.equal(record.currencyId, 23);
  assert.equal(record.source, MARKET_DATA_SOURCES.LISTING_ORDERBOOK);
});

test("listing payload currency wins and a mismatched context code is discarded", async () => {
  const payload = await readFixture("listing-orderbook.json");
  const record = normalizeListingOrderbook(payload, {
    ...baseContext,
    currencyId: 1,
    currencyCode: "USD",
  });

  assert.equal(record.currencyId, 23);
  assert.equal(record.currencyCode, null);
});

test("itemordershistogram does not infer prices from graph or table text", async () => {
  const payload = await readFixture("itemordershistogram.json");
  const record = normalizeItemOrdersHistogram({ data: payload }, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });

  assert.equal(record.lowestSellMinor, 32);
  assert.equal(record.highestBuyMinor, 29);
  assert.equal(record.medianMinor, null);
  assert.equal(record.volume, null);
  assert.equal(record.source, MARKET_DATA_SOURCES.ITEM_ORDERS_HISTOGRAM);
});

test("price history creates one timestamped canonical record per valid tuple", async () => {
  const payload = await readFixture("price-history.json");
  const records = normalizePriceHistory(payload, {
    ...baseContext,
    currencyId: 1,
    currencyCode: "USD",
  });

  assert.equal(records.length, 2);
  assert.deepEqual(records.map(record => record.medianMinor), [31, 32]);
  assert.deepEqual(records.map(record => record.volume), [12, 18]);
  assert.equal(records[0].observedAt, Date.parse("Jul 10 2026 01: +0"));
  assert.equal(records[0].lowestSellMinor, null);
  assert.equal(records[0].highestBuyMinor, null);
  assert.equal(records[0].source, MARKET_DATA_SOURCES.PRICE_HISTORY);
});

test("canonical records convert to the legacy effective-sell shape", async () => {
  const payload = await readFixture("priceoverview-cny.json");
  const record = normalizePriceOverview(payload, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });
  assert.deepEqual(toLegacyPriceResult(record), {
    lowestSellCents: 32,
    medianCents: 35,
    volume: 1234,
    estimated: false,
    priceSource: "lowest",
  });

  const medianOnly = normalizePriceOverview({ success: true, median_price: "¥ 0.35" }, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });
  assert.deepEqual(toLegacyPriceResult(medianOnly), {
    lowestSellCents: 35,
    medianCents: 35,
    volume: 0,
    estimated: true,
    priceSource: "median",
  });
});

test("legacy zero sentinels migrate to null standard prices", () => {
  const record = fromLegacyPriceResult({
    noPriceData: true,
    lowestSellCents: 0,
    medianCents: 0,
    volume: 0,
  }, {
    ...baseContext,
    currencyId: 23,
    currencyCode: "CNY",
  });

  assert.equal(record.lowestSellMinor, null);
  assert.equal(record.medianMinor, null);
  assert.equal(record.highestBuyMinor, null);
  assert.equal(record.volume, 0);
  assert.equal(record.source, MARKET_DATA_SOURCES.LEGACY_PRICE_RESULT);
});
