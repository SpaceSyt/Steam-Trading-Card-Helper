import { EARLY_PREDICTION_STAGES } from "../constants.js";
import {
  CURRENCY_IDS,
  getActiveCurrencyContext,
  getCurrencyContextById,
  parseCurrencyAmount,
  resolveCurrencyContext,
} from "../services/currency.js";
import {
  normalizePriceOverview,
  toLegacyPriceResult,
} from "../services/market-data.js";
import { persistMarketObservations } from "../services/market-observations.js";

function getPriceCurrencyContext(options = {}) {
  if (options.currencyContext) return resolveCurrencyContext(options.currencyContext);
  if (options.currencyId != null) return getCurrencyContextById(options.currencyId);
  return getActiveCurrencyContext() || getCurrencyContextById(CURRENCY_IDS.CNY);
}

export function parsePrice(str, currencyContext = null) {
  if (!str) return 0;
  return parseCurrencyAmount(
    str,
    currencyContext || getPriceCurrencyContext()
  ) ?? 0;
}

export async function priceCard(marketHashName, queue, options = {}) {
  try {
    const currencyContext = getPriceCurrencyContext(options);
    if (!currencyContext?.currencyId) return null;
    const appid = String(options.appid || 753);
    const params = new URLSearchParams({
      appid,
      currency: String(currencyContext.currencyId),
      market_hash_name: marketHashName,
    });
    const url = `https://steamcommunity.com/market/priceoverview/?${params.toString()}`;
    const res = await queue.fetch(url, {
      ...(options.fetchOptions || {}),
      requestPolicy: "priceoverview",
    });
    const observedAt = Date.now();
    const record = normalizePriceOverview(res?.data, {
      appid,
      marketHashName,
      currencyId: currencyContext.currencyId,
      currencyCode: currencyContext.code,
      decimalDigits: currencyContext.decimalDigits,
      observedAt,
    });
    const legacy = toLegacyPriceResult(record);
    if (record && options.persistMarketCache !== false) {
      const persistence = persistMarketObservations(record);
      if (typeof options.onPersist === "function") options.onPersist(persistence);
    }

    if (!legacy || legacy.noPriceData) {
      return res?.data?.success
        ? {
          noPriceData: true,
          volume: legacy?.volume || 0,
          record,
          currencyId: currencyContext.currencyId,
          observedAt,
        }
        : null;
    }
    return {
      ...legacy,
      record,
      currencyId: currencyContext.currencyId,
      observedAt,
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
