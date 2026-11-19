const DEFAULT_DECIMAL_DIGITS = 2;
const DEFAULT_STEAM_FEE_RATE = 0.05;
const DEFAULT_PUBLISHER_FEE_RATE = 0.10;

// Steam Community global.js currency formats, limited to live Steam wallet currencies.
const definitions = [
  [1, "USD", "$", false, false, false, ".", ","],
  [2, "GBP", "£", false, false, false, ".", ","],
  [3, "EUR", "€", true, false, false, ",", " "],
  [4, "CHF", "CHF", false, true, false, ".", " "],
  [5, "RUB", "руб.", true, true, false, ",", ""],
  [6, "PLN", "zł", true, true, false, ",", " "],
  [7, "BRL", "R$", false, true, false, ",", "."],
  [8, "JPY", "¥", false, true, true, ".", ","],
  [9, "NOK", "kr", true, true, false, ",", "."],
  [10, "IDR", "Rp", false, true, true, ".", " "],
  [11, "MYR", "RM", false, false, false, ".", ","],
  [12, "PHP", "P", false, false, false, ".", ","],
  [13, "SGD", "S$", false, false, false, ".", ","],
  [14, "THB", "฿", false, false, false, ".", ","],
  [15, "VND", "₫", true, false, true, ",", "."],
  [16, "KRW", "₩", false, true, true, ".", ","],
  [18, "UAH", "₴", true, false, true, ",", " "],
  [19, "MXN", "Mex$", false, true, false, ".", ","],
  [20, "CAD", "CDN$", false, true, false, ".", ","],
  [21, "AUD", "A$", false, true, false, ".", ","],
  [22, "NZD", "NZ$", false, true, false, ".", ","],
  [23, "CNY", "¥", false, false, false, ".", ","],
  [24, "INR", "₹", false, true, true, ".", ","],
  [25, "CLP", "CLP$", false, true, true, ",", "."],
  [26, "PEN", "S/.", false, false, false, ".", ","],
  [27, "COP", "COL$", false, true, true, ",", "."],
  [28, "ZAR", "R", false, true, false, ".", " "],
  [29, "HKD", "HK$", false, true, false, ".", ","],
  [30, "TWD", "NT$", false, true, true, ".", ","],
  [31, "SAR", "SR", true, true, false, ".", ","],
  [32, "AED", "AED", true, true, false, ".", ","],
  [35, "ILS", "₪", false, false, false, ".", ","],
  [37, "KZT", "₸", true, false, true, ",", " "],
  [38, "KWD", "KD", true, true, false, ".", ","],
  [39, "QAR", "QR", true, true, false, ".", ","],
  [40, "CRC", "₡", false, false, true, ",", "."],
  [41, "UYU", "$U", false, false, true, ",", "."],
];
export const CURRENCY_IDS = Object.freeze(Object.fromEntries(definitions.map(([id, code]) => [code, id])));
const CURRENCY_DEFINITION_MAP = new Map(definitions.map(
  ([currencyId, code, symbol, suffix, symbolSpacing, wholeUnits, decimalSeparator, groupSeparator]) => [
    currencyId, { code, symbol, symbolPosition: suffix ? "after" : "before", symbolSpacing, wholeUnits, decimalSeparator, groupSeparator },
  ],
));

let activeCurrencyContext = null;
const normalizedCurrencyContexts = new WeakSet();

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== "");
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
    if (normalized === "RMB") return CURRENCY_IDS.CNY;
    if (Object.hasOwn(CURRENCY_IDS, normalized)) return CURRENCY_IDS[normalized];
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
      || Object.hasOwn(value, "wallet_currency_code")
      || Object.hasOwn(value, "wallet_market_minimum")
      || Object.hasOwn(value, "wallet_fee_percent")
      || Object.hasOwn(value, "wallet_fee_minimum")
    )
  );
}

function currencyDefaults(currencyId) {
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
    steamFeeRate: DEFAULT_STEAM_FEE_RATE,
    publisherFeeRate: DEFAULT_PUBLISHER_FEE_RATE,
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
 * and the wallet supplies the account-specific fees and price increment.
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
  const knownDefinition = CURRENCY_DEFINITION_MAP.get(currencyId);
  const base = { ...currencyDefaults(currencyId), ...knownDefinition };
  const override = { ...walletInfo, ...supplied };

  // Unknown numeric IDs stay generic even if unrelated page text is misleading.
  const decimalDigits = base.decimalDigits;
  const marketMinimumMinor = toPositiveInteger(firstDefined(
    override.marketMinimumMinor,
    override.walletMarketMinimumMinor,
    override.wallet_market_minimum,
  ), null);
  const steamFeeRate = toRate(firstDefined(override.steamFeeRate, override.wallet_fee_percent), base.steamFeeRate);
  const publisherFeeRate = toRate(firstDefined(override.publisherFeeRate, override.wallet_publisher_fee_percent_default), base.publisherFeeRate);
  const feesEnabled = firstDefined(override.wallet_fee, override.feesEnabled, 1) != 0;
  const incrementMinor = toPositiveInteger(firstDefined(override.incrementMinor, override.wallet_currency_increment), 1);
  const floor = marketMinimumMinor == null ? null : marketMinimumMinor * (
    1 + Number(feesEnabled && steamFeeRate > 0) + Number(feesEnabled && publisherFeeRate > 0)
  );
  const verified = Boolean(knownDefinition);
  const source = String(firstDefined(metadata.source, override.source, "manual"));
  const isFallback = Boolean(firstDefined(metadata.isFallback, override.isFallback, false));
  const status = verified ? (isFallback ? "fallback" : "verified") : "unverified";
  const code = base.code;

  const context = Object.freeze({
    currencyId,
    id: currencyId,
    currency: currencyId,
    code,
    currencyCode: code,
    name: knownDefinition?.code || base.name,
    wholeUnits: Boolean(base.wholeUnits),
    incrementMinor,
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
    minimumBuyerMinor: floor,
    marketMinimumBuyerMinor: floor,
    steamFeeRate,
    publisherFeeRate,
    feesEnabled,
    steamFeeMinimumMinor: marketMinimumMinor,
    publisherFeeMinimumMinor: marketMinimumMinor,
    steamFeeBaseMinor: 0,
    verified,
    isVerified: verified,
    unverified: !verified,
    isUnverified: !verified,
    verification: verified ? "verified" : "unverified",
    status,
    source,
    isFallback,
  });
  normalizedCurrencyContexts.add(context);
  return context;
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
  if (isWalletInfoLike(direct) || currencyIdFromObject(direct) != null) return direct;

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
    if (isWalletInfoLike(parsed) || currencyIdFromObject(parsed) != null) return parsed;
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
  return isWalletInfoLike(parsed) || currencyIdFromObject(parsed) != null ? parsed : null;
}

function pageCurrencyId(options) {
  const doc = options.document || globalObject().document;
  const root = globalObject();
  const marketCurrency = normalizeCurrencyId(root.g_nWalletCurrency);
  if (marketCurrency) return marketCurrency;
  const walletBalance = options.pageText ?? doc?.querySelector?.("#header_wallet_balance")?.textContent ?? "";
  const balance = String(walletBalance).trim().toUpperCase();
  let balanceCurrency = null;
  if (/\d/.test(balance)) {
    for (const [id, code, symbol] of definitions) {
      const marker = symbol.toUpperCase();
      const hasCode = balance.startsWith(code) || balance.endsWith(code);
      // The dollar and yen signs each occur in multiple wallet currencies.
      if (!hasCode && (marker === "$" || marker === "¥" || !(balance.startsWith(marker) || balance.endsWith(marker)))) continue;
      if (parseCurrencyAmount(balance, id) != null) {
        balanceCurrency = id;
        break;
      }
    }
  }
  if (balanceCurrency) return balanceCurrency;

  const location = options.location || root.location;
  const ssr = /^\/market(?:\/|$)/.test(location?.pathname || "") && doc?.getElementById?.("valve-ssr-data")?.textContent;
  if (ssr) {
    try {
      for (const raw of JSON.parse(ssr).loaderData || []) {
        if (typeof raw !== "string" || !raw.includes('"filterConfig"')) continue;
        const id = normalizeCurrencyId(JSON.parse(raw)?.filterConfig?.currency?.eCurrency);
        if (id) return id;
      }
    } catch (_) {}
  }
  if (/\d/.test(balance) && parseCurrencyAmount(balance, options.configuredCurrencyId || 0) == null) return 0;
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
    "location",
  ];
  return (!Object.keys(value).length || detectionKeys.some(key => Object.hasOwn(value, key)))
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
  if (walletInfo && (isWalletInfoLike(walletInfo) || currencyIdFromObject(walletInfo) != null)) {
    return createCurrencyContext(walletInfo, { source: "walletInfo", isFallback: false });
  }

  const configWalletInfo = readApplicationConfigWalletInfo(options);
  if (configWalletInfo) {
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

const knownContexts = new Map();
export function getCurrencyContextById(currencyId) {
  const id = normalizeCurrencyId(currencyId);
  if (knownContexts.has(id)) return knownContexts.get(id);
  const context = createCurrencyContext(id, { source: "definition", isFallback: false });
  if (context.verified) knownContexts.set(id, context);
  return context;
}

export function resolveCurrencyContext(context) {
  if (context == null) {
    return activeCurrencyContext
      || createCurrencyContext(null, { source: "unresolved", isFallback: true });
  }
  if (typeof context === "number" || typeof context === "string") {
    return getCurrencyContextById(context);
  }
  if (normalizedCurrencyContexts.has(context)) return context;
  if (context.currencyContext) return resolveCurrencyContext(context.currencyContext);
  if (currencyIdFromObject(context) != null || isWalletInfoLike(context)) {
    return createCurrencyContext(context, {
      source: context.source || (isWalletInfoLike(context) ? "walletInfo" : "manual"),
      isFallback: context.isFallback || false,
    });
  }
  return createCurrencyContext(null, { source: "unresolved", isFallback: true });
}

function formatArguments(contextOrOptions, maybeOptions) {
  const looksLikeOptions = contextOrOptions
    && typeof contextOrOptions === "object"
    && (
      Object.hasOwn(contextOrOptions, "fractionalMinor")
      || Object.hasOwn(contextOrOptions, "useGrouping")
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

function formatMinorAmountWithContext(amount, context, options) {
  // A gem yield can be worth a fraction of one minor unit (one sack is 1000 gems).
  const showFraction = options.fractionalMinor && Number.isFinite(amount) && !Number.isInteger(amount);
  if (!context.verified) return options.invalidPlaceholder || "?";
  const minorAmount = minorAmountToBigInt(showFraction ? Math.round(amount * 1000) : amount);
  if (minorAmount == null) return options.invalidPlaceholder || "?";

  const negative = minorAmount < 0n;
  const absolute = negative ? -minorAmount : minorAmount;
  const digits = context.decimalDigits + (showFraction ? 3 : 0);
  const factor = 10n ** BigInt(digits);
  const major = digits > 0 ? absolute / factor : absolute;
  const fraction = digits > 0 ? absolute % factor : 0n;
  let majorText = major.toString();
  if (options.useGrouping !== false && context.groupSeparator) {
    majorText = majorText.replace(/\B(?=(\d{3})+(?!\d))/g, context.groupSeparator);
  }
  let decimals = digits ? fraction.toString().padStart(digits, "0") : "";
  if (showFraction) decimals = decimals.slice(0, -3) + decimals.slice(-3).replace(/0+$/, "");
  if (context.wholeUnits && /^0+$/.test(decimals)) decimals = "";
  const fractionText = decimals ? context.decimalSeparator + decimals : "";
  return `${negative ? "-" : ""}${majorText}${fractionText}`;
}

export function formatMinorAmount(amount, contextOrOptions, maybeOptions) {
  const { context, options } = formatArguments(contextOrOptions, maybeOptions);
  return formatMinorAmountWithContext(amount, context, options);
}

export function formatMoney(amount, contextOrOptions, maybeOptions) {
  const { context, options } = formatArguments(contextOrOptions, maybeOptions);
  const formatted = formatMinorAmountWithContext(amount, context, options);
  const invalidPlaceholder = options.invalidPlaceholder || "?";
  if (formatted === invalidPlaceholder) return invalidPlaceholder;

  const negative = formatted.startsWith("-");
  let unsigned = negative ? formatted.slice(1) : formatted;
  if (context.code === "EUR") unsigned = unsigned.replace(/,00$/, ",--");
  const spacing = context.symbolSpacing ? "\u00a0" : "";
  const signedPrefix = negative ? "-" : "";
  return context.symbolPosition === "after"
    ? `${signedPrefix}${unsigned}${spacing}${context.symbol}`
    : `${signedPrefix}${context.symbol}${spacing}${unsigned}`;
}

/** Round Steam's hundredths to the wallet's permitted market price. */
export function roundMarketAmount(amount, contextInput) {
  const context = resolveCurrencyContext(contextInput);
  if (!context.verified || !context.marketMinimumMinor || !Number.isFinite(amount)) return null;
  if (amount <= context.marketMinimumMinor) return context.marketMinimumMinor;
  return Math.max(1, Math.round(amount / context.incrementMinor)) * context.incrementMinor;
}

/** Parse a major-unit market price only when any accompanying currency markers agree. */
export function parseCurrencyAmount(value, contextInput) {
  const context = resolveCurrencyContext(contextInput);
  if (!context.verified) return null;
  if (typeof value === "number") {
    const minor = Math.round(value * context.minorUnitFactor);
    return Number.isSafeInteger(minor) ? minor : null;
  }
  let text = String(value ?? "").trim().replace(/[−–—]/g, "-").replace(/￥/g, "¥");
  if (context.code === "EUR") text = text.replace(/([.,])--(?=\s*(?:€|EUR)?$)/i, "$100");
  const negative = text.startsWith("-") || (text.startsWith("(") && text.endsWith(")"));
  if (negative) text = (text.startsWith("-") ? text.slice(1) : text.slice(1, -1)).trim();

  const stripMarker = marker => {
    if (text.toUpperCase().startsWith(marker.toUpperCase())) text = text.slice(marker.length).trim();
    else if (text.toUpperCase().endsWith(marker.toUpperCase())) text = text.slice(0, -marker.length).trim();
  };
  stripMarker(context.code);
  stripMarker(context.symbol);
  if (context.symbol.includes("$")) stripMarker("$");
  if (/[\s'’]/.test(text) && !/^\d{1,3}(?:[\s'’]\d{3})+(?:[.,]\d{1,2})?$/.test(text)) return null;
  const token = text.replace(/[\s'’]/g, "");
  if (!/^(?:\d+|\d*[.,]\d+)(?:[.,]\d+)*$/.test(token)) return null;
  const parts = token.split(/[.,]/);
  const hasFraction = parts.length > 1 && parts.at(-1).length <= context.decimalDigits;
  const fraction = hasFraction ? parts.pop() : "";
  if (parts.length > 1) {
    const decimalAt = token.length - fraction.length - 1;
    const integerPart = hasFraction ? token.slice(0, decimalAt) : token;
    const grouping = integerPart.match(/[.,]/)?.[0];
    if (parts[0].length < 1 || parts[0].length > 3 || parts.slice(1).some(part => part.length !== 3)
      || (integerPart.includes(",") && integerPart.includes("."))
      || (hasFraction ? grouping === token[decimalAt] : grouping !== context.groupSeparator)) return null;
  }
  const minor = Number(parts.join("") || "0") * context.minorUnitFactor
    + Number(fraction.padEnd(context.decimalDigits, "0"));
  return Number.isSafeInteger(minor) ? (negative ? -minor : minor) : null;
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
