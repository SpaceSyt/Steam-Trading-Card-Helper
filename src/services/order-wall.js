export const DEFAULT_ORDER_WALL_OPTIONS = Object.freeze({
  isolationMinimumGapRatio: 0.03,
  isolationGapMultiplier: 2,
  isolationLookaheadLevels: 4,
  isolationMaxTopShare: 0.25,
  maxDistanceRatio: 0.04,
  quantityRatioThreshold: 3,
  precedingWindow: 3,
  minimumPrecedingCount: 2,
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

function getPrecedingBaseline(levels, index, windowSize, minimumCount) {
  const from = Math.max(0, index - windowSize);
  const quantities = levels.slice(from, index).map(level => level.quantity);
  return quantities.length >= minimumCount ? median(quantities) : null;
}

/**
 * Detect a single isolated best-price level before looking for quantity walls.
 * Isolation needs both a relative price discontinuity and weak local support;
 * a small absolute order count alone is never enough.
 */
export function detectIsolatedHighBuyOrder(input, options = {}) {
  const settings = { ...DEFAULT_ORDER_WALL_OPTIONS, ...options };
  const levels = normalizeBuyOrderLevels(input);
  const originalBestPriceMinor = levels[0]?.priceMinor ?? null;
  const emptyResult = {
    classification: "normal",
    originalBestPriceMinor,
    effectiveBestPriceMinor: originalBestPriceMinor,
    isolatedLevels: [],
    levels,
    effectiveLevels: levels,
  };
  if (levels.length < 3 || originalBestPriceMinor === null) return emptyResult;

  const lookaheadLevels = Math.max(
    2,
    Math.floor(Number(settings.isolationLookaheadLevels) || 2)
  );
  const localLevels = levels.slice(0, lookaheadLevels + 1);
  const lowerGaps = [];
  for (let index = 1; index + 1 < localLevels.length; index++) {
    lowerGaps.push(localLevels[index].priceMinor - localLevels[index + 1].priceMinor);
  }
  const typicalLowerGap = median(lowerGaps.filter(gap => gap > 0));
  if (!Number.isFinite(typicalLowerGap) || typicalLowerGap <= 0) return emptyResult;

  const top = levels[0];
  const second = levels[1];
  const topGapMinor = top.priceMinor - second.priceMinor;
  const topGapRatio = topGapMinor / second.priceMinor;
  const topGapVsTypical = topGapMinor / typicalLowerGap;
  const localQuantity = localLevels.reduce((sum, level) => sum + level.quantity, 0);
  const topQuantityShare = localQuantity > 0 ? top.quantity / localQuantity : 1;
  const minimumGapRatio = Math.max(0, Number(settings.isolationMinimumGapRatio) || 0);
  const gapMultiplier = Math.max(1, Number(settings.isolationGapMultiplier) || 1);
  const maxTopShare = Math.min(
    1,
    Math.max(0, Number(settings.isolationMaxTopShare) || 0)
  );
  const isolated = topGapRatio >= minimumGapRatio
    && topGapVsTypical >= gapMultiplier
    && topQuantityShare <= maxTopShare;
  if (!isolated) {
    return {
      ...emptyResult,
      topGapMinor,
      topGapRatio,
      topGapVsTypical,
      topQuantityShare,
    };
  }

  const effectiveLevels = levels.slice(1);
  return {
    classification: "isolated-high",
    originalBestPriceMinor,
    effectiveBestPriceMinor: effectiveLevels[0]?.priceMinor ?? null,
    isolatedLevels: [{
      ...top,
      gapToNextMinor: topGapMinor,
      gapRatio: topGapRatio,
      gapVsTypical: topGapVsTypical,
      localQuantityShare: topQuantityShare,
    }],
    levels,
    effectiveLevels,
    topGapMinor,
    topGapRatio,
    topGapVsTypical,
    topQuantityShare,
  };
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
  const isolation = detectIsolatedHighBuyOrder(input, settings);
  const levels = isolation.effectiveLevels;
  const suppliedBestPriceMinor = normalizePositiveInteger(options.bestPriceMinor);
  const originalBestPriceMinor = suppliedBestPriceMinor
    ?? isolation.originalBestPriceMinor
    ?? null;
  const bestPriceMinor = isolation.effectiveBestPriceMinor;
  if (levels.length === 0 || bestPriceMinor === null) {
    return {
      classification: "balanced",
      bestPriceMinor,
      originalBestPriceMinor,
      levels,
      walls: [],
      clusters: [],
      nearestCluster: null,
      isolation,
    };
  }

  const maxDistanceRatio = Math.max(0, Number(settings.maxDistanceRatio) || 0);
  const maxDistanceMinor = Math.max(1, Math.floor(bestPriceMinor * maxDistanceRatio));
  const ratioThreshold = Math.max(1, Number(settings.quantityRatioThreshold) || 1);
  const precedingWindow = Math.max(1, Math.floor(Number(settings.precedingWindow) || 1));
  const minimumPrecedingCount = Math.max(
    1,
    Math.floor(Number(settings.minimumPrecedingCount) || 1)
  );
  const clusterGapMinor = Math.max(0, Math.floor(Number(settings.clusterGapMinor) || 0));

  const wallCandidates = [];
  levels.forEach((level, index) => {
    const distanceFromBestMinor = bestPriceMinor - level.priceMinor;
    if (distanceFromBestMinor < 0 || distanceFromBestMinor > maxDistanceMinor) return;
    const baselineQuantity = getPrecedingBaseline(
      levels,
      index,
      precedingWindow,
      minimumPrecedingCount
    );
    if (!Number.isFinite(baselineQuantity) || baselineQuantity <= 0) return;
    const quantityRatio = level.quantity / baselineQuantity;
    if (quantityRatio < ratioThreshold) return;
    wallCandidates.push({
      ...level,
      distanceFromBestMinor,
      baselineQuantity,
      quantityRatio,
    });
  });

  const allClusters = buildClusters(wallCandidates, clusterGapMinor);
  const nearestCluster = allClusters[0] || null;
  const walls = nearestCluster?.walls || [];
  const clusters = nearestCluster ? [nearestCluster] : [];
  return {
    classification: walls.length > 0 ? "near-wall" : "balanced",
    bestPriceMinor,
    originalBestPriceMinor,
    maxDistanceMinor,
    levels,
    walls,
    clusters,
    nearestCluster,
    wallCandidates,
    isolation,
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
  const effectiveHighestBuyMinor = detection.bestPriceMinor ?? highestBuyMinor;
  let strategyBasePriceMinor;
  if (strategy === "aggressive") {
    strategyBasePriceMinor = effectiveHighestBuyMinor + 1;
  } else if (strategy === "conservative") {
    strategyBasePriceMinor = cluster
      ? cluster.bottomPriceMinor
      : effectiveHighestBuyMinor - 1;
  } else {
    strategyBasePriceMinor = cluster
      ? cluster.topPriceMinor
      : effectiveHighestBuyMinor;
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
    effectiveHighestBuyMinor,
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
