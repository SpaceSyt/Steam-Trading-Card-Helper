import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMarketOrderDepthFromListingHtml,
  parseMarketListingSnapshotFromHtml,
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
    sellOrderCount: 28684,
    displayName: "Sack of Gems",
    imageUrl: "https://community.fastly.steamstatic.com/economy/image/synthetic/large/icon/path",
  });
  assert.deepEqual(
    parseMarketOrderbookFromListingHtml(html, MARKET_HASH_NAME),
    snapshot
  );
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

  assert.deepEqual(parseMarketOrderDepthFromListingHtml(html, MARKET_HASH_NAME), {
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
