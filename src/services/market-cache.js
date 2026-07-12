import {
  MARKET_DATA_SCHEMA_VERSION,
  normalizeMarketRecord,
} from "./market-data.js";

export const MARKET_CACHE_SCHEMA_VERSION = 1;
export const MARKET_CACHE_STORAGE_KEY = "stch_market_cache";
export const DEFAULT_MARKET_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const DEFAULT_MARKET_CACHE_MAX_ENTRIES = 5000;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function diagnostic(code, message, severity = "error", details = undefined) {
  return details === undefined
    ? { code, message, severity }
    : { code, message, severity, details };
}

function emptyEnvelope() {
  return {
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records: [],
  };
}

function getInputRecords(value) {
  if (Array.isArray(value)) return value;
  return isObject(value) && Array.isArray(value.records) ? value.records : [];
}

function normalizeCacheRecords(records) {
  const byKey = new Map();
  let invalidCount = 0;
  let duplicateCount = 0;
  let migratedSchemaCount = 0;
  let unsupportedSchemaCount = 0;

  records.forEach(record => {
    if (!isObject(record)) {
      invalidCount += 1;
      return;
    }

    if (record.schemaVersion === undefined || record.schemaVersion === null) {
      migratedSchemaCount += 1;
    } else {
      const recordSchemaVersion = Number(record.schemaVersion);
      if (!Number.isInteger(recordSchemaVersion) || recordSchemaVersion <= 0) {
        migratedSchemaCount += 1;
      } else if (recordSchemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
        unsupportedSchemaCount += 1;
        return;
      }
    }

    const normalized = normalizeMarketRecord(record);
    const key = getMarketCacheKey(normalized);
    if (!normalized || key === null || normalized.observedAt === null) {
      invalidCount += 1;
      return;
    }

    const previous = byKey.get(key);
    if (previous) duplicateCount += 1;
    if (!previous || normalized.observedAt >= previous.observedAt) {
      byKey.set(key, normalized);
    }
  });

  return {
    records: [...byKey.values()],
    invalidCount,
    duplicateCount,
    migratedSchemaCount,
    unsupportedSchemaCount,
  };
}

export function createMarketCacheEnvelope(records = []) {
  return normalizeMarketCache({
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records,
  });
}

/**
 * A JSON tuple avoids collisions when names contain delimiters. Unknown
 * currencies are intentionally not cacheable, preventing cross-currency reuse.
 */
export function getMarketCacheKey(identity) {
  const normalized = normalizeMarketRecord(identity);
  if (!normalized || normalized.currencyId === null) return null;
  return JSON.stringify([
    normalized.appid,
    normalized.marketHashName,
    normalized.currencyId,
    normalized.source,
  ]);
}

/** Normalize and de-duplicate an envelope without mutating the input. */
export function normalizeMarketCache(value) {
  const records = normalizeCacheRecords(getInputRecords(value)).records;
  return {
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records,
  };
}

/**
 * Decode persisted data and return diagnostics instead of hiding corruption.
 * This function never writes or mutates the supplied raw value.
 */
export function decodeMarketCache(raw) {
  if (raw === null || raw === undefined || raw === "") {
    const envelope = emptyEnvelope();
    return {
      ok: true,
      envelope,
      cache: envelope,
      diagnostics: [],
      needsMigration: false,
    };
  }

  let parsed = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) {
      const envelope = emptyEnvelope();
      return {
        ok: true,
        envelope,
        cache: envelope,
        diagnostics: [],
        needsMigration: false,
      };
    }
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      return {
        ok: false,
        envelope: null,
        cache: null,
        diagnostics: [diagnostic(
          "invalid-json",
          "Market cache is not valid JSON; the stored value was left untouched.",
          "error",
          { error: String(error?.message || error) }
        )],
        needsMigration: false,
      };
    }
  }

  const diagnostics = [];
  let needsMigration = false;
  let records;

  if (Array.isArray(parsed)) {
    records = parsed;
    needsMigration = true;
    diagnostics.push(diagnostic(
      "legacy-array-envelope",
      "Legacy array cache was decoded in memory and has not been rewritten.",
      "warning"
    ));
  } else if (!isObject(parsed)) {
    return {
      ok: false,
      envelope: null,
      cache: null,
      diagnostics: [diagnostic(
        "invalid-envelope",
        "Market cache must be an object envelope or a legacy record array."
      )],
      needsMigration: false,
    };
  } else {
    if (!Array.isArray(parsed.records)) {
      return {
        ok: false,
        envelope: null,
        cache: null,
        diagnostics: [diagnostic(
          "invalid-records",
          "Market cache envelope has no records array; the stored value was left untouched."
        )],
        needsMigration: false,
      };
    }
    records = parsed.records;

    const schemaVersion = Number(parsed.schemaVersion);
    if (!Number.isInteger(schemaVersion) || schemaVersion <= 0) {
      needsMigration = true;
      diagnostics.push(diagnostic(
        "missing-schema-version",
        "Cache envelope has no valid schema version and was normalized in memory only.",
        "warning"
      ));
    } else if (schemaVersion !== MARKET_CACHE_SCHEMA_VERSION) {
      return {
        ok: false,
        envelope: null,
        cache: null,
        diagnostics: [diagnostic(
          "unsupported-schema-version",
          `Market cache schema ${schemaVersion} is not supported by schema ${MARKET_CACHE_SCHEMA_VERSION}.`,
          "error",
          { schemaVersion, supportedSchemaVersion: MARKET_CACHE_SCHEMA_VERSION }
        )],
        needsMigration: false,
      };
    }
  }

  const normalized = normalizeCacheRecords(records);
  const envelope = {
    schemaVersion: MARKET_CACHE_SCHEMA_VERSION,
    records: normalized.records,
  };

  if (normalized.invalidCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "invalid-records-dropped",
      `${normalized.invalidCount} invalid market cache record(s) were excluded in memory; storage was not rewritten.`,
      "error",
      { count: normalized.invalidCount }
    ));
  }
  if (normalized.unsupportedSchemaCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "unsupported-record-schema",
      `${normalized.unsupportedSchemaCount} record(s) use an unsupported market data schema and were excluded in memory.`,
      "error",
      { count: normalized.unsupportedSchemaCount, supportedSchemaVersion: MARKET_DATA_SCHEMA_VERSION }
    ));
  }
  if (normalized.migratedSchemaCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "record-schema-normalized",
      `${normalized.migratedSchemaCount} legacy record schema(s) were normalized in memory only.`,
      "warning",
      { count: normalized.migratedSchemaCount }
    ));
  }
  if (normalized.duplicateCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "duplicate-records-collapsed",
      `${normalized.duplicateCount} duplicate cache record(s) were collapsed to the newest observation in memory.`,
      "warning",
      { count: normalized.duplicateCount }
    ));
  }

  return {
    ok: !diagnostics.some(item => item.severity === "error"),
    envelope,
    cache: envelope,
    diagnostics,
    needsMigration,
  };
}

/** Upsert one exact app/item/currency/source identity without mutating input. */
export function upsertMarketCache(cache, record, options = {}) {
  const envelope = normalizeMarketCache(cache);
  if (
    isObject(record)
    && record.schemaVersion !== undefined
    && Number(record.schemaVersion) !== MARKET_DATA_SCHEMA_VERSION
  ) {
    throw new TypeError(`Unsupported market record schema ${record.schemaVersion}.`);
  }
  const normalized = normalizeMarketRecord(record);
  const key = getMarketCacheKey(normalized);
  if (!normalized || key === null || normalized.observedAt === null) {
    throw new TypeError("A cache record requires appid, marketHashName, currencyId, source, and observedAt.");
  }
  if (normalized.schemaVersion !== MARKET_DATA_SCHEMA_VERSION) {
    throw new TypeError(`Unsupported market record schema ${normalized.schemaVersion}.`);
  }

  const index = envelope.records.findIndex(item => getMarketCacheKey(item) === key);
  if (index < 0) {
    return {
      ...envelope,
      records: [...envelope.records, normalized],
    };
  }

  if (options.preferNewest !== false && envelope.records[index].observedAt > normalized.observedAt) {
    return envelope;
  }

  return {
    ...envelope,
    records: envelope.records.map((item, itemIndex) => itemIndex === index ? normalized : item),
  };
}

export function isMarketCacheRecordFresh(record, options = {}) {
  const observedAt = Number(record?.observedAt);
  if (!Number.isFinite(observedAt)) return false;

  const ttlMs = options.ttlMs === undefined
    ? DEFAULT_MARKET_CACHE_TTL_MS
    : Number(options.ttlMs);
  if (ttlMs === Infinity) return true;
  if (!Number.isFinite(ttlMs)) return false;

  const now = options.now === undefined ? Date.now() : Number(options.now);
  if (!Number.isFinite(now)) return false;
  return now - observedAt <= Math.max(0, ttlMs);
}

/** Find only an exact cache identity; source and currency are never optional. */
export function findMarketCache(cache, identity, options = {}) {
  const key = getMarketCacheKey(identity);
  if (key === null) return null;

  const record = normalizeMarketCache(cache).records.find(item => getMarketCacheKey(item) === key) || null;
  if (!record) return null;
  if (options.ttlMs !== undefined || options.now !== undefined) {
    return isMarketCacheRecordFresh(record, options) ? record : null;
  }
  return record;
}

/** Apply TTL and maximum-entry eviction while preserving retained record order. */
export function pruneMarketCache(cache, options = {}) {
  const envelope = normalizeMarketCache(cache);
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const ttlMs = options.ttlMs === undefined
    ? DEFAULT_MARKET_CACHE_TTL_MS
    : Number(options.ttlMs);
  const maxEntries = options.maxEntries === undefined
    ? DEFAULT_MARKET_CACHE_MAX_ENTRIES
    : Number(options.maxEntries);

  const ttlEnabled = ttlMs !== Infinity && Number.isFinite(ttlMs) && Number.isFinite(now);
  const effectiveTtl = ttlEnabled ? Math.max(0, ttlMs) : Infinity;
  const fresh = envelope.records.filter(record => (
    effectiveTtl === Infinity || now - record.observedAt <= effectiveTtl
  ));

  if (maxEntries === Infinity || !Number.isFinite(maxEntries)) {
    return { ...envelope, records: fresh };
  }

  const limit = Math.max(0, Math.floor(maxEntries));
  if (fresh.length <= limit) return { ...envelope, records: fresh };

  const retainedIndexes = new Set(
    fresh
      .map((record, index) => ({ index, observedAt: record.observedAt }))
      .sort((left, right) => right.observedAt - left.observedAt || right.index - left.index)
      .slice(0, limit)
      .map(item => item.index)
  );
  return {
    ...envelope,
    records: fresh.filter((_, index) => retainedIndexes.has(index)),
  };
}

function resolveGMGetValue(explicit) {
  if (typeof explicit === "function") return explicit;
  if (typeof GM_getValue === "function") return GM_getValue;
  return null;
}

function resolveGMSetValue(explicit) {
  if (typeof explicit === "function") return explicit;
  if (typeof GM_setValue === "function") return GM_setValue;
  return null;
}

/** Read and decode GM storage. This wrapper intentionally performs no write. */
export function loadMarketCache(options = {}) {
  const storageKey = options.storageKey || options.key || MARKET_CACHE_STORAGE_KEY;
  const getValue = resolveGMGetValue(options.getValue);
  if (!getValue) {
    return {
      ok: false,
      envelope: null,
      cache: null,
      raw: undefined,
      storageKey,
      diagnostics: [diagnostic("gm-get-unavailable", "GM_getValue is not available.")],
      needsMigration: false,
    };
  }

  let raw;
  try {
    raw = getValue(storageKey, null);
  } catch (error) {
    return {
      ok: false,
      envelope: null,
      cache: null,
      raw: undefined,
      storageKey,
      diagnostics: [diagnostic(
        "gm-read-failed",
        "Failed to read the market cache; no stored value was changed.",
        "error",
        { error: String(error?.message || error) }
      )],
      needsMigration: false,
    };
  }

  return {
    ...decodeMarketCache(raw),
    raw,
    storageKey,
  };
}

/** Persist a valid, canonical cache envelope through GM_setValue. */
export function saveMarketCache(cache, options = {}) {
  const storageKey = options.storageKey || options.key || MARKET_CACHE_STORAGE_KEY;
  const setValue = resolveGMSetValue(options.setValue);
  if (!setValue) {
    return {
      ok: false,
      envelope: null,
      cache: null,
      raw: undefined,
      storageKey,
      diagnostics: [diagnostic("gm-set-unavailable", "GM_setValue is not available.")],
    };
  }

  const decoded = decodeMarketCache(cache);
  if (!decoded.ok || !decoded.envelope) {
    return {
      ...decoded,
      raw: undefined,
      storageKey,
    };
  }

  const raw = JSON.stringify(decoded.envelope);
  try {
    setValue(storageKey, raw);
  } catch (error) {
    return {
      ok: false,
      envelope: decoded.envelope,
      cache: decoded.envelope,
      raw,
      storageKey,
      diagnostics: [diagnostic(
        "gm-write-failed",
        "Failed to write the market cache.",
        "error",
        { error: String(error?.message || error) }
      )],
    };
  }

  return {
    ok: true,
    envelope: decoded.envelope,
    cache: decoded.envelope,
    raw,
    storageKey,
    diagnostics: decoded.diagnostics,
  };
}

/**
 * Safe convenience wrapper: corrupt/unsupported stored data blocks the update,
 * so an upsert cannot silently destroy the original raw value.
 */
export function upsertStoredMarketCache(record, options = {}) {
  const loaded = loadMarketCache(options);
  if (!loaded.ok || !loaded.envelope) {
    return { ...loaded, saved: false };
  }

  const updated = pruneMarketCache(
    upsertMarketCache(loaded.envelope, record, options),
    options
  );
  const saved = saveMarketCache(updated, options);
  return { ...saved, saved: saved.ok };
}

export const makeMarketCacheKey = getMarketCacheKey;
export const upsertMarketCacheRecord = upsertMarketCache;
export const findMarketCacheRecord = findMarketCache;
export const pruneMarketCacheRecords = pruneMarketCache;
export const readMarketCacheFromGM = loadMarketCache;
export const writeMarketCacheToGM = saveMarketCache;
