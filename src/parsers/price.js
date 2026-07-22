import { EARLY_PREDICTION_STAGES } from "../constants.js";
import {
  CURRENCY_IDS,
  getActiveCurrencyContext,
  getCurrencyContextById,
  resolveCurrencyContext,
} from "../services/currency.js";
import {
  normalizePriceOverview,
  toLegacyPriceResult,
} from "../services/market-data.js";
import { persistMarketObservations } from "../services/market-observations.js";

export const PRICE_CARD_OUTCOMES = Object.freeze({
  PRICED: "priced",
  NO_PRICE: "no-price",
  ERROR: "error",
});

export const PRICE_CARD_ERROR_KINDS = Object.freeze({
  INVALID_INPUT: "invalid-input",
  CURRENCY: "currency",
  HTTP: "http",
  NETWORK: "network",
  PARSE: "parse",
  RESPONSE: "response",
  STOPPED: "stopped",
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSuccessfulResponse(value) {
  return value === true || value === 1 || value === "1";
}

function makePriceCardError(errorKind, options = {}) {
  const httpStatus = Number(options.httpStatus);
  return {
    outcome: PRICE_CARD_OUTCOMES.ERROR,
    errorKind,
    errorMessage: String(options.errorMessage || "价格请求失败"),
    httpStatus: Number.isSafeInteger(httpStatus) && httpStatus > 0 ? httpStatus : null,
    record: null,
    currencyId: options.currencyId ?? null,
    observedAt: null,
  };
}

function classifyRequestError(error, currencyId) {
  const httpStatus = Number(error?.status);
  const message = String(error?.error || error?.message || error || "价格请求失败");
  if (httpStatus === 0 || /\b(?:stopped|skipped)\b/i.test(message)) {
    return makePriceCardError(PRICE_CARD_ERROR_KINDS.STOPPED, {
      errorMessage: message,
      currencyId,
    });
  }
  if (Number.isSafeInteger(httpStatus) && httpStatus > 0) {
    return makePriceCardError(PRICE_CARD_ERROR_KINDS.HTTP, {
      errorMessage: message,
      httpStatus,
      currencyId,
    });
  }
  return makePriceCardError(PRICE_CARD_ERROR_KINDS.NETWORK, {
    errorMessage: message,
    currencyId,
  });
}

function hasNonEmptyPriceField(data) {
  return ["lowest_price", "median_price"].some(key => (
    hasOwn(data, key) && String(data[key] ?? "").trim() !== ""
  ));
}

export function isPriceCardPriced(result) {
  return result?.outcome === PRICE_CARD_OUTCOMES.PRICED;
}

export function isPriceCardNoPrice(result) {
  return result?.outcome === PRICE_CARD_OUTCOMES.NO_PRICE;
}

export function isPriceCardError(result) {
  return result?.outcome === PRICE_CARD_OUTCOMES.ERROR;
}

/**
 * Apply one structured priceoverview result to a parsed card. Missing values are
 * deliberately stored as null so aggregate callers cannot accidentally add a
 * partial price to a complete-set total.
 */
export function applyPriceCardResult(card, result, fallbackCurrencyId = null) {
  const target = card && typeof card === "object" ? card : {};
  const normalized = isPriceCardPriced(result) || isPriceCardNoPrice(result) || isPriceCardError(result)
    ? result
    : makePriceCardError(PRICE_CARD_ERROR_KINDS.PARSE, {
      errorMessage: "未知查价结果",
      currencyId: fallbackCurrencyId,
    });

  target.lowestCents = null;
  target.medianCents = null;
  target.volume = null;
  target.priceOutcome = normalized.outcome;
  target.currencyId = normalized.currencyId ?? fallbackCurrencyId;
  target.observedAt = normalized.observedAt ?? null;
  target.marketRecord = normalized.record ?? null;
  delete target.priceErrorKind;
  delete target.priceErrorStatus;

  if (isPriceCardPriced(normalized)) {
    target.lowestCents = normalized.lowestSellCents;
    target.medianCents = normalized.medianCents;
    target.volume = normalized.volume;
    target.priceSource = normalized.priceSource;
  } else if (isPriceCardNoPrice(normalized)) {
    target.volume = normalized.record?.volume ?? null;
    target.priceSource = "none";
  } else {
    target.priceSource = "failed";
    target.priceErrorKind = normalized.errorKind;
    target.priceErrorStatus = normalized.httpStatus;
  }

  return normalized;
}

function getPriceCurrencyContext(options = {}) {
  if (options.currencyContext) return resolveCurrencyContext(options.currencyContext);
  if (options.currencyId != null) return getCurrencyContextById(options.currencyId);
  return getActiveCurrencyContext() || getCurrencyContextById(CURRENCY_IDS.CNY);
}
export async function priceCard(marketHashName, queue, options = {}) {
  const normalizedMarketHashName = String(marketHashName || "").trim();
  if (!normalizedMarketHashName || typeof queue?.fetch !== "function") {
    return makePriceCardError(PRICE_CARD_ERROR_KINDS.INVALID_INPUT, {
      errorMessage: !normalizedMarketHashName ? "缺少 market_hash_name" : "价格请求队列不可用",
    });
  }

  let currencyContext = null;
  try {
    currencyContext = getPriceCurrencyContext(options);
    if (!currencyContext?.currencyId) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.CURRENCY, {
        errorMessage: "无法确认市场币种",
      });
    }
    const appid = String(options.appid || 753);
    const params = new URLSearchParams({
      appid,
      currency: String(currencyContext.currencyId),
      market_hash_name: normalizedMarketHashName,
    });
    const url = `https://steamcommunity.com/market/priceoverview/?${params.toString()}`;
    const res = await queue.fetch(url, {
      ...(options.fetchOptions || {}),
      requestPolicy: "priceoverview",
    });
    const responseStatus = Number(res?.status);
    if (
      Number.isSafeInteger(responseStatus)
      && responseStatus > 0
      && (responseStatus < 200 || responseStatus >= 300)
    ) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.HTTP, {
        errorMessage: `价格接口返回 HTTP ${responseStatus}`,
        httpStatus: responseStatus,
        currencyId: currencyContext.currencyId,
      });
    }
    if (!isObject(res?.data)) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.PARSE, {
        errorMessage: "价格接口未返回有效 JSON",
        currencyId: currencyContext.currencyId,
      });
    }
    if (!hasOwn(res.data, "success")) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.PARSE, {
        errorMessage: "价格响应缺少 success 字段",
        currencyId: currencyContext.currencyId,
      });
    }
    if (!isSuccessfulResponse(res.data.success)) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.RESPONSE, {
        errorMessage: "Steam 返回查价失败",
        currencyId: currencyContext.currencyId,
      });
    }

    const observedAt = Date.now();
    const record = normalizePriceOverview(res?.data, {
      appid,
      marketHashName: normalizedMarketHashName,
      currencyId: currencyContext.currencyId,
      currencyCode: currencyContext.code,
      decimalDigits: currencyContext.decimalDigits,
      observedAt,
    });
    const legacy = toLegacyPriceResult(record);
    if (!record || !legacy) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.PARSE, {
        errorMessage: "价格响应无法规范化",
        currencyId: currencyContext.currencyId,
      });
    }
    if (legacy.noPriceData && hasNonEmptyPriceField(res.data)) {
      return makePriceCardError(PRICE_CARD_ERROR_KINDS.PARSE, {
        errorMessage: "价格字段无法解析",
        currencyId: currencyContext.currencyId,
      });
    }
    if (record && options.persistMarketCache !== false) {
      const persistence = persistMarketObservations(record);
      if (typeof options.onPersist === "function") options.onPersist(persistence);
    }

    if (legacy.noPriceData) {
      return {
        outcome: PRICE_CARD_OUTCOMES.NO_PRICE,
        noPriceData: true,
        volume: legacy.volume || 0,
        record,
        currencyId: currencyContext.currencyId,
        observedAt,
      };
    }
    return {
      outcome: PRICE_CARD_OUTCOMES.PRICED,
      ...legacy,
      record,
      currencyId: currencyContext.currencyId,
      observedAt,
    };
  } catch (e) {
    return classifyRequestError(e, currencyContext?.currencyId ?? null);
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
