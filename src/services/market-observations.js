import { upsertManyStoredMarketCache } from "./market-cache.js";
import { upsertManyStoredMarketHistory } from "./market-history.js";

const HISTORY_FIELDS = [
  "lowestSellMinor",
  "medianMinor",
  "highestBuyMinor",
  "volume",
];

function hasHistoryData(record) {
  return HISTORY_FIELDS.some(field => record?.[field] !== null && record?.[field] !== undefined);
}

function hasActionableDiagnostics(result) {
  return result?.diagnostics?.some(item => (
    item.code !== "gm-get-unavailable" && item.code !== "gm-set-unavailable"
  ));
}

function warnSkippedStore(label, result) {
  if (hasActionableDiagnostics(result)) {
    console.warn(`[STCH] ${label} update skipped:`, result.diagnostics);
  }
}

function skippedHistoryResult() {
  return {
    ok: true,
    saved: false,
    skipped: true,
    diagnostics: [],
  };
}

/**
 * Persist canonical market observations to both the latest-value cache and the
 * bounded time-series store. Callers should pass a complete logical batch so
 * each store performs at most one read/write transaction.
 */
export function persistMarketObservations(observations, options = {}) {
  const records = (Array.isArray(observations) ? observations : [observations]).filter(Boolean);
  if (records.length === 0) {
    const skipped = skippedHistoryResult();
    return {
      ok: true,
      saved: false,
      cache: { ...skipped },
      history: skipped,
    };
  }

  const cache = upsertManyStoredMarketCache(records, options.cacheOptions);
  warnSkippedStore("Market cache", cache);

  const historyRecords = records.filter(hasHistoryData);
  const history = historyRecords.length > 0
    ? upsertManyStoredMarketHistory(historyRecords, options.historyOptions)
    : skippedHistoryResult();
  warnSkippedStore("Market history", history);

  return {
    ok: Boolean(cache?.ok) && Boolean(history?.ok),
    saved: Boolean(cache?.saved) || Boolean(history?.saved),
    cache,
    history,
  };
}
