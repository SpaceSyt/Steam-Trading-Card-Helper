import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMarketOrderDepthFromListingHtml,
  parseMarketListingSnapshotFromHtml,
  parseMarketListingWithDepthFromHtml,
  parseMarketOrderbookFromListingHtml,
} from "../../src/parsers/market-listing.js";

const MARKET_HASH_NAME = "753-Sack of Gems";

function makeSsrHtml(queries) {
  const renderContext = {
    queryData: JSON.stringify({ queries }),
  };
  return `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(JSON.stringify(renderContext))});</script>`;
}

test("listing SSR snapshot includes order counts, description name, and image", () => {
  const html = makeSsrHtml([
    {
      queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
      state: {
        data: {
          amtMinSellOrder: 32,
          amtMaxBuyOrder: 29,
          eCurrency: 23,
          cSellOrders: "28,684",
          cBuyOrders: 4102,
        },
      },
    },
    {
      queryKey: ["market", "description", 753, MARKET_HASH_NAME],
      state: {
        data: {
          name: "Sack of Gems",
          icon_url: "synthetic/icon/path",
          icon_url_large: "synthetic/large/icon/path",
        },
      },
    },
  ]);

  const snapshot = parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME);
  assert.deepEqual(snapshot, {
    highestBuyCents: 29,
    lowestSellCents: 32,
    currency: 23,
    noBuyOrders: false,
    sellOrderCount: 28684,
    displayName: "Sack of Gems",
    imageUrl: "https://community.fastly.steamstatic.com/economy/image/synthetic/large/icon/path",
  });
  assert.deepEqual(
    parseMarketOrderbookFromListingHtml(html, MARKET_HASH_NAME),
    snapshot
  );
});

test("malformed history leaves orderbook prices available and volume unknown", () => {
  const now = Math.floor(Date.now() / 1000);
  for (const prices of [undefined, null, {}, [{}], [{ time: now, purchases: 1 }]]) {
    const html = makeSsrHtml([
      {
        queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
        state: { data: { amtMinSellOrder: 32, amtMaxBuyOrder: 29, eCurrency: 23 } },
      },
      {
        queryKey: ["market", "pricehistory", 753, MARKET_HASH_NAME],
        state: { data: { ecurrency: 23, prices } },
      },
    ]);
    const snapshot = parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME);
    assert.equal(snapshot?.lowestSellCents, 32);
    assert.equal(snapshot.highestBuyCents, 29);
    assert.equal(snapshot.volume, undefined);
  }
});

test("listing SSR derives recent median and volume from transaction history", () => {
  const now = Math.floor(Date.now() / 1000);
  const html = makeSsrHtml([
    {
      queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
      state: { data: { amtMinSellOrder: 448, amtMaxBuyOrder: 440, eCurrency: 23 } },
    },
    {
      queryKey: ["market", "pricehistory", 753, MARKET_HASH_NAME],
      state: { data: {
        ecurrency: 23,
        prices: [
          { time: now - 23 * 60 * 60, price_median: 4.47, purchases: 2 },
          { time: now - 2 * 60 * 60, price_median: 4.49, purchases: 5 },
          { time: now - 60 * 60, price_median: 4.50, purchases: 3 },
          { time: now - 30 * 60 * 60, price_median: 4.30, purchases: 99 },
        ],
      } },
    },
  ]);

  const snapshot = parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME);
  assert.equal(snapshot.historyCurrency, 23);
  assert.equal(snapshot.medianPriceMajor, 4.49);
  assert.equal(snapshot.volume, 10);
});

test("history alone supplies recent sales or confirms zero recent volume", () => {
  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;
  const oldSale = { time: now - 27 * hour, price_median: 5, purchases: 6 };
  const sales = [
    { time: now - 25 * hour, price_median: "bad" },
    { time: now, price_median: 1, purchases: 2 },
    oldSale,
  ];
  for (const [prices, volume, median] of [[sales, 2, 1], [[oldSale], 0, null], [[], 0, null]]) {
    const html = makeSsrHtml([{
      queryKey: ["market", "pricehistory", 753, MARKET_HASH_NAME],
      state: { data: { ecurrency: 23, prices } },
    }]);
    const snapshot = parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME);
    assert.equal(snapshot.lowestSellCents, null);
    assert.equal(snapshot.historyCurrency, 23);
    assert.equal(snapshot.volume, volume);
    assert.equal(snapshot.medianPriceMajor, median);
    assert.equal(parseMarketListingSnapshotFromHtml(html, "753-Other"), null);
    assert.equal(parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME, { includeHistory: false }), null);
  }
});

test("description metadata remains usable when the listing has no buy order", () => {
  const html = makeSsrHtml([
    {
      queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
      state: { data: { amtMinSellOrder: 32, eCurrency: 1, cSellOrders: 0 } },
    },
    {
      queryKey: ["market", "description", 753, MARKET_HASH_NAME],
      state: { data: { name: "Sack of Gems", icon_url: "synthetic/icon" } },
    },
  ]);

  const snapshot = parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME);
  assert.equal(snapshot.highestBuyCents, null);
  assert.equal(snapshot.sellOrderCount, 0);
  assert.equal(snapshot.displayName, "Sack of Gems");
  assert.match(snapshot.imageUrl, /synthetic\/icon$/);
  assert.equal(parseMarketOrderbookFromListingHtml(html, MARKET_HASH_NAME), null);
});

test("malformed SSR is rejected without throwing", () => {
  assert.equal(parseMarketListingSnapshotFromHtml("<html></html>", MARKET_HASH_NAME), null);
  assert.equal(parseMarketOrderbookFromListingHtml("broken", MARKET_HASH_NAME), null);
});

test("queries belonging to other items are never used as target fallbacks", () => {
  const html = makeSsrHtml([
    {
      queryKey: ["market", "orderbook", 753, "753-Other A"],
      state: { data: { amtMinSellOrder: 1000, amtMaxBuyOrder: 999, eCurrency: 23 } },
    },
    {
      queryKey: ["market", "description", 753, "753-Other B"],
      state: { data: { name: "Other B", icon_url: "other/icon" } },
    },
  ]);

  assert.equal(parseMarketListingSnapshotFromHtml(html, MARKET_HASH_NAME), null);
  assert.equal(parseMarketOrderbookFromListingHtml(html, MARKET_HASH_NAME), null);
});

test("listing SSR exposes strictly validated buy-order depth", () => {
  const html = makeSsrHtml([{
    queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
    state: { data: {
      amtMinSellOrder: 438,
      amtMaxBuyOrder: 430,
      eCurrency: 23,
      cBuyOrders: 389,
      cSellOrders: 100,
      rgCompactBuyOrders: [430, 2, 429, 5, 428, 382],
    } },
  }]);

  const expectedDepth = {
    currencyId: 23,
    highestBuyMinor: 430,
    lowestSellMinor: 438,
    buyOrderCount: 389,
    sellOrderCount: 100,
    buyLevels: [
      { priceMinor: 430, quantity: 2 },
      { priceMinor: 429, quantity: 5 },
      { priceMinor: 428, quantity: 382 },
    ],
  };
  assert.deepEqual(parseMarketOrderDepthFromListingHtml(html, MARKET_HASH_NAME), expectedDepth);
  assert.deepEqual(parseMarketListingWithDepthFromHtml(html, MARKET_HASH_NAME), {
    snapshot: {
      highestBuyCents: 430,
      lowestSellCents: 438,
      currency: 23,
      noBuyOrders: false,
      sellOrderCount: 100,
      displayName: "",
      imageUrl: "",
    },
    depth: expectedDepth,
  });
});

test("listing depth rejects wrong best price and non-descending compact levels", () => {
  for (const rgCompactBuyOrders of [
    [429, 2, 428, 5],
    [430, 2, 431, 5],
    [430, 2, 429],
  ]) {
    const html = makeSsrHtml([{
      queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
      state: { data: {
        amtMaxBuyOrder: 430,
        eCurrency: 23,
        rgCompactBuyOrders,
      } },
    }]);
    assert.equal(parseMarketOrderDepthFromListingHtml(html, MARKET_HASH_NAME), null);
  }
});

test("listing depth rejects a compact quantity total that conflicts with Steam totals", () => {
  const html = makeSsrHtml([{
    queryKey: ["market", "orderbook", 753, MARKET_HASH_NAME],
    state: { data: {
      amtMaxBuyOrder: 430,
      eCurrency: 23,
      cBuyOrders: 999,
      rgCompactBuyOrders: [430, 2, 429, 5],
    } },
  }]);
  assert.equal(parseMarketOrderDepthFromListingHtml(html, MARKET_HASH_NAME), null);
});
