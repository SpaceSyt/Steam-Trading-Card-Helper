const DEFAULT_DECIMAL_DIGITS = 2;
const DEFAULT_STEAM_FEE_RATE = 0.05;
const DEFAULT_PUBLISHER_FEE_RATE = 0.10;

export const CURRENCY_IDS = Object.freeze({
  USD: 1,
  CNY: 23,
  HKD: 29,
});

const CURRENCY_DEFINITION_MAP = Object.freeze({
  [CURRENCY_IDS.USD]: Object.freeze({
    currencyId: CURRENCY_IDS.USD,
    code: "USD",
    name: "US Dollar",
    symbol: "$",
    symbolPosition: "before",
    symbolSpacing: false,
    locale: "en-US",
    decimalDigits: 2,
    decimalSeparator: ".",
    groupSeparator: ",",
    marketMinimumMinor: 1,
    minimumBuyerMinor: 3,
    steamFeeRate: DEFAULT_STEAM_FEE_RATE,
    publisherFeeRate: DEFAULT_PUBLISHER_FEE_RATE,
    steamFeeMinimumMinor: 1,
    publisherFeeMinimumMinor: 1,
    steamFeeBaseMinor: 0,
    verified: true,
  }),
  [CURRENCY_IDS.CNY]: Object.freeze({
    currencyId: CURRENCY_IDS.CNY,
    code: "CNY",
    name: "Chinese Yuan",
    symbol: "¥",
    symbolPosition: "before",
    symbolSpacing: false,
    locale: "zh-CN",
    decimalDigits: 2,
    decimalSeparator: ".",
    groupSeparator: ",",
    marketMinimumMinor: 7,
    minimumBuyerMinor: 21,
    steamFeeRate: DEFAULT_STEAM_FEE_RATE,
    publisherFeeRate: DEFAULT_PUBLISHER_FEE_RATE,
    steamFeeMinimumMinor: 7,
    publisherFeeMinimumMinor: 7,
    steamFeeBaseMinor: 0,
    verified: true,
  }),
  [CURRENCY_IDS.HKD]: Object.freeze({
    currencyId: CURRENCY_IDS.HKD,
    code: "HKD",
    name: "Hong Kong Dollar",
    symbol: "HK$",
    symbolPosition: "before",
    symbolSpacing: true,
    locale: "zh-HK",
    decimalDigits: 2,
    decimalSeparator: ".",
    groupSeparator: ",",
    // HK market samples confirm ID, formatting, and percentage fee behavior.
    // The page does not expose wallet minimum fields, so retain Steam's
    // conservative one-minor-unit defaults for those values.
    marketMinimumMinor: 1,
    minimumBuyerMinor: 3,
    steamFeeRate: DEFAULT_STEAM_FEE_RATE,
    publisherFeeRate: DEFAULT_PUBLISHER_FEE_RATE,
    steamFeeMinimumMinor: 1,
    publisherFeeMinimumMinor: 1,
    steamFeeBaseMinor: 0,
    verified: true,
  }),
});

export const CURRENCY_DEFINITIONS = CURRENCY_DEFINITION_MAP;

let activeCurrencyContext = null;

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toNonNegativeInteger(value, fallback) {
  const number = toFiniteNumber(value);
  return number != null && number >= 0 ? Math.floor(number) : fallback;
}

function toPositiveInteger(value, fallback) {
  const number = toFiniteNumber(value);
  return number != null && number > 0 ? Math.floor(number) : fallback;
}

function toRate(value, fallback) {
  const number = toFiniteNumber(value);
  if (number == null || number < 0) return fallback;
  return number > 1 ? number / 100 : number;
}

function normalizeCurrencyId(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    if (normalized === "USD") return CURRENCY_IDS.USD;
    if (normalized === "CNY" || normalized === "RMB") return CURRENCY_IDS.CNY;
    if (normalized === "HKD") return CURRENCY_IDS.HKD;
  }
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function currencyIdFromObject(value) {
  if (!value || typeof value !== "object") return null;
  const direct = firstDefined(
    value.currencyId,
    value.currency_id,
    value.wallet_currency,
    value.walletCurrency,
    value.eCurrency,
    value.currency,
  );
  const directId = normalizeCurrencyId(direct);
  if (directId != null) return directId;
  return normalizeCurrencyId(firstDefined(value.code, value.currencyCode, value.wallet_currency_code));
}

function isWalletInfoLike(value) {
  return Boolean(
    value
    && typeof value === "object"
    && (
      Object.hasOwn(value, "wallet_currency")
      || Object.hasOwn(value, "wallet_market_minimum")
      || Object.hasOwn(value, "wallet_fee_percent")
      || Object.hasOwn(value, "wallet_fee_minimum")
    )
  );
}

function genericCurrencyDefinition(currencyId) {
  const idLabel = currencyId == null ? "unknown" : String(currencyId);
  return {
    currencyId,
    code: currencyId == null ? "UNRESOLVED" : `STEAM-${idLabel}`,
    name: currencyId == null ? "Unresolved currency" : `Steam currency ${idLabel}`,
    symbol: "¤",
    symbolPosition: "before",
    symbolSpacing: false,
    locale: "en-US",
    decimalDigits: DEFAULT_DECIMAL_DIGITS,
    decimalSeparator: ".",
    groupSeparator: ",",
    marketMinimumMinor: 1,
    minimumBuyerMinor: 3,
    steamFeeRate: DEFAULT_STEAM_FEE_RATE,
    publisherFeeRate: DEFAULT_PUBLISHER_FEE_RATE,
    steamFeeMinimumMinor: 1,
    publisherFeeMinimumMinor: 1,
    steamFeeBaseMinor: 0,
  };
}

function normalizedSourceObject(value) {
  if (!value || typeof value !== "object") return {};
  if (value.currencyContext && typeof value.currencyContext === "object") {
    return value.currencyContext;
  }
  return value;
}

/**
 * Build a normalized currency context. Definitions can provide known formatting
 * while remaining unverified for fee calculations. A numeric but unknown Steam
 * wallet currency uses conservative, generic two-decimal formatting rules.
 */
export function createCurrencyContext(currencyOrOptions, metadata = {}) {
  const supplied = normalizedSourceObject(
    currencyOrOptions && typeof currencyOrOptions === "object"
      ? currencyOrOptions
      : { currencyId: currencyOrOptions },
  );
  const walletInfo = supplied.walletInfo && typeof supplied.walletInfo === "object"
    ? supplied.walletInfo
    : (isWalletInfoLike(supplied) ? supplied : {});
  const currencyId = currencyIdFromObject(supplied) ?? currencyIdFromObject(walletInfo);
  const knownDefinition = currencyId == null
    ? null
    : CURRENCY_DEFINITION_MAP[currencyId];
  const base = knownDefinition || genericCurrencyDefinition(currencyId);
  const override = { ...walletInfo, ...supplied };

  // Unknown numeric IDs stay generic even if unrelated page text is misleading.
  const decimalDigits = base.decimalDigits;
  const marketMinimumMinor = toPositiveInteger(firstDefined(
    override.marketMinimumMinor,
    override.walletMarketMinimumMinor,
    override.wallet_market_minimum,
  ), base.marketMinimumMinor);
  const minimumBuyerMinor = toPositiveInteger(firstDefined(
    override.minimumBuyerMinor,
    override.marketMinimumBuyerMinor,
    override.minimumBuyerAmount,
  ), marketMinimumMinor * 3);
  const feeMinimumFromWallet = firstDefined(
    override.wallet_fee_minimum,
    override.feeMinimumMinor,
  );
  const steamFeeMinimumMinor = toNonNegativeInteger(firstDefined(
    override.steamFeeMinimumMinor,
    override.steam_fee_minimum,
    feeMinimumFromWallet,
    override.wallet_market_minimum,
  ), base.steamFeeMinimumMinor);
  const publisherFeeMinimumMinor = toNonNegativeInteger(firstDefined(
    override.publisherFeeMinimumMinor,
    override.publisher_fee_minimum,
    override.wallet_publisher_fee_minimum,
    feeMinimumFromWallet,
    override.wallet_market_minimum,
  ), base.publisherFeeMinimumMinor);
  const verified = Boolean(knownDefinition?.verified);
  const source = String(firstDefined(metadata.source, override.source, "manual"));
  const isFallback = Boolean(firstDefined(metadata.isFallback, override.isFallback, false));
  const status = verified ? (isFallback ? "fallback" : "verified") : "unverified";
  const code = base.code;

  return Object.freeze({
    currencyId,
    id: currencyId,
    currency: currencyId,
    code,
    currencyCode: code,
    name: base.name,
    symbol: base.symbol,
    symbolPosition: base.symbolPosition,
    symbolSpacing: base.symbolSpacing,
    locale: base.locale,
    decimalDigits,
    decimals: decimalDigits,
    minorDigits: decimalDigits,
    fractionDigits: decimalDigits,
    minorUnitFactor: 10 ** decimalDigits,
    decimalSeparator: base.decimalSeparator,
    groupSeparator: base.groupSeparator,
    marketMinimumMinor,
    minimumBuyerMinor,
    marketMinimumBuyerMinor: minimumBuyerMinor,
    steamFeeRate: toRate(firstDefined(
      override.steamFeeRate,
      override.wallet_fee_percent,
    ), base.steamFeeRate),
    publisherFeeRate: toRate(firstDefined(
      override.publisherFeeRate,
      override.wallet_publisher_fee_percent_default,
    ), base.publisherFeeRate),
    steamFeeMinimumMinor,
    publisherFeeMinimumMinor,
    steamFeeBaseMinor: toNonNegativeInteger(firstDefined(
      override.steamFeeBaseMinor,
      override.wallet_fee_base,
    ), base.steamFeeBaseMinor),
    verified,
    isVerified: verified,
    unverified: !verified,
    isUnverified: !verified,
    verification: verified ? "verified" : "unverified",
    status,
    source,
    isFallback,
  });
}

function decodeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&quot;|&#34;|&#x22;/gi, "\"")
    .replace(/&apos;|&#39;|&#x27;/gi, "'")
    .replace(/&lt;|&#60;|&#x3c;/gi, "<")
    .replace(/&gt;|&#62;|&#x3e;/gi, ">")
    .replace(/&amp;|&#38;|&#x26;/gi, "&");
}

function parseWalletInfo(value) {
  if (value && typeof value === "object") return value;
  let text = String(value || "").trim();
  if (!text) return null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    text = decodeHtmlAttribute(text).trim();
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") return parsed;
      if (typeof parsed === "string") {
        text = parsed;
        continue;
      }
    } catch (_) {}
  }
  return null;
}

function globalObject() {
  if (typeof globalThis === "undefined") return {};
  return globalThis.unsafeWindow || globalThis.window || globalThis;
}

function readApplicationConfigWalletInfo(options) {
  const direct = parseWalletInfo(options.applicationConfigWalletInfo);
  if (currencyIdFromObject(direct) != null) return direct;

  const applicationConfig = options.applicationConfig;
  if (applicationConfig) {
    const configValue = typeof applicationConfig === "string"
      ? applicationConfig
      : firstDefined(
        applicationConfig.dataset?.walletinfo,
        applicationConfig.dataset?.walletInfo,
        applicationConfig.getAttribute?.("data-walletinfo"),
      );
    const parsed = parseWalletInfo(configValue || applicationConfig);
    if (currencyIdFromObject(parsed) != null) return parsed;
  }

  const documentRef = options.document
    || (typeof document !== "undefined" ? document : null);
  const element = documentRef?.getElementById?.("application_config")
    || documentRef?.querySelector?.("#application_config");
  const raw = firstDefined(
    element?.dataset?.walletinfo,
    element?.dataset?.walletInfo,
    element?.getAttribute?.("data-walletinfo"),
  );
  const parsed = parseWalletInfo(raw);
  return currencyIdFromObject(parsed) != null ? parsed : null;
}

function pageCurrencyId(options) {
  const documentRef = options.document
    || (typeof document !== "undefined" ? document : null);
  const root = globalObject();
  const locationRef = options.location || root.location;
  const directCountry = firstDefined(
    root.g_strCountryCode,
    root.UserConfig?.country_code,
    root.UserConfig?.COUNTRY,
  );
  const pageParts = [
    options.pageText,
    options.pageHtml,
    documentRef?.documentElement?.innerHTML,
    documentRef?.body?.textContent,
    locationRef?.href,
  ].filter(Boolean);
  const text = decodeHtmlAttribute(pageParts.join("\n"))
    // Steam's SSR payload is commonly embedded as JSON with escaped quotes.
    .replace(/\\(["'])/g, "$1");
  const isHongKongAccount = String(directCountry || "").trim().toUpperCase() === "HK";
  if (!text) return isHongKongAccount ? CURRENCY_IDS.HKD : null;

  const idPatterns = [
    /wallet_currency["']?\s*[:=]\s*["']?(\d+)/i,
    /(?:data-)?currency(?:-id)?["']?\s*[:=]\s*["']?(\d+)/i,
    /[?&]currency=(\d+)(?:&|$)/i,
    /eCurrency["']?\s*[:=]\s*["']?(\d+)/i,
  ];
  for (const pattern of idPatterns) {
    const match = text.match(pattern);
    const currencyId = normalizeCurrencyId(match?.[1]);
    if (currencyId != null) return currencyId;
  }

  if (/\b(?:CNY|RMB)\b/i.test(text) || /[¥￥]\s*[+-]?\d/.test(text)) {
    return CURRENCY_IDS.CNY;
  }
  if (/\bHKD\b/i.test(text) || /HK\$\s*[+-]?\d/i.test(text)) {
    return CURRENCY_IDS.HKD;
  }
  if (/(?:country_code|COUNTRY|country)[\\"']?\s*[:=]\s*[\\"']?HK\b/i.test(text)) {
    return CURRENCY_IDS.HKD;
  }
  if (isHongKongAccount) {
    return CURRENCY_IDS.HKD;
  }
  if (/\bUSD\b/i.test(text) || /\$\s*[+-]?\d/.test(text)) {
    return CURRENCY_IDS.USD;
  }
  return null;
}

function normalizeDetectionOptions(value) {
  if (!value || typeof value !== "object") {
    return value == null ? {} : { configuredCurrencyId: value };
  }
  const detectionKeys = [
    "walletInfo",
    "configuredCurrencyId",
    "applicationConfigWalletInfo",
    "applicationConfig",
    "document",
    "pageText",
    "pageHtml",
    "location",
  ];
  return detectionKeys.some(key => Object.hasOwn(value, key))
    ? value
    : { walletInfo: value };
}

/**
 * Detection order is deliberately stable: walletInfo, application_config,
 * page clues, then the configured currency fallback.
 */
export function detectCurrencyContext(input = {}) {
  const options = normalizeDetectionOptions(input);
  const root = globalObject();
  const walletInfo = parseWalletInfo(
    Object.hasOwn(options, "walletInfo") ? options.walletInfo : root.g_rgWalletInfo,
  );
  if (currencyIdFromObject(walletInfo) != null) {
    return createCurrencyContext(walletInfo, { source: "walletInfo", isFallback: false });
  }

  const configWalletInfo = readApplicationConfigWalletInfo(options);
  if (currencyIdFromObject(configWalletInfo) != null) {
    return createCurrencyContext(configWalletInfo, {
      source: "application_config",
      isFallback: false,
    });
  }

  const detectedPageCurrencyId = pageCurrencyId(options);
  if (detectedPageCurrencyId != null) {
    return createCurrencyContext(detectedPageCurrencyId, { source: "page", isFallback: false });
  }

  const configuredCurrencyId = normalizeCurrencyId(options.configuredCurrencyId);
  if (configuredCurrencyId != null) {
    return createCurrencyContext(configuredCurrencyId, {
      source: "configured",
      isFallback: true,
    });
  }

  return createCurrencyContext(null, { source: "unresolved", isFallback: true });
}

export function initializeCurrencyContext(options = {}) {
  activeCurrencyContext = detectCurrencyContext(options);
  return activeCurrencyContext;
}

export const initCurrencyContext = initializeCurrencyContext;

export function setActiveCurrencyContext(context) {
  if (context == null) {
    activeCurrencyContext = null;
    return null;
  }
  activeCurrencyContext = createCurrencyContext(context, {
    source: context?.source || "manual",
    isFallback: context?.isFallback || false,
  });
  return activeCurrencyContext;
}

export function clearActiveCurrencyContext() {
  activeCurrencyContext = null;
}

export function getActiveCurrencyContext() {
  return activeCurrencyContext;
}

export function getCurrencyContextById(currencyId) {
  return createCurrencyContext(currencyId, { source: "definition", isFallback: false });
}

export function resolveCurrencyContext(context) {
  if (context == null) {
    return activeCurrencyContext
      || createCurrencyContext(null, { source: "unresolved", isFallback: true });
  }
  if (typeof context === "number" || typeof context === "string") {
    return createCurrencyContext(context, { source: "manual", isFallback: false });
  }
  if (context.currencyContext) return resolveCurrencyContext(context.currencyContext);
  if (currencyIdFromObject(context) != null || isWalletInfoLike(context)) {
    return createCurrencyContext(context, {
      source: context.source || (isWalletInfoLike(context) ? "walletInfo" : "manual"),
      isFallback: context.isFallback || false,
    });
  }
  return activeCurrencyContext
    || createCurrencyContext(null, { source: "unresolved", isFallback: true });
}

function formatArguments(contextOrOptions, maybeOptions) {
  const looksLikeOptions = contextOrOptions
    && typeof contextOrOptions === "object"
    && (
      Object.hasOwn(contextOrOptions, "useGrouping")
      || Object.hasOwn(contextOrOptions, "invalidPlaceholder")
    )
    && currencyIdFromObject(contextOrOptions) == null
    && !contextOrOptions.currencyContext;
  return looksLikeOptions
    ? { context: resolveCurrencyContext(), options: contextOrOptions }
    : { context: resolveCurrencyContext(contextOrOptions), options: maybeOptions || {} };
}

function minorAmountToBigInt(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) ? BigInt(value) : null;
  }
  const text = String(value ?? "").trim();
  return /^[+-]?\d+$/.test(text) ? BigInt(text) : null;
}

export function formatMinorAmount(amount, contextOrOptions, maybeOptions) {
  const { context, options } = formatArguments(contextOrOptions, maybeOptions);
  const minorAmount = minorAmountToBigInt(amount);
  if (minorAmount == null) return options.invalidPlaceholder || "?";

  const negative = minorAmount < 0n;
  const absolute = negative ? -minorAmount : minorAmount;
  const digits = context.decimalDigits;
  const factor = 10n ** BigInt(digits);
  const major = digits > 0 ? absolute / factor : absolute;
  const fraction = digits > 0 ? absolute % factor : 0n;
  let majorText = major.toString();
  if (options.useGrouping !== false && context.groupSeparator) {
    majorText = majorText.replace(/\B(?=(\d{3})+(?!\d))/g, context.groupSeparator);
  }
  const fractionText = digits > 0
    ? `${context.decimalSeparator}${fraction.toString().padStart(digits, "0")}`
    : "";
  return `${negative ? "-" : ""}${majorText}${fractionText}`;
}

export function formatMoney(amount, contextOrOptions, maybeOptions) {
  const { context, options } = formatArguments(contextOrOptions, maybeOptions);
  const formatted = formatMinorAmount(amount, context, options);
  const invalidPlaceholder = options.invalidPlaceholder || "?";
  if (formatted === invalidPlaceholder) return invalidPlaceholder;

  const negative = formatted.startsWith("-");
  const unsigned = negative ? formatted.slice(1) : formatted;
  const spacing = context.symbolSpacing ? "\u00a0" : "";
  const signedPrefix = negative ? "-" : "";
  return context.symbolPosition === "after"
    ? `${signedPrefix}${unsigned}${spacing}${context.symbol}`
    : `${signedPrefix}${context.symbol}${spacing}${unsigned}`;
}

function numberToken(value) {
  const normalized = String(value)
    .replace(/[−–—]/g, "-")
    .replace(/，/g, ",")
    .replace(/。/g, ".");
  return normalized.match(/[+-]?(?:\d[\d\s\u00a0\u202f.,']*|[.,]\d+)/)?.[0] || "";
}

/** Parse a displayed major-unit amount and return an integer minor-unit amount. */
export function parseCurrencyAmount(value, contextInput) {
  const context = resolveCurrencyContext(contextInput);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const minor = Math.round(value * context.minorUnitFactor);
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof value === "bigint") {
    const minor = value * BigInt(context.minorUnitFactor);
    return minor <= BigInt(Number.MAX_SAFE_INTEGER)
      && minor >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(minor)
      : null;
  }

  const original = String(value ?? "").trim();
  if (!original) return null;
  const normalizedOriginal = original.replace(/[−–—]/g, "-");
  const parenthesizedNegative = /^\s*\(.*\)\s*$/.test(normalizedOriginal);
  let token = numberToken(original);
  if (!token) return null;
  const negative = parenthesizedNegative
    || token.trim().startsWith("-")
    || /^\s*-\s*[^\d]*\d/.test(normalizedOriginal);
  token = token.replace(/[+-]/g, "").replace(/[\s\u00a0\u202f']/g, "");

  const decimalSeparator = context.decimalSeparator;
  const groupSeparator = context.groupSeparator;
  const decimalParts = decimalSeparator ? token.split(decimalSeparator) : [token];
  if (decimalParts.length > 2) return null;
  let integerText = decimalParts[0] || "0";
  const fractionText = decimalParts[1] || "";
  if (fractionText && !/^\d+$/.test(fractionText)) return null;
  if (fractionText.length > context.decimalDigits) return null;

  if (groupSeparator && groupSeparator !== decimalSeparator && integerText.includes(groupSeparator)) {
    const groups = integerText.split(groupSeparator);
    if (!/^\d{1,3}$/.test(groups[0]) || groups.slice(1).some(group => !/^\d{3}$/.test(group))) {
      return null;
    }
    integerText = groups.join("");
  }
  if (!/^\d+$/.test(integerText)) return null;

  const paddedFraction = fractionText.padEnd(context.decimalDigits, "0");
  const major = BigInt(integerText);
  const fraction = paddedFraction ? BigInt(paddedFraction) : 0n;
  let minor = major * BigInt(context.minorUnitFactor) + fraction;
  if (negative) minor = -minor;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    return null;
  }
  return Number(minor);
}

export function getCurrencyStatus(contextInput) {
  const context = resolveCurrencyContext(contextInput);
  const label = context.verified
    ? `${context.code}${context.isFallback ? " (fallback)" : ""}`
    : `${context.code} (unverified)`;
  return Object.freeze({
    currencyId: context.currencyId,
    code: context.code,
    status: context.status,
    verified: context.verified,
    isFallback: context.isFallback,
    source: context.source,
    label,
  });
}
