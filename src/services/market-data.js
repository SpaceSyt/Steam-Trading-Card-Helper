export const MARKET_DATA_SCHEMA_VERSION = 1;

export const MARKET_DATA_SOURCES = Object.freeze({
  PRICE_OVERVIEW: "priceoverview",
  LISTING_ORDERBOOK: "listing-orderbook",
  PRICE_HISTORY: "price-history",
  LEGACY_PRICE_RESULT: "legacy-price-result",
});

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function readField(input, defaults, names) {
  for (const name of names) {
    if (isObject(input) && hasOwn(input, name)) return input[name];
  }
  for (const name of names) {
    if (isObject(defaults) && hasOwn(defaults, name)) return defaults[name];
  }
  return undefined;
}

function normalizeRequiredString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

export function normalizeCurrencyId(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizeCurrencyCode(value) {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || null;
}

export function normalizeObservedAt(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const timestamp = Number(text);
    return Number.isSafeInteger(timestamp) ? timestamp : null;
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeWholeNumber(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  const text = String(value ?? "").trim();
  if (!text || text.includes("-")) return null;
  const normalized = text.replace(/[\s\u00a0,.'’]/g, "");
  if (!/^\d+$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isSafeInteger(number) ? number : null;
}

export function normalizeMinorAmount(value) {
  const normalized = normalizeWholeNumber(value);
  // Steam market prices cannot be free; endpoint/legacy zeroes are absence
  // sentinels and must not leak into the canonical model as observed prices.
  return normalized !== null && normalized > 0 ? normalized : null;
}

export function normalizeMarketVolume(value) {
  return normalizeWholeNumber(value);
}

function getMinorDigits(context) {
  const value = Number(firstDefined(
    context?.minorDigits,
    context?.decimalDigits,
    context?.fractionDigits,
    2
  ));
  return Number.isInteger(value) && value >= 0 && value <= 6 ? value : 2;
}

/**
 * Parse a localized major-unit amount (for example, "$1.23" or "1,23€")
 * into an integer minor-unit amount. Raw orderbook integers should instead use
 * normalizeMinorAmount(), because their unit is already the currency minor unit.
 */
export function parseMajorAmountToMinor(value, minorDigits = 2) {
  const digits = Number.isInteger(Number(minorDigits))
    ? Math.min(6, Math.max(0, Number(minorDigits)))
    : 2;
  const factor = 10 ** digits;

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const minor = Math.round(value * factor);
    return Number.isSafeInteger(minor) ? minor : null;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;
  const compact = text.replace(/[\s\u00a0'’]/g, "");
  if (compact.includes("-")) return null;
  const numeric = compact.replace(/[^\d.,]/g, "");
  if (!/\d/.test(numeric)) return null;

  const dotPositions = [...numeric.matchAll(/\./g)].map(match => match.index);
  const commaPositions = [...numeric.matchAll(/,/g)].map(match => match.index);
  const lastDot = dotPositions.at(-1) ?? -1;
  const lastComma = commaPositions.at(-1) ?? -1;
  let decimalSeparator = null;

  if (digits > 0 && lastDot >= 0 && lastComma >= 0) {
    decimalSeparator = lastDot > lastComma ? "." : ",";
  } else if (digits > 0 && (lastDot >= 0 || lastComma >= 0)) {
    const separator = lastDot >= 0 ? "." : ",";
    const positions = separator === "." ? dotPositions : commaPositions;
    const fractionalLength = numeric.length - positions.at(-1) - 1;
    const looksLikeSingleThousandsGroup = positions.length === 1 && fractionalLength === 3 && digits !== 3;
    if (fractionalLength > 0 && fractionalLength <= digits && !looksLikeSingleThousandsGroup) {
      decimalSeparator = separator;
    }
  }

  let normalized;
  if (decimalSeparator) {
    const decimalIndex = numeric.lastIndexOf(decimalSeparator);
    const integerPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, "") || "0";
    const fractionalPart = numeric.slice(decimalIndex + 1).replace(/[.,]/g, "");
    normalized = `${integerPart}.${fractionalPart}`;
  } else {
    normalized = numeric.replace(/[.,]/g, "");
  }

  const major = Number(normalized);
  if (!Number.isFinite(major) || major < 0) return null;
  const minor = Math.round(major * factor);
  return Number.isSafeInteger(minor) ? minor : null;
}

function unwrapResponseData(payload) {
  if (isObject(payload?.data)) return payload.data;
  return isObject(payload) ? payload : {};
}

function isExplicitFailure(value) {
  return value === false || value === 0 || value === "0";
}

function adapterIdentity(payload, context, source, overrides = {}) {
  return {
    appid: firstDefined(context?.appid, payload?.appid, payload?.app_id),
    marketHashName: firstDefined(
      context?.marketHashName,
      context?.market_hash_name,
      payload?.marketHashName,
      payload?.market_hash_name
    ),
    currencyId: hasOwn(overrides, "currencyId")
      ? overrides.currencyId
      : firstDefined(context?.currencyId, context?.currency),
    currencyCode: hasOwn(overrides, "currencyCode")
      ? overrides.currencyCode
      : firstDefined(context?.currencyCode, context?.currency_code),
    observedAt: hasOwn(overrides, "observedAt")
      ? overrides.observedAt
      : firstDefined(context?.observedAt, Date.now()),
    source,
  };
}

/**
 * Return the canonical market record shape. The function is deliberately pure:
 * callers that need a current timestamp must pass one or use an endpoint adapter.
 */
export function normalizeMarketRecord(input, defaults = {}) {
  if (!isObject(input)) return null;

  const appid = normalizeRequiredString(readField(input, defaults, ["appid", "app_id"]));
  const marketHashName = normalizeRequiredString(readField(
    input,
    defaults,
    ["marketHashName", "market_hash_name"]
  ));
  const source = normalizeRequiredString(readField(input, defaults, ["source"]));
  if (!appid || !marketHashName || !source) return null;

  return {
    schemaVersion: MARKET_DATA_SCHEMA_VERSION,
    appid,
    marketHashName,
    currencyId: normalizeCurrencyId(readField(input, defaults, ["currencyId", "currency"])),
    currencyCode: normalizeCurrencyCode(readField(input, defaults, ["currencyCode", "currency_code"])),
    lowestSellMinor: normalizeMinorAmount(readField(
      input,
      defaults,
      ["lowestSellMinor", "lowestSellCents"]
    )),
    medianMinor: normalizeMinorAmount(readField(input, defaults, ["medianMinor", "medianCents"])),
    highestBuyMinor: normalizeMinorAmount(readField(
      input,
      defaults,
      ["highestBuyMinor", "highestBuyCents"]
    )),
    volume: normalizeMarketVolume(readField(input, defaults, ["volume"])),
    observedAt: normalizeObservedAt(readField(input, defaults, ["observedAt", "cachedAt", "timestamp"])),
    source,
  };
}

export function normalizePriceOverview(payload, context = {}) {
  const data = unwrapResponseData(payload);
  if (isExplicitFailure(data.success)) return null;
  const minorDigits = getMinorDigits(context);
  return normalizeMarketRecord({
    ...adapterIdentity(data, context, MARKET_DATA_SOURCES.PRICE_OVERVIEW),
    lowestSellMinor: parseMajorAmountToMinor(data.lowest_price, minorDigits),
    medianMinor: parseMajorAmountToMinor(data.median_price, minorDigits),
    highestBuyMinor: null,
    volume: normalizeMarketVolume(data.volume),
  });
}

function unwrapListingOrderbook(payload) {
  const data = unwrapResponseData(payload);
  if (isObject(data.orderbook)) return data.orderbook;
  if (isObject(data.state?.data)) return data.state.data;
  return data;
}

export function normalizeListingOrderbook(payload, context = {}) {
  const data = unwrapListingOrderbook(payload);
  const payloadCurrencyId = normalizeCurrencyId(firstDefined(data.eCurrency, data.currencyId, data.currency));
  const requestedCurrencyId = normalizeCurrencyId(firstDefined(context.currencyId, context.currency));
  const currencyMismatch = payloadCurrencyId !== null
    && requestedCurrencyId !== null
    && payloadCurrencyId !== requestedCurrencyId;

  return normalizeMarketRecord({
    ...adapterIdentity(data, context, MARKET_DATA_SOURCES.LISTING_ORDERBOOK, {
      currencyId: firstDefined(payloadCurrencyId, requestedCurrencyId),
      currencyCode: currencyMismatch ? null : firstDefined(context.currencyCode, context.currency_code),
    }),
    lowestSellMinor: normalizeMinorAmount(firstDefined(
      data.amtMinSellOrder,
      data.lowestSellMinor,
      data.lowestSellCents,
      data.lowest_sell_order
    )),
    medianMinor: null,
    highestBuyMinor: normalizeMinorAmount(firstDefined(
      data.amtMaxBuyOrder,
      data.highestBuyMinor,
      data.highestBuyCents,
      data.highest_buy_order
    )),
    volume: null,
  });
}

function normalizeHistoryPoint(point, context) {
  let observedAt;
  let price;
  let volume;

  if (Array.isArray(point)) {
    [observedAt, price, volume] = point;
  } else if (isObject(point)) {
    observedAt = firstDefined(point.observedAt, point.timestamp, point.date, point.time);
    price = firstDefined(point.price, point.median_price, point.medianPrice);
    volume = point.volume;
  } else {
    return null;
  }

  const normalizedObservedAt = normalizeObservedAt(observedAt);
  if (normalizedObservedAt === null) return null;

  return normalizeMarketRecord({
    ...adapterIdentity({}, context, MARKET_DATA_SOURCES.PRICE_HISTORY, {
      observedAt: normalizedObservedAt,
    }),
    lowestSellMinor: null,
    // Steam's history tuple contains one sale-price series. It is carried in
    // the canonical median slot; no lowest-sell/highest-buy value is inferred.
    medianMinor: parseMajorAmountToMinor(price, getMinorDigits(context)),
    highestBuyMinor: null,
    volume: normalizeMarketVolume(volume),
  });
}

export function normalizePriceHistory(payload, context = {}) {
  const data = unwrapResponseData(payload);
  if (isExplicitFailure(data.success)) return [];
  const prices = Array.isArray(data.prices) ? data.prices : [];
  return prices.map(point => normalizeHistoryPoint(point, context)).filter(Boolean);
}

/** Convert a canonical record to the result shape consumed by the v2.0 code. */
export function toLegacyPriceResult(record) {
  const normalized = normalizeMarketRecord(record);
  if (!normalized) return null;

  const effectiveSellMinor = normalized.lowestSellMinor ?? normalized.medianMinor;
  if (effectiveSellMinor === null) {
    return {
      noPriceData: true,
      volume: normalized.volume ?? 0,
    };
  }

  const estimated = normalized.lowestSellMinor === null;
  return {
    lowestSellCents: effectiveSellMinor,
    medianCents: normalized.medianMinor ?? 0,
    volume: normalized.volume ?? 0,
    estimated,
    priceSource: estimated ? "median" : "lowest",
  };
}

function normalizeLegacyPrice(value) {
  const normalized = normalizeMinorAmount(value);
  return normalized !== null && normalized > 0 ? normalized : null;
}

/** Convert a v2.0 price result into a canonical record without treating 0 as data. */
export function fromLegacyPriceResult(result, context = {}) {
  if (!isObject(result)) return null;
  const effectiveSellMinor = normalizeLegacyPrice(result.lowestSellCents);
  const explicitMedianMinor = normalizeLegacyPrice(result.medianCents);
  const medianBacked = result.estimated === true || result.priceSource === "median";

  return normalizeMarketRecord({
    ...adapterIdentity(result, context, context.source || MARKET_DATA_SOURCES.LEGACY_PRICE_RESULT),
    lowestSellMinor: result.noPriceData || medianBacked ? null : effectiveSellMinor,
    medianMinor: result.noPriceData
      ? null
      : explicitMedianMinor ?? (medianBacked ? effectiveSellMinor : null),
    highestBuyMinor: normalizeLegacyPrice(result.highestBuyCents),
    volume: result.volume === undefined ? null : normalizeMarketVolume(result.volume),
  });
}
