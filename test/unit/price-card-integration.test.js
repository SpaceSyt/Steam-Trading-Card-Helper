import assert from "node:assert/strict";
import test, { afterEach } from "node:test";

import {
  PRICE_CARD_ERROR_KINDS,
  PRICE_CARD_OUTCOMES,
  applyPriceCardResult,
  isPriceCardError,
  isPriceCardNoPrice,
  isPriceCardPriced,
  priceBadgeCard,
  priceCard,
} from "../../src/parsers/price.js";
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
    if (parsedUrl.pathname.startsWith("/market/listings/")) return { status: 200, text: "" };
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

test("priceCard uses listing orderbook and transaction history before priceoverview", async () => {
  const observedAt = 1_720_000_000_000;
  const now = Math.floor(observedAt / 1000);
  const renderContext = {
    queryData: JSON.stringify({ queries: [
      {
        queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
        state: { data: { amtMinSellOrder: 32, amtMaxBuyOrder: 29, eCurrency: 23 } },
      },
      {
        queryKey: ["market", "pricehistory", 753, MARKET_HASH_NAME],
        state: { data: {
          ecurrency: 23,
          prices: [
            { time: now - 3600, price_median: 0.35, purchases: 7 },
            { time: now - 7200, price_median: 0.34, purchases: 3 },
          ],
        } },
      },
    ] }),
  };
  const html = `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
  const calls = [];
  const queue = {
    async fetch(url, options) {
      calls.push({ url, options });
      return { status: 200, text: html };
    },
  };
  initializeActiveCurrency(23);
  Date.now = () => observedAt;

  const result = await priceCard(MARKET_HASH_NAME, queue, {
    requireMedian: true,
    requireVolume: true,
    persistMarketCache: false,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/market\/listings\/753\//);
  assert.equal(result.lowestSellCents, 32);
  assert.equal(result.medianCents, 35);
  assert.equal(result.volume, 10);
  assert.equal(result.record.source, MARKET_DATA_SOURCES.LISTING_PAGE);
});

function badgePriceQueue(orderbook, history) {
  const queries = Object.entries({ orderbook, pricehistory: history })
    .filter(([, data]) => data != null)
    .map(([type, data]) => ({
      queryKey: ["market", type, 753, MARKET_HASH_NAME],
      state: { data },
    }));
  const envelope = { renderContext: { queryData: JSON.stringify({ queries }) } };
  const text = `<script type="application/json" id="valve-ssr-data">${JSON.stringify(envelope)}</script>`;
  return {
    calls: [],
    async fetch(url) {
      const path = new URL(url).pathname;
      this.calls.push(path);
      if (path.startsWith("/market/listings/")) return { status: 200, text };
      assert.equal(path, "/market/priceoverview/");
      return { status: 200, data: { success: true, lowest_price: "¥ 0.41" } };
    },
  };
}

test("badge scans retain the HTML ask and distinguish absent history from zero recent sales", async () => {
  initializeActiveCurrency(23);
  const book = { eCurrency: 23, amtMinSellOrder: 32 };
  const now = Math.floor(Date.now() / 1000);
  for (const [prices, volume, median] of [
    [undefined, null, null],
    [[], 0, null],
    [[{ time: now - 3 * 86400, price_median: 0.28, purchases: 7 }], 0, null],
    [[{ time: now - 3600, price_median: 0.35, purchases: 7 }], 7, 35],
  ]) {
    const queue = badgePriceQueue(book, prices && { ecurrency: 23, prices });
    const result = await priceBadgeCard(MARKET_HASH_NAME, queue);
    assert.equal(queue.calls.length, 1);
    assert.equal(result.lowestSellCents, 32);
    assert.equal(result.estimated, false);
    assert.equal(result.record.medianMinor, median);
    assert.equal(result.volume, volume);
    assert.equal(result.record.volume, volume);
  }
  assert.equal(gmWrites.length, 0);
});

test("a confirmed HTML median can price a badge card without a sell order", async () => {
  initializeActiveCurrency(23);
  const history = { ecurrency: 23, prices: [
    { time: Math.floor(Date.now() / 1000) - 3600, price_median: 0.35, purchases: 7 },
  ] };
  const queue = badgePriceQueue(null, history);
  const result = await priceBadgeCard(MARKET_HASH_NAME, queue);
  assert.equal(queue.calls.length, 1);
  assert.equal(result.lowestSellCents, 35);
  assert.equal(result.estimated, true);
});

test("badge scans fall back once when HTML provides no usable price in the active currency", async () => {
  initializeActiveCurrency(23);
  for (const [book, history] of [
    [null, null],
    [{ eCurrency: 23, amtMinSellOrder: 0 }, { ecurrency: 23, prices: [] }],
    [{ eCurrency: 1, amtMinSellOrder: 32 }, null],
    [{ amtMinSellOrder: 32 }, { ecurrency: 23, prices: [] }],
    [{ eCurrency: 23, amtMinSellOrder: 32 }, { ecurrency: 1, prices: [] }],
  ]) {
    const queue = badgePriceQueue(book, history);
    const result = await priceBadgeCard(MARKET_HASH_NAME, queue);
    assert.equal(queue.calls.length, 2);
    assert.match(queue.calls[0], /^\/market\/listings\//);
    assert.equal(queue.calls[1], "/market/priceoverview/");
    assert.equal(result.lowestSellCents, 41);
    assert.equal(result.volume, null);
    assert.equal(result.record.source, MARKET_DATA_SOURCES.PRICE_OVERVIEW);
  }
});

test("a confirmed empty sell book needs no second request, while an incomplete book falls back", async () => {
  initializeActiveCurrency(23);
  for (const count of [0, 5]) {
    const queue = badgePriceQueue({ eCurrency: 23, cSellOrders: count }, null);
    const result = await priceCard(MARKET_HASH_NAME, queue);
    assert.equal(queue.calls.length, count ? 2 : 1);
    assert.equal(result.record.lowestSellMinor, count ? 41 : null);
  }
});

test("a rate-limited market listing does not start a priceoverview request", async () => {
  initializeActiveCurrency(23);
  for (const rejected of [true, false]) {
    const calls = [];
    const result = await priceCard(MARKET_HASH_NAME, { async fetch(url) {
      calls.push(new URL(url).pathname);
      if (rejected) throw { status: 429, text: "Too Many Requests" };
      return { status: 429, text: "Too Many Requests" };
    } });
    assert.equal(result.httpStatus, 429);
    assert.deepEqual(calls, ["/market/listings/753/" + encodeURIComponent(MARKET_HASH_NAME)]);
  }
});

test("callers requiring a median or volume still fetch missing data", async () => {
  initializeActiveCurrency(23);
  const optional = badgePriceQueue({ eCurrency: 23, amtMinSellOrder: 32 }, null);
  const item = await priceCard(MARKET_HASH_NAME, optional, { includeHistory: true });
  assert.equal(item.record.lowestSellMinor, 32);
  assert.equal(item.record.volume, null);
  assert.equal(optional.calls.length, 1);
  for (const requirement of ["requireMedian", "requireVolume"]) {
    const queue = badgePriceQueue({ eCurrency: 23, amtMinSellOrder: 32 }, null);
    const result = await priceCard(MARKET_HASH_NAME, queue, {
      [requirement]: true, persistMarketCache: false,
    });
    assert.equal(queue.calls.length, 2);
    assert.equal(result.record.source, MARKET_DATA_SOURCES.PRICE_OVERVIEW);
  }
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

  assert.equal(queue.calls.length, 4);
  for (const [index, currencyId] of [23, 1].entries()) {
    assert.match(queue.calls[index * 2].url.pathname, /^\/market\/listings\/753\//);
    const call = queue.calls[index * 2 + 1];
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
    outcome: PRICE_CARD_OUTCOMES.PRICED,
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
    outcome: PRICE_CARD_OUTCOMES.PRICED,
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

  assert.equal(queue.calls[1].url.searchParams.get("currency"), "23");
  assert.deepEqual(result, {
    outcome: PRICE_CARD_OUTCOMES.NO_PRICE,
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

test("priceCard distinguishes HTTP, network, malformed JSON, and endpoint failures", async () => {
  initializeActiveCurrency(23);
  const cases = [
    {
      label: "HTTP",
      queue: { fetch: async () => { throw { status: 503, error: "unavailable" }; } },
      errorKind: PRICE_CARD_ERROR_KINDS.HTTP,
      httpStatus: 503,
    },
    {
      label: "network",
      queue: { fetch: async () => { throw new Error("offline"); } },
      errorKind: PRICE_CARD_ERROR_KINDS.NETWORK,
      httpStatus: null,
    },
    {
      label: "malformed JSON",
      queue: { fetch: async () => ({ status: 200, text: "<html>", data: null }) },
      errorKind: PRICE_CARD_ERROR_KINDS.PARSE,
      httpStatus: null,
    },
    {
      label: "endpoint failure",
      queue: { fetch: async () => ({ status: 200, text: '{"success":false}', data: { success: false } }) },
      errorKind: PRICE_CARD_ERROR_KINDS.RESPONSE,
      httpStatus: null,
    },
    {
      label: "unparseable price",
      queue: {
        fetch: async () => ({
          status: 200,
          text: '{"success":true,"lowest_price":"not-a-price"}',
          data: { success: true, lowest_price: "not-a-price" },
        }),
      },
      errorKind: PRICE_CARD_ERROR_KINDS.PARSE,
      httpStatus: null,
    },
  ];

  for (const entry of cases) {
    const result = await priceCard(`${MARKET_HASH_NAME}-${entry.label}`, entry.queue);
    assert.equal(isPriceCardError(result), true, entry.label);
    assert.equal(result.outcome, PRICE_CARD_OUTCOMES.ERROR, entry.label);
    assert.equal(result.errorKind, entry.errorKind, entry.label);
    assert.equal(result.httpStatus, entry.httpStatus, entry.label);
    assert.equal(result.record, null, entry.label);
  }

  assert.equal(gmWrites.length, 0);
});

test("structured price results keep failed cards incomplete instead of inventing zero prices", () => {
  const pricedCard = { name: "priced" };
  const missingCard = { name: "missing" };
  const failedCard = { name: "failed" };
  const observedAt = 1_720_000_003_000;

  const priced = applyPriceCardResult(pricedCard, {
    outcome: PRICE_CARD_OUTCOMES.PRICED,
    lowestSellCents: 32,
    medianCents: 35,
    volume: 12,
    estimated: false,
    priceSource: "lowest",
    record: null,
    currencyId: 23,
    observedAt,
  }, 23);
  const noPrice = applyPriceCardResult(missingCard, {
    outcome: PRICE_CARD_OUTCOMES.NO_PRICE,
    noPriceData: true,
    volume: 0,
    record: null,
    currencyId: 23,
    observedAt,
  }, 23);
  const failed = applyPriceCardResult(failedCard, {
    outcome: PRICE_CARD_OUTCOMES.ERROR,
    errorKind: PRICE_CARD_ERROR_KINDS.NETWORK,
    errorMessage: "offline",
    httpStatus: null,
    record: null,
    currencyId: 23,
    observedAt: null,
  }, 23);

  assert.equal(isPriceCardPriced(priced), true);
  assert.equal(isPriceCardNoPrice(noPrice), true);
  assert.equal(isPriceCardError(failed), true);
  assert.equal(pricedCard.lowestCents, 32);
  assert.equal(missingCard.lowestCents, null);
  assert.equal(failedCard.lowestCents, null);
  assert.equal(missingCard.priceSource, "none");
  assert.equal(failedCard.priceSource, "failed");
  assert.equal(failedCard.priceErrorKind, PRICE_CARD_ERROR_KINDS.NETWORK);

  const hasIncompletePricing = [noPrice, failed].some(result => !isPriceCardPriced(result));
  const displayedAggregate = hasIncompletePricing ? null : pricedCard.lowestCents;
  assert.equal(displayedAggregate, null);
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
    pageText: "HK$ 0.26",
    configuredCurrencyId: 23,
  });

  const result = await priceCard(MARKET_HASH_NAME, queue);

  assert.equal(queue.calls[1].url.searchParams.get("currency"), "29");
  assert.equal(result.currencyId, 29);
  assert.equal(result.lowestSellCents, 26);
  assert.equal(result.medianCents, 27);
  assert.equal(result.volume, 9261);
});

test("AUD priceoverview keeps Steam ID 21 and rejects a different wallet's price", async () => {
  initializeActiveCurrency(21);
  const queue = new FakeRequestQueue({ 21: { success: true, lowest_price: "A$ 1.00", median_price: "A$ 0.99" } });
  const price = await priceCard(MARKET_HASH_NAME, queue);
  assert.equal(price.record.lowestSellMinor, 100);
  assert.equal(price.record.currencyCode, "AUD");
  assert.equal(queue.calls[1].url.searchParams.get("currency"), "21");
  const mixed = new FakeRequestQueue({ 21: { success: true, lowest_price: "A$ 1.00", median_price: "$1.00 USD" } });
  assert.ok(isPriceCardError(await priceCard(MARKET_HASH_NAME, mixed)));
  for (const id of [77, null]) {
    initializeCurrencyContext({ walletInfo: { wallet_currency: id } });
    const unknown = new FakeRequestQueue({});
    assert.equal((await priceCard(MARKET_HASH_NAME, unknown)).errorKind, PRICE_CARD_ERROR_KINDS.CURRENCY);
    assert.equal(unknown.calls.some(({ url }) => url.pathname !== "/market/"), false);
  }
});
