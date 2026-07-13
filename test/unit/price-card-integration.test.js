import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import { priceCard } from "../../src/parsers/price.js";
import {
  clearActiveCurrencyContext,
  getActiveCurrencyContext,
  initializeCurrencyContext,
} from "../../src/services/currency.js";
import {
  MARKET_CACHE_STORAGE_KEY,
  findMarketCache,
  loadMarketCache,
} from "../../src/services/market-cache.js";
import {
  MARKET_HISTORY_STORAGE_KEY,
  loadMarketHistory,
  selectMarketHistoryRecords,
} from "../../src/services/market-history.js";
import {
  MARKET_DATA_SCHEMA_VERSION,
  MARKET_DATA_SOURCES,
} from "../../src/services/market-data.js";

const MARKET_HASH_NAME = "570-Price Card Integration Test";
const originalDateNow = Date.now;
const gmStore = new Map();
let gmWrites = [];

function gmGetValue(key, fallback) {
  return gmStore.has(key) ? gmStore.get(key) : fallback;
}

function gmSetValue(key, value) {
  gmWrites.push({ key, value });
  gmStore.set(key, value);
}

globalThis.GM_getValue = gmGetValue;
globalThis.GM_setValue = gmSetValue;

class FakeRequestQueue {
  constructor(payloadByCurrency) {
    this.payloadByCurrency = payloadByCurrency;
    this.calls = [];
  }

  async fetch(url, options = {}) {
    const parsedUrl = new URL(url);
    this.calls.push({ url: parsedUrl, options });
    const payload = this.payloadByCurrency[parsedUrl.searchParams.get("currency")];
    assert.ok(payload, `missing synthetic payload for ${parsedUrl.href}`);
    return {
      status: 200,
      text: JSON.stringify(payload),
      data: structuredClone(payload),
    };
  }
}

function initializeActiveCurrency(currencyId) {
  const context = initializeCurrencyContext({
    walletInfo: { wallet_currency: currencyId },
    configuredCurrencyId: currencyId === 23 ? 1 : 23,
  });
  assert.strictEqual(getActiveCurrencyContext(), context);
  assert.equal(context.currencyId, currencyId);
  return context;
}

function expectedRecord({
  currencyId,
  currencyCode,
  lowestSellMinor,
  medianMinor,
  volume,
  observedAt,
}) {
  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    appid: "753",
    marketHashName: MARKET_HASH_NAME,
    currencyId,
    currencyCode,
    lowestSellMinor,
    medianMinor,
    highestBuyMinor: null,
    volume,
    observedAt,
    source: MARKET_DATA_SOURCES.PRICE_OVERVIEW,
  };
}

afterEach(() => {
  clearActiveCurrencyContext();
  gmStore.clear();
  gmWrites = [];
  Date.now = originalDateNow;
});

test("priceCard follows the active CNY/USD context and keeps their cached records isolated", async () => {
  const queue = new FakeRequestQueue({
    23: {
      success: true,
      lowest_price: "\u00a5 0.32",
      median_price: "\u00a5 0.35",
      volume: "1,234",
    },
    1: {
      success: true,
      lowest_price: "$0.03",
      median_price: "$0.04",
      volume: "987",
    },
  });
  const cnyObservedAt = 1_720_000_000_000;
  const usdObservedAt = 1_720_000_001_000;
  const persistenceResults = [];

  initializeActiveCurrency(23);
  Date.now = () => cnyObservedAt;
  const cnyResult = await priceCard(MARKET_HASH_NAME, queue, {
    onPersist: result => persistenceResults.push(result),
  });

  initializeActiveCurrency(1);
  Date.now = () => usdObservedAt;
  const usdResult = await priceCard(MARKET_HASH_NAME, queue, {
    onPersist: result => persistenceResults.push(result),
  });

  assert.equal(queue.calls.length, 2);
  for (const [call, currencyId] of queue.calls.map((call, index) => [call, [23, 1][index]])) {
    assert.equal(call.url.origin, "https://steamcommunity.com");
    assert.equal(call.url.pathname, "/market/priceoverview/");
    assert.equal(call.url.searchParams.get("appid"), "753");
    assert.equal(call.url.searchParams.get("market_hash_name"), MARKET_HASH_NAME);
    assert.equal(call.url.searchParams.get("currency"), String(currencyId));
    assert.equal(call.options.requestPolicy, "priceoverview");
  }

  const cnyRecord = expectedRecord({
    currencyId: 23,
    currencyCode: "CNY",
    lowestSellMinor: 32,
    medianMinor: 35,
    volume: 1234,
    observedAt: cnyObservedAt,
  });
  const usdRecord = expectedRecord({
    currencyId: 1,
    currencyCode: "USD",
    lowestSellMinor: 3,
    medianMinor: 4,
    volume: 987,
    observedAt: usdObservedAt,
  });

  assert.deepEqual(cnyResult, {
    lowestSellCents: 32,
    medianCents: 35,
    volume: 1234,
    estimated: false,
    priceSource: "lowest",
    record: cnyRecord,
    currencyId: 23,
    observedAt: cnyObservedAt,
  });
  assert.deepEqual(usdResult, {
    lowestSellCents: 3,
    medianCents: 4,
    volume: 987,
    estimated: false,
    priceSource: "lowest",
    record: usdRecord,
    currencyId: 1,
    observedAt: usdObservedAt,
  });

  assert.equal(gmWrites.length, 4);
  assert.equal(gmWrites.filter(write => write.key === MARKET_CACHE_STORAGE_KEY).length, 2);
  assert.equal(gmWrites.filter(write => write.key === MARKET_HISTORY_STORAGE_KEY).length, 2);
  assert.equal(persistenceResults.length, 2);
  assert.ok(persistenceResults.every(result => result.history?.saved === true));
  const loaded = loadMarketCache({ getValue: gmGetValue });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.envelope.records.length, 2);
  assert.deepEqual(findMarketCache(loaded.envelope, cnyRecord), cnyRecord);
  assert.deepEqual(findMarketCache(loaded.envelope, usdRecord), usdRecord);
  assert.equal(findMarketCache(loaded.envelope, { ...cnyRecord, currencyId: 1 }).lowestSellMinor, 3);

  const history = loadMarketHistory({ getValue: gmGetValue });
  assert.equal(history.ok, true);
  assert.deepEqual(
    selectMarketHistoryRecords(history.envelope, cnyRecord, { ttlMs: Infinity }),
    [cnyRecord]
  );
  assert.deepEqual(
    selectMarketHistoryRecords(history.envelope, usdRecord, { ttlMs: Infinity }),
    [usdRecord]
  );
});

test("priceCard preserves a successful response with no price data", async () => {
  const observedAt = 1_720_000_002_000;
  const queue = new FakeRequestQueue({
    23: { success: true },
  });
  initializeActiveCurrency(23);
  Date.now = () => observedAt;

  const result = await priceCard(MARKET_HASH_NAME, queue);
  const record = expectedRecord({
    currencyId: 23,
    currencyCode: "CNY",
    lowestSellMinor: null,
    medianMinor: null,
    volume: null,
    observedAt,
  });

  assert.equal(queue.calls[0].url.searchParams.get("currency"), "23");
  assert.deepEqual(result, {
    noPriceData: true,
    volume: 0,
    record,
    currencyId: 23,
    observedAt,
  });

  const loaded = loadMarketCache();
  assert.equal(loaded.ok, true);
  assert.deepEqual(findMarketCache(loaded.envelope, record), record);
  assert.equal(gmStore.has(MARKET_HISTORY_STORAGE_KEY), false);
});

test("priceCard reports a history persistence failure without overwriting corrupt data", async () => {
  const corruptHistory = "{not-json";
  gmStore.set(MARKET_HISTORY_STORAGE_KEY, corruptHistory);
  const queue = new FakeRequestQueue({
    23: {
      success: true,
      lowest_price: "\u00a5 0.32",
      median_price: "\u00a5 0.35",
      volume: "12",
    },
  });
  initializeActiveCurrency(23);
  let persistence = null;
  const originalWarn = console.warn;
  console.warn = () => {};

  let result;
  try {
    result = await priceCard(MARKET_HASH_NAME, queue, {
      onPersist: value => { persistence = value; },
    });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(result.lowestSellCents, 32);
  assert.equal(persistence.cache.saved, true);
  assert.equal(persistence.history.ok, false);
  assert.equal(persistence.history.saved, false);
  assert.equal(gmStore.get(MARKET_HISTORY_STORAGE_KEY), corruptHistory);
});

test("priceCard can defer persistence for a batch caller without changing its result", async () => {
  const observedAt = 1_720_000_002_500;
  const queue = new FakeRequestQueue({
    23: {
      success: true,
      lowest_price: "\u00a5 0.32",
      median_price: "\u00a5 0.35",
      volume: "123",
    },
  });
  initializeActiveCurrency(23);
  Date.now = () => observedAt;

  const result = await priceCard(MARKET_HASH_NAME, queue, { persistMarketCache: false });

  assert.equal(result.lowestSellCents, 32);
  assert.equal(result.record.observedAt, observedAt);
  assert.equal(gmWrites.length, 0);
  assert.equal(gmStore.has(MARKET_CACHE_STORAGE_KEY), false);
  assert.equal(gmStore.has(MARKET_HISTORY_STORAGE_KEY), false);
});

test("an HKD page context sends currency 29 instead of the configured CNY fallback", async () => {
  const queue = new FakeRequestQueue({
    29: {
      success: true,
      lowest_price: "HK$ 0.26",
      median_price: "HK$ 0.27",
      volume: "9,261",
    },
  });
  initializeCurrencyContext({
    walletInfo: null,
    pageHtml: "filterConfig={\\\"currency\\\":{\\\"eCurrency\\\":29}}",
    configuredCurrencyId: 23,
  });

  const result = await priceCard(MARKET_HASH_NAME, queue);

  assert.equal(queue.calls[0].url.searchParams.get("currency"), "29");
  assert.equal(result.currencyId, 29);
  assert.equal(result.lowestSellCents, 26);
  assert.equal(result.medianCents, 27);
  assert.equal(result.volume, 9261);
});
