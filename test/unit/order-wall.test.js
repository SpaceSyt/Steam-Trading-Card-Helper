import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  calculateAutomaticBuyPrice,
  detectBuyOrderWalls,
  detectIsolatedHighBuyOrder,
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
  assert.ok(result.walls.every(wall => wall.quantityRatio >= 3));
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

test("relative price band and nearest-cluster selection keep deep support out", () => {
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

test("labeled current samples separate isolated highs from normal pre-wall orders", () => {
  const gems = detectIsolatedHighBuyOrder([
    507, 2, 506, 3, 503, 76, 502, 207, 498, 506,
  ]);
  assert.equal(gems.classification, "normal");

  const scout = detectIsolatedHighBuyOrder([
    583, 3, 559, 26, 558, 2, 547, 11, 544, 9, 533, 1,
  ]);
  assert.equal(scout.classification, "isolated-high");
  assert.deepEqual(scout.isolatedLevels.map(level => level.priceMinor), [583]);
  assert.equal(scout.effectiveBestPriceMinor, 559);

  const kavin = detectIsolatedHighBuyOrder([
    75, 5, 60, 2, 59, 2, 55, 1, 33, 30,
  ]);
  assert.equal(kavin.classification, "isolated-high");
  assert.deepEqual(kavin.isolatedLevels.map(level => level.priceMinor), [75]);
  assert.deepEqual(kavin.effectiveLevels.map(level => level.priceMinor), [60, 59, 55, 33]);

  const anarchist = detectIsolatedHighBuyOrder([
    203, 1, 202, 3, 198, 97, 197, 16, 195, 1233, 193, 10,
  ]);
  assert.equal(anarchist.classification, "normal");
});

test("the active currency minimum is never removed as an isolated high price", () => {
  const levels = [
    21, 1, 19, 4, 18, 5, 17, 6, 16, 20,
  ];
  assert.equal(detectIsolatedHighBuyOrder(levels).classification, "isolated-high");

  const protectedResult = detectIsolatedHighBuyOrder(levels, {
    minimumPriceMinor: 21,
  });
  assert.equal(protectedResult.classification, "normal");
  assert.equal(protectedResult.minimumPriceProtected, true);

  const quote = calculateAutomaticBuyPrice({
    highestBuyMinor: 21,
    lowestSellMinor: 30,
    buyLevels: normalizeBuyOrderLevels(levels),
  }, {
    strategy: "balanced",
    minimumPriceMinor: 21,
  });
  assert.equal(quote.detection.isolation.classification, "normal");
  assert.equal(quote.finalPriceMinor, 21);
});

test("wall detection uses only preceding orders and does not require a post-wall drop", () => {
  const tailWall = detectBuyOrderWalls([
    100, 2,
    99, 3,
    98, 12,
  ]);
  assert.deepEqual(tailWall.walls.map(wall => wall.priceMinor), [98]);

  const currentGems = detectBuyOrderWalls([
    507, 2, 506, 3, 503, 76, 502, 207, 498, 506, 497, 11, 496, 780,
  ]);
  assert.equal(currentGems.isolation.classification, "normal");
  assert.deepEqual(currentGems.walls.map(wall => wall.priceMinor), [503, 502]);

  const currentAnarchist = detectBuyOrderWalls([
    203, 1, 202, 3, 198, 97, 197, 16, 195, 1233, 193, 10,
  ]);
  assert.equal(currentAnarchist.isolation.classification, "normal");
  assert.deepEqual(currentAnarchist.walls.map(wall => wall.priceMinor), [198, 197]);
});

test("automatic strategies price from the effective best after removing one isolated high", () => {
  const depth = {
    highestBuyMinor: 75,
    lowestSellMinor: 101,
    buyLevels: normalizeBuyOrderLevels([
      75, 5, 60, 2, 59, 2, 55, 1, 33, 30,
    ]),
  };

  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "conservative",
  }).finalPriceMinor, 58);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "balanced",
  }).finalPriceMinor, 59);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "aggressive",
  }).finalPriceMinor, 61);
});

test("automatic wall pricing maps Gems to bottom, top, and top-plus-one defaults", async () => {
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
  }).finalPriceMinor, 429);
});

test("automatic no-wall pricing defaults to best minus two, minus one, and plus one", async () => {
  const fixture = await readFixture("orderbook-balanced-songbird.json");
  const depth = {
    highestBuyMinor: fixture.state.data.amtMaxBuyOrder,
    lowestSellMinor: fixture.state.data.amtMinSellOrder,
    buyLevels: parseCompactBuyOrderLevels(fixture.state.data.rgCompactBuyOrders),
  };

  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "conservative",
  }).finalPriceMinor, 25);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "balanced",
  }).finalPriceMinor, 26);
  assert.equal(calculateAutomaticBuyPrice(depth, {
    strategy: "aggressive",
  }).finalPriceMinor, 28);
});

test("automatic strategy rules customize wall anchor and both offsets", async () => {
  const wallFixture = await readFixture("orderbook-wall-gems.json");
  const wallDepth = {
    highestBuyMinor: wallFixture.state.data.amtMaxBuyOrder,
    lowestSellMinor: wallFixture.state.data.amtMinSellOrder,
    buyLevels: parseCompactBuyOrderLevels(wallFixture.state.data.rgCompactBuyOrders),
  };
  const wallQuote = calculateAutomaticBuyPrice(wallDepth, {
    strategy: "balanced",
    strategyRule: {
      wallAnchor: "bottom",
      wallOffsetMinor: -2,
      noWallOffsetMinor: 3,
    },
  });
  assert.equal(wallQuote.wallReferencePriceMinor, 427);
  assert.equal(wallQuote.finalPriceMinor, 425);

  const noWallFixture = await readFixture("orderbook-balanced-songbird.json");
  const noWallQuote = calculateAutomaticBuyPrice({
    highestBuyMinor: noWallFixture.state.data.amtMaxBuyOrder,
    lowestSellMinor: noWallFixture.state.data.amtMinSellOrder,
    buyLevels: parseCompactBuyOrderLevels(noWallFixture.state.data.rgCompactBuyOrders),
  }, {
    strategy: "balanced",
    strategyRule: {
      wallAnchor: "bottom",
      wallOffsetMinor: -2,
      noWallOffsetMinor: 3,
    },
  });
  assert.equal(noWallQuote.wallReferencePriceMinor, null);
  assert.equal(noWallQuote.finalPriceMinor, 30);
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
