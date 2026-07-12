import { EARLY_PREDICTION_STAGES } from "../constants.js";

export function parsePrice(str) {
  if (!str) return 0;
  const n = parseFloat(str.replace(/[^0-9.,]/g, "").replace(",", "."));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

export async function priceCard(marketHashName, queue) {
  try {
    const url = `https://steamcommunity.com/market/priceoverview/?appid=753&currency=23&market_hash_name=${encodeURIComponent(marketHashName)}`;
    const res = await queue.fetch(url);

    const lowestCents = parsePrice(res?.data?.lowest_price);
    const medianCents = parsePrice(res?.data?.median_price);
    const sellCents = lowestCents || medianCents;
    if (!sellCents) {
      return res?.data?.success ? { noPriceData: true, volume: 0 } : null;
    }

    const volume = parseInt(String(res?.data?.volume || "").replace(/[^\d]/g, ""), 10) || 0;

    return {
      lowestSellCents: sellCents,
      medianCents,
      volume,
      estimated: !lowestCents,
      priceSource: lowestCents ? "lowest" : "median",
    };
  } catch (e) {
    return null;
  }
}

export function predictFullSetLowerBound(cardPrices, totalCards, knownTotalCents) {
  const sampleCount = cardPrices.length;
  const stage = EARLY_PREDICTION_STAGES[sampleCount];
  if (!stage || totalCards <= sampleCount) return null;

  const prices = cardPrices.map(card => card.lowestCents);
  if (cardPrices.some(card => card.volume <= 0) || prices.some(price => !Number.isFinite(price) || price <= 0)) {
    return null;
  }

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  if (maxPrice / minPrice >= 2) return null;

  const representativePrice = minPrice + stage.highWeight * (maxPrice - minPrice);
  const remainingAverage = representativePrice * stage.factor;
  return {
    sampleCount,
    minPrice,
    maxPrice,
    predictedCents: Math.ceil(
      knownTotalCents + (totalCards - sampleCount) * remainingAverage
    ),
  };
}

export function geometricMeanCents(values) {
  const usable = values.filter(value => Number.isFinite(value) && value > 0);
  if (usable.length === 0) return null;
  const meanLog = usable.reduce((sum, value) => sum + Math.log(value), 0) / usable.length;
  return Math.round(Math.exp(meanLog));
}

export function estimateMissingLevel5Cost(noPriceCards, cardPrices, setsTo5) {
  const knownUnitPrices = cardPrices.map(price =>
    Math.max(price.lowestCents, price.medianCents || 0)
  );
  const estimatedUnitCents = geometricMeanCents(knownUnitPrices);
  if (estimatedUnitCents == null) return null;

  const estimatedCostCents = noPriceCards.reduce((sum, card) => {
    const need5 = Math.max(0, setsTo5 - card.owned);
    return sum + estimatedUnitCents * need5;
  }, 0);
  return { estimatedUnitCents, estimatedCostCents };
}
