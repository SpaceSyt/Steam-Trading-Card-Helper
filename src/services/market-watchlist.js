export const MARKET_WATCHLIST_SCHEMA_VERSION = 1;
export const MARKET_WATCHLIST_STORAGE_KEY = "stch_market_watchlist";
export const DEFAULT_MARKET_WATCHLIST_MAX_ITEMS = 200;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, message, details = undefined) {
  return details === undefined
    ? { code, message, severity: "error" }
    : { code, message, severity: "error", details };
}

function normalizeCurrencyId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizeCount(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const number = Number(String(value).replace(/[\s,.'’]/g, ""));
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function normalizeTimestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.trunc(number) : null;
}

function deriveDisplayName(marketHashName) {
  return String(marketHashName || "").replace(/^\d+-/, "").trim() || marketHashName;
}

export function getMarketWatchlistKey(identity) {
  const appid = String(identity?.appid ?? "753").trim();
  const marketHashName = String(
    identity?.marketHashName ?? identity?.market_hash_name ?? ""
  ).trim();
  return appid && marketHashName
    ? JSON.stringify([appid, marketHashName])
    : null;
}

export function normalizeMarketWatchItem(item, now = Date.now()) {
  if (!isObject(item)) return null;
  const appid = String(item.appid ?? "753").trim();
  const marketHashName = String(item.marketHashName ?? item.market_hash_name ?? "").trim();
  const currencyId = normalizeCurrencyId(item.currencyId ?? item.currency);
  if (!appid || !marketHashName || currencyId === null) return null;
  const addedAtValue = Number(item.addedAt);
  const addedAt = Number.isFinite(addedAtValue) && addedAtValue >= 0
    ? Math.trunc(addedAtValue)
    : Math.trunc(now);
  const sellOrderCount = normalizeCount(item.sellOrderCount ?? item.sell_order_count);
  return {
    appid,
    marketHashName,
    currencyId,
    displayName: String(item.displayName ?? item.name ?? "").trim()
      || deriveDisplayName(marketHashName),
    imageUrl: String(item.imageUrl ?? item.image_url ?? "").trim(),
    addedAt,
    sellOrderCount,
    metadataObservedAt: sellOrderCount === null
      ? null
      : normalizeTimestamp(item.metadataObservedAt ?? item.metadata_observed_at),
  };
}

function mergeWatchItems(previous, next) {
  const fallbackName = deriveDisplayName(next.marketHashName);
  const nextHasRichName = next.displayName && next.displayName !== fallbackName;
  const previousHasRichName = previous.displayName && previous.displayName !== fallbackName;
  const nextMetadataIsNewer = next.sellOrderCount !== null
    && next.metadataObservedAt !== null
    && (
      previous.metadataObservedAt === null
      || next.metadataObservedAt >= previous.metadataObservedAt
    );
  return {
    ...previous,
    currencyId: next.currencyId,
    displayName: nextHasRichName || !previousHasRichName
      ? next.displayName
      : previous.displayName,
    imageUrl: next.imageUrl || previous.imageUrl,
    addedAt: Math.min(previous.addedAt, next.addedAt),
    sellOrderCount: nextMetadataIsNewer && next.sellOrderCount !== null
      ? next.sellOrderCount
      : previous.sellOrderCount,
    metadataObservedAt: nextMetadataIsNewer
      ? next.metadataObservedAt
      : previous.metadataObservedAt,
  };
}

export function normalizeMarketWatchlist(value, options = {}) {
  const input = Array.isArray(value)
    ? value
    : isObject(value) && Array.isArray(value.items) ? value.items : [];
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const byKey = new Map();
  input.forEach(item => {
    const normalized = normalizeMarketWatchItem(item, now);
    const key = getMarketWatchlistKey(normalized);
    if (!normalized || !key) return;
    const previous = byKey.get(key);
    byKey.set(key, previous ? mergeWatchItems(previous, normalized) : normalized);
  });
  const maxValue = options.maxItems === undefined
    ? DEFAULT_MARKET_WATCHLIST_MAX_ITEMS
    : Number(options.maxItems);
  const items = [...byKey.values()];
  const limit = Number.isFinite(maxValue) ? Math.max(0, Math.floor(maxValue)) : items.length;
  return {
    schemaVersion: MARKET_WATCHLIST_SCHEMA_VERSION,
    items: items.length > limit ? items.slice(items.length - limit) : items,
  };
}

export function decodeMarketWatchlist(raw, options = {}) {
  if (raw === null || raw === undefined || raw === "" || String(raw).trim() === "") {
    return {
      ok: true,
      envelope: normalizeMarketWatchlist([], options),
      diagnostics: [],
    };
  }
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        envelope: null,
        diagnostics: [diagnostic("invalid-json", "Market watchlist is not valid JSON.", {
          error: String(error?.message || error),
        })],
      };
    }
  }
  if (!isObject(parsed) || !Array.isArray(parsed.items)) {
    return {
      ok: false,
      envelope: null,
      diagnostics: [diagnostic("invalid-envelope", "Market watchlist must contain an items array.")],
    };
  }
  if (Number(parsed.schemaVersion) !== MARKET_WATCHLIST_SCHEMA_VERSION) {
    return {
      ok: false,
      envelope: null,
      diagnostics: [diagnostic(
        "unsupported-schema-version",
        `Market watchlist schema ${parsed.schemaVersion} is not supported.`
      )],
    };
  }
  const invalidItemCount = parsed.items.reduce((count, item) => (
    normalizeMarketWatchItem(item, options.now) ? count : count + 1
  ), 0);
  if (invalidItemCount > 0) {
    return {
      ok: false,
      envelope: normalizeMarketWatchlist(parsed, options),
      diagnostics: [diagnostic(
        "invalid-items",
        `${invalidItemCount} invalid market watchlist item(s) were left untouched.`,
        { count: invalidItemCount }
      )],
    };
  }
  return {
    ok: true,
    envelope: normalizeMarketWatchlist(parsed, options),
    diagnostics: [],
  };
}

export function upsertMarketWatchlist(watchlist, item, options = {}) {
  const normalized = normalizeMarketWatchItem(item, options.now);
  const key = getMarketWatchlistKey(normalized);
  if (!normalized || !key) throw new TypeError("A watchlist item requires appid, marketHashName, and currencyId.");
  const envelope = normalizeMarketWatchlist(watchlist, options);
  const index = envelope.items.findIndex(existing => getMarketWatchlistKey(existing) === key);
  const items = [...envelope.items];
  if (index < 0) {
    items.push(normalized);
  } else {
    items[index] = mergeWatchItems(items[index], normalized);
  }
  return normalizeMarketWatchlist({ ...envelope, items }, options);
}

export function removeMarketWatchlistItem(watchlist, identity, options = {}) {
  const key = getMarketWatchlistKey(identity);
  const envelope = normalizeMarketWatchlist(watchlist, options);
  if (!key) return envelope;
  return {
    ...envelope,
    items: envelope.items.filter(item => getMarketWatchlistKey(item) !== key),
  };
}

function getValueFunction(explicit) {
  if (typeof explicit === "function") return explicit;
  return typeof GM_getValue === "function" ? GM_getValue : null;
}

function setValueFunction(explicit) {
  if (typeof explicit === "function") return explicit;
  return typeof GM_setValue === "function" ? GM_setValue : null;
}

export function loadMarketWatchlist(options = {}) {
  const getValue = getValueFunction(options.getValue);
  if (!getValue) {
    return {
      ok: false,
      envelope: null,
      diagnostics: [diagnostic("gm-get-unavailable", "GM_getValue is not available.")],
    };
  }
  const storageKey = options.storageKey || MARKET_WATCHLIST_STORAGE_KEY;
  try {
    return {
      ...decodeMarketWatchlist(getValue(storageKey, null), options),
      storageKey,
    };
  } catch (error) {
    return {
      ok: false,
      envelope: null,
      storageKey,
      diagnostics: [diagnostic("gm-read-failed", "Failed to read market watchlist.", {
        error: String(error?.message || error),
      })],
    };
  }
}

function saveEnvelope(envelope, options = {}) {
  const setValue = setValueFunction(options.setValue);
  const storageKey = options.storageKey || MARKET_WATCHLIST_STORAGE_KEY;
  if (!setValue) {
    return {
      ok: false,
      saved: false,
      envelope: null,
      storageKey,
      diagnostics: [diagnostic("gm-set-unavailable", "GM_setValue is not available.")],
    };
  }
  try {
    setValue(storageKey, JSON.stringify(envelope));
    return { ok: true, saved: true, envelope, storageKey, diagnostics: [] };
  } catch (error) {
    return {
      ok: false,
      saved: false,
      envelope,
      storageKey,
      diagnostics: [diagnostic("gm-write-failed", "Failed to write market watchlist.", {
        error: String(error?.message || error),
      })],
    };
  }
}

export function upsertStoredMarketWatchItem(item, options = {}) {
  const loaded = loadMarketWatchlist(options);
  if (!loaded.ok || !loaded.envelope) return { ...loaded, saved: false };
  const envelope = upsertMarketWatchlist(loaded.envelope, item, options);
  if (JSON.stringify(envelope) === JSON.stringify(loaded.envelope)) {
    return { ...loaded, saved: false };
  }
  return saveEnvelope(envelope, options);
}

export function removeStoredMarketWatchItem(identity, options = {}) {
  const loaded = loadMarketWatchlist(options);
  if (!loaded.ok || !loaded.envelope) return { ...loaded, saved: false, removed: false };
  const before = loaded.envelope.items.length;
  const envelope = removeMarketWatchlistItem(loaded.envelope, identity, options);
  const removed = envelope.items.length < before;
  if (!removed) return { ...loaded, saved: false, removed: false };
  return { ...saveEnvelope(envelope, options), removed: true };
}
