export const DEFAULT_ORDER_WALL_OPTIONS = Object.freeze({
  maxDistanceMinor: 3,
  minimumQuantity: 100,
  quantityRatioThreshold: 6,
  neighborRadius: 2,
  minimumNeighborCount: 2,
  clusterGapMinor: 1,
});

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function addLevel(byPrice, priceValue, quantityValue) {
  const priceMinor = normalizePositiveInteger(priceValue);
  const quantity = normalizePositiveInteger(quantityValue);
  if (priceMinor === null || quantity === null) return;
  byPrice.set(priceMinor, (byPrice.get(priceMinor) || 0) + quantity);
}

/** Strictly validate the compact depth returned by Steam SSR. */
export function parseCompactBuyOrderLevels(input, options = {}) {
  if (!Array.isArray(input) || input.length === 0 || input.length % 2 !== 0) return null;
  const levels = [];
  let previousPrice = Infinity;
  for (let index = 0; index < input.length; index += 2) {
    const priceMinor = normalizePositiveInteger(input[index]);
    const quantity = normalizePositiveInteger(input[index + 1]);
    if (priceMinor === null || quantity === null || priceMinor >= previousPrice) return null;
    levels.push({ priceMinor, quantity });
    previousPrice = priceMinor;
  }
  const expectedBestPriceMinor = options.expectedBestPriceMinor === undefined
    ? null
    : normalizePositiveInteger(options.expectedBestPriceMinor);
  if (
    options.expectedBestPriceMinor !== undefined
    && (expectedBestPriceMinor === null || levels[0].priceMinor !== expectedBestPriceMinor)
  ) return null;
  return levels;
}

/** Normalize Steam's [price, quantity, ...] compact buy depth. */
export function normalizeBuyOrderLevels(input) {
  const byPrice = new Map();
  if (!Array.isArray(input)) return [];

  if (input.every(value => !Array.isArray(value) && typeof value !== "object")) {
    for (let index = 0; index + 1 < input.length; index += 2) {
      addLevel(byPrice, input[index], input[index + 1]);
    }
  } else {
    input.forEach(level => {
      if (Array.isArray(level)) {
        addLevel(byPrice, level[0], level[1]);
      } else if (level && typeof level === "object") {
        addLevel(
          byPrice,
          level.priceMinor ?? level.priceCents ?? level.price,
          level.quantity ?? level.count
        );
      }
    });
  }

  return [...byPrice.entries()]
    .map(([priceMinor, quantity]) => ({ priceMinor, quantity }))
    .sort((left, right) => right.priceMinor - left.priceMinor);
}

function median(values) {
  const sorted = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function getNeighborBaseline(levels, index, radius, minimumNeighborCount) {
  const quantities = [];
  const from = Math.max(0, index - radius);
  const to = Math.min(levels.length - 1, index + radius);
  for (let neighbor = from; neighbor <= to; neighbor += 1) {
    if (neighbor !== index) quantities.push(levels[neighbor].quantity);
  }
  return quantities.length >= minimumNeighborCount ? median(quantities) : null;
}

function buildClusters(walls, clusterGapMinor) {
  const clusters = [];
  walls.forEach(wall => {
    const previous = clusters.at(-1);
    if (
      previous
      && previous.bottomPriceMinor - wall.priceMinor <= clusterGapMinor
    ) {
      previous.walls.push(wall);
      previous.bottomPriceMinor = wall.priceMinor;
      previous.totalQuantity += wall.quantity;
      previous.maxQuantityRatio = Math.max(previous.maxQuantityRatio, wall.quantityRatio);
      return;
    }
    clusters.push({
      topPriceMinor: wall.priceMinor,
      bottomPriceMinor: wall.priceMinor,
      distanceFromBestMinor: wall.distanceFromBestMinor,
      totalQuantity: wall.quantity,
      maxQuantityRatio: wall.quantityRatio,
      walls: [wall],
    });
  });
  return clusters;
}

/**
 * Detect quantity walls close enough to affect the current buy-order price.
 * Deep support is deliberately excluded even when it is the global maximum.
 */
export function detectBuyOrderWalls(input, options = {}) {
  const settings = { ...DEFAULT_ORDER_WALL_OPTIONS, ...options };
  const levels = normalizeBuyOrderLevels(input);
  const bestPriceMinor = normalizePositiveInteger(options.bestPriceMinor)
    ?? levels[0]?.priceMinor
    ?? null;
  if (levels.length === 0 || bestPriceMinor === null) {
    return {
      classification: "balanced",
      bestPriceMinor,
      levels,
      walls: [],
      clusters: [],
      nearestCluster: null,
    };
  }

  const maxDistanceMinor = Math.max(0, Number(settings.maxDistanceMinor) || 0);
  const minimumQuantity = Math.max(1, Number(settings.minimumQuantity) || 1);
  const ratioThreshold = Math.max(1, Number(settings.quantityRatioThreshold) || 1);
  const neighborRadius = Math.max(1, Math.floor(Number(settings.neighborRadius) || 1));
  const minimumNeighborCount = Math.max(
    1,
    Math.floor(Number(settings.minimumNeighborCount) || 1)
  );
  const clusterGapMinor = Math.max(0, Math.floor(Number(settings.clusterGapMinor) || 0));

  const walls = [];
  levels.forEach((level, index) => {
    const distanceFromBestMinor = bestPriceMinor - level.priceMinor;
    if (distanceFromBestMinor < 0 || distanceFromBestMinor > maxDistanceMinor) return;
    if (level.quantity < minimumQuantity) return;
    const baselineQuantity = getNeighborBaseline(
      levels,
      index,
      neighborRadius,
      minimumNeighborCount
    );
    if (!Number.isFinite(baselineQuantity) || baselineQuantity <= 0) return;
    const quantityRatio = level.quantity / baselineQuantity;
    if (quantityRatio < ratioThreshold) return;
    walls.push({
      ...level,
      distanceFromBestMinor,
      baselineQuantity,
      quantityRatio,
    });
  });

  const clusters = buildClusters(walls, clusterGapMinor);
  return {
    classification: walls.length > 0 ? "near-wall" : "balanced",
    bestPriceMinor,
    levels,
    walls,
    clusters,
    nearestCluster: clusters[0] || null,
  };
}

export const AUTOMATIC_BUY_PRICE_STRATEGIES = Object.freeze([
  "conservative",
  "balanced",
  "aggressive",
]);

/**
 * Choose an automatic buy-order price from validated buy depth.
 * The adjustment is applied after the strategy, then Steam's minimum and the
 * lowest-sell guard are applied to the final price.
 */
export function calculateAutomaticBuyPrice(depth, options = {}) {
  const strategy = AUTOMATIC_BUY_PRICE_STRATEGIES.includes(options.strategy)
    ? options.strategy
    : "balanced";
  const highestBuyMinor = normalizePositiveInteger(
    depth?.highestBuyMinor ?? depth?.amtMaxBuyOrder
  );
  if (highestBuyMinor === null) return null;

  const detection = detectBuyOrderWalls(
    depth?.buyLevels ?? depth?.rgCompactBuyOrders ?? [],
    { ...options.wallOptions, bestPriceMinor: highestBuyMinor }
  );
  const cluster = detection.nearestCluster;
  let strategyBasePriceMinor;
  if (strategy === "aggressive") {
    strategyBasePriceMinor = highestBuyMinor + 1;
  } else if (strategy === "conservative") {
    strategyBasePriceMinor = cluster
      ? cluster.bottomPriceMinor
      : highestBuyMinor - 1;
  } else {
    strategyBasePriceMinor = cluster
      ? cluster.topPriceMinor
      : highestBuyMinor;
  }

  const adjustmentMinor = Number.isSafeInteger(Number(options.adjustmentMinor))
    ? Number(options.adjustmentMinor)
    : 0;
  const minimumPriceMinor = normalizePositiveInteger(options.minimumPriceMinor) ?? 1;
  const lowestSellMinor = normalizePositiveInteger(
    depth?.lowestSellMinor ?? depth?.amtMinSellOrder
  );
  if (lowestSellMinor !== null && lowestSellMinor <= minimumPriceMinor) return null;
  const sellGuardMinor = lowestSellMinor === null
    ? null
    : lowestSellMinor - 1;
  const adjustedPriceMinor = strategyBasePriceMinor + adjustmentMinor;
  let finalPriceMinor = Math.max(minimumPriceMinor, adjustedPriceMinor);
  if (sellGuardMinor !== null) finalPriceMinor = Math.min(finalPriceMinor, sellGuardMinor);

  return {
    strategy,
    classification: detection.classification,
    highestBuyMinor,
    strategyBasePriceMinor,
    adjustmentMinor,
    adjustedPriceMinor,
    minimumPriceMinor,
    lowestSellMinor,
    sellGuardMinor,
    finalPriceMinor,
    wasMinimumClamped: finalPriceMinor > adjustedPriceMinor,
    wasSellGuardClamped: sellGuardMinor !== null && finalPriceMinor === sellGuardMinor
      && adjustedPriceMinor > sellGuardMinor,
    detection,
  };
}
