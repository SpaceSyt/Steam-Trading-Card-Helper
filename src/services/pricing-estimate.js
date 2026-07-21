function positiveMinor(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function quantity(value) {
  return Math.max(0, Number(value) || 0);
}

/** Recalculate the three displayed totals from already available card data. */
export function calculateResultPricingTotals(info, options = {}) {
  const original = {
    completion: Math.max(0, Number(info?.cheapestSetCostCents) || 0),
    full: Math.max(0, Number(info?.fullSetCostCents) || 0),
    level: Math.max(0, Number(info?.level5CostCents) || 0),
  };
  const adjustmentMinor = Number.isFinite(Number(options.adjustmentMinor))
    ? Math.round(Number(options.adjustmentMinor))
    : 0;
  const minimumPriceMinor = positiveMinor(options.minimumPriceMinor) ?? 1;
  const source = String(options.priceSource || "lowest");
  const automatic = options.automatic === true;
  const setsToTarget = Math.max(
    0,
    (Number(info?.targetLevel) || 5) - (Number(info?.level) || 0)
  );
  const knownOriginal = { completion: 0, full: 0, level: 0 };
  const replacement = { completion: 0, full: 0, level: 0 };

  for (const card of Array.isArray(info?.cards) ? info.cards : []) {
    const lowest = positiveMinor(card?.lowestCents);
    if (lowest === null) continue;
    const median = positiveMinor(card?.medianCents) ?? lowest;
    const owned = quantity(card?.owned);
    const completionQuantity = Math.max(0, 1 - owned);
    const levelQuantity = Math.max(0, setsToTarget - owned);
    const resolvedFinal = positiveMinor(options.resolveFinalPriceMinor?.(card));
    const resolvedBase = positiveMinor(options.resolveBasePriceMinor?.(card)) ?? lowest;
    const selectedUnit = resolvedFinal
      ?? Math.max(minimumPriceMinor, resolvedBase + adjustmentMinor);

    knownOriginal.completion += lowest * completionQuantity;
    knownOriginal.full += lowest;
    knownOriginal.level += levelQuantity > 0
      ? lowest + (levelQuantity - 1) * Math.max(lowest, median)
      : 0;
    replacement.completion += selectedUnit * completionQuantity;
    replacement.full += selectedUnit;

    if (!automatic && source === "lowest" && resolvedFinal === null) {
      const firstUnit = Math.max(minimumPriceMinor, lowest + adjustmentMinor);
      const repeatedUnit = Math.max(
        minimumPriceMinor,
        Math.max(lowest, median) + adjustmentMinor
      );
      replacement.level += levelQuantity > 0
        ? firstUnit + (levelQuantity - 1) * repeatedUnit
        : 0;
    } else {
      replacement.level += selectedUnit * levelQuantity;
    }
  }

  return {
    completionCents: Math.max(0, original.completion - knownOriginal.completion)
      + replacement.completion,
    fullCents: Math.max(0, original.full - knownOriginal.full) + replacement.full,
    levelCents: Math.max(0, original.level - knownOriginal.level) + replacement.level,
  };
}
