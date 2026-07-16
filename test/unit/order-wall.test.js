import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateAutomaticBuyPrice,
  detectBuyOrderWalls,
  normalizeBuyOrderLevels,
  parseCompactBuyOrderLevels,
} from "../../src/services/order-wall.js";

const FIXTURE_ROOT = new URL("../fixtures-public/market/", import.meta.url);

async function readFixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_ROOT), "utf8"));
}

test("sanitized Gems depth identifies the labeled 4.28 and 4.27 near walls", async () => {
  const fixture = await readFixture("orderbook-wall-gems.json");
  const data = fixture.state.data;
  const result = detectBuyOrderWalls(data.rgCompactBuyOrders, {
    bestPriceMinor: data.amtMaxBuyOrder,
  });

  assert.equal(result.classification, fixture.expected.classification);
  assert.deepEqual(
    result.walls.map(wall => wall.priceMinor),
    fixture.expected.wallPricesMinor
  );
  assert.equal(result.clusters.length, 1);
  assert.deepEqual(
    result.nearestCluster.walls.map(wall => wall.priceMinor),
    [428, 427]
  );
  assert.equal(result.nearestCluster.totalQuantity, 1679);
  assert.ok(result.walls.every(wall => wall.quantityRatio >= 6));
});

test("sanitized Songbird depth stays balanced despite a large deep support level", async () => {
  const fixture = await readFixture("orderbook-balanced-songbird.json");
  const data = fixture.state.data;
  const result = detectBuyOrderWalls(data.rgCompactBuyOrders, {
    bestPriceMinor: data.amtMaxBuyOrder,
  });

  assert.equal(result.classification, fixture.expected.classification);
  assert.deepEqual(result.walls, []);
  assert.equal(result.nearestCluster, null);
  assert.equal(result.levels.find(level => level.priceMinor === 22).quantity, 678);
});

test("compact depth validation fails closed on malformed or mismatched responses", () => {
  assert.equal(parseCompactBuyOrderLevels([30, 10, 29]), null);
  assert.equal(parseCompactBuyOrderLevels([30, 10, 31, 20]), null);
  assert.equal(parseCompactBuyOrderLevels([30, -1, 29, 20]), null);
  assert.equal(parseCompactBuyOrderLevels([30, 10, 29, 20], {
    expectedBestPriceMinor: 31,
  }), null);
  assert.deepEqual(parseCompactBuyOrderLevels([30, 10, 29, 20]), [
    { priceMinor: 30, quantity: 10 },
    { priceMinor: 29, quantity: 20 },
  ]);
});

test("normalization accepts pairs and objects, merges duplicate prices, and sorts", () => {
  assert.deepEqual(normalizeBuyOrderLevels([
    [28, 4],
    { priceMinor: 30, quantity: 2 },
    { priceCents: 28, count: 3 },
    [29, 0],
  ]), [
    { priceMinor: 30, quantity: 2 },
    { priceMinor: 28, quantity: 7 },
  ]);
});

test("distance and local ratio gates keep deep or merely uneven levels out", () => {
  const result = detectBuyOrderWalls([
    100, 10,
    99, 12,
    98, 120,
    97, 11,
    96, 10,
    95, 1000,
  ], { bestPriceMinor: 100 });

  assert.deepEqual(result.walls.map(wall => wall.priceMinor), [98]);
  assert.ok(!result.walls.some(wall => wall.priceMinor === 95));
});

test("automatic wall pricing maps Gems to conservative 4.27, balanced 4.28, and aggressive 4.31", async () => {
  const fixture = await readFixture("orderbook-wall-gems.json");
  const depth = {
    highestBuyMinor: fixture.state.data.amtMaxBuyOrder,
    lowestSellMinor: fixture.state.data.amtMinSellOrder,
    buyLevels: parseCompactBuyOrderLevels(fixture.state.data.rgCompactBuyOrders),
  };

  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "conservative",
  }).finalPriceMinor, 427);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "balanced",
  }).finalPriceMinor, 428);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "aggressive",
  }).finalPriceMinor, 431);
});

test("automatic no-wall pricing uses best minus one, best, and best plus one", async () => {
  const fixture = await readFixture("orderbook-balanced-songbird.json");
  const depth = {
    highestBuyMinor: fixture.state.data.amtMaxBuyOrder,
    lowestSellMinor: fixture.state.data.amtMinSellOrder,
    buyLevels: parseCompactBuyOrderLevels(fixture.state.data.rgCompactBuyOrders),
  };

  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "conservative",
  }).finalPriceMinor, 26);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "balanced",
  }).finalPriceMinor, 27);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "aggressive",
  }).finalPriceMinor, 28);
});

test("automatic pricing applies adjustment and then guards below the lowest sell", () => {
  const quote = calculateAutomaticBuyPrice({
    highestBuyMinor: 100,
    lowestSellMinor: 102,
    buyLevels: [
      { priceMinor: 100, quantity: 10 },
      { priceMinor: 99, quantity: 12 },
      { priceMinor: 98, quantity: 11 },
    ],
  }, {
    strategy: "aggressive",
    adjustmentMinor: 5,
    minimumPriceMinor: 3,
  });

  assert.equal(quote.strategyBasePriceMinor, 101);
  assert.equal(quote.adjustedPriceMinor, 106);
  assert.equal(quote.finalPriceMinor, 101);
  assert.equal(quote.wasSellGuardClamped, true);
});
