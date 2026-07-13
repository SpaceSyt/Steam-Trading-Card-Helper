import {
  MARKET_DATA_SCHEMA_VERSION,
  normalizeMarketRecord,
} from "./market-data.js";

export const MARKET_HISTORY_SCHEMA_VERSION = 1;
export const MARKET_HISTORY_STORAGE_KEY = "stch_market_history";
export const DEFAULT_MARKET_HISTORY_SAMPLE_INTERVAL_MS = 60 * 60 * 1000;
export const DEFAULT_MARKET_HISTORY_TTL_MS = 365 * 24 * 60 * 60 * 1000;
export const DEFAULT_MARKET_HISTORY_MAX_ENTRIES = 20000;
export const DEFAULT_MARKET_HISTORY_MAX_POINTS = 480;
export const DEFAULT_MARKET_HISTORY_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

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
    schemaVersion: MARKET_HISTORY_SCHEMA_VERSION,
    records: [],
  };
}

function getInputRecords(value) {
  if (Array.isArray(value)) return value;
  return isObject(value) && Array.isArray(value.records) ? value.records : [];
}

function getSampleIntervalMs(options = {}) {
  const value = options.sampleIntervalMs === undefined
    ? DEFAULT_MARKET_HISTORY_SAMPLE_INTERVAL_MS
    : Number(options.sampleIntervalMs);
  return Number.isFinite(value) && value > 0
    ? Math.max(1, Math.floor(value))
    : DEFAULT_MARKET_HISTORY_SAMPLE_INTERVAL_MS;
}

function getNormalizedSampleKey(record, sampleIntervalMs) {
  if (!record || record.currencyId === null || record.observedAt === null) return null;
  return JSON.stringify([
    record.appid,
    record.marketHashName,
    record.currencyId,
    record.source,
    Math.floor(record.observedAt / sampleIntervalMs),
  ]);
}

function normalizeHistoryRecord(record) {
  if (
    isObject(record)
    && record.schemaVersion !== undefined
    && Number(record.schemaVersion) !== MARKET_DATA_SCHEMA_VERSION
  ) {
    return null;
  }
  const normalized = normalizeMarketRecord(record);
  if (!normalized || normalized.currencyId === null || normalized.observedAt === null) {
    return null;
  }
  if (
    normalized.lowestSellMinor === null
    && normalized.medianMinor === null
    && normalized.highestBuyMinor === null
    && normalized.volume === null
  ) {
    return null;
  }
  return normalized;
}

function normalizeHistoryRecords(records, options = {}) {
  const sampleIntervalMs = getSampleIntervalMs(options);
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
    } else if (Number(record.schemaVersion) !== MARKET_DATA_SCHEMA_VERSION) {
      unsupportedSchemaCount += 1;
      return;
    }

    const normalized = normalizeHistoryRecord(record);
    const key = getNormalizedSampleKey(normalized, sampleIntervalMs);
    if (!normalized || key === null) {
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

export function createMarketHistoryEnvelope(records = [], options = {}) {
  return normalizeMarketHistory({
    schemaVersion: MARKET_HISTORY_SCHEMA_VERSION,
    records,
  }, options);
}

export function normalizeMarketHistory(value, options = {}) {
  return {
    schemaVersion: MARKET_HISTORY_SCHEMA_VERSION,
    records: normalizeHistoryRecords(getInputRecords(value), options).records,
  };
}

/** Decode persisted history without rewriting damaged or legacy storage. */
export function decodeMarketHistory(raw, options = {}) {
  if (raw === null || raw === undefined || raw === "") {
    const envelope = emptyEnvelope();
    return {
      ok: true,
      envelope,
      history: envelope,
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
        history: envelope,
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
        history: null,
        diagnostics: [diagnostic(
          "invalid-json",
          "Market history is not valid JSON; the stored value was left untouched.",
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
      "Legacy market history was decoded in memory and has not been rewritten.",
      "warning"
    ));
  } else if (!isObject(parsed) || !Array.isArray(parsed.records)) {
    return {
      ok: false,
      envelope: null,
      history: null,
      diagnostics: [diagnostic(
        "invalid-envelope",
        "Market history must contain a records array; the stored value was left untouched."
      )],
      needsMigration: false,
    };
  } else {
    const schemaVersion = Number(parsed.schemaVersion);
    if (schemaVersion !== MARKET_HISTORY_SCHEMA_VERSION) {
      return {
        ok: false,
        envelope: null,
        history: null,
        diagnostics: [diagnostic(
          "unsupported-schema-version",
          `Market history schema ${parsed.schemaVersion} is not supported.`,
          "error",
          { schemaVersion: parsed.schemaVersion, supportedSchemaVersion: MARKET_HISTORY_SCHEMA_VERSION }
        )],
        needsMigration: false,
      };
    }
    records = parsed.records;
  }

  const normalized = normalizeHistoryRecords(records, options);
  const envelope = {
    schemaVersion: MARKET_HISTORY_SCHEMA_VERSION,
    records: normalized.records,
  };
  if (normalized.invalidCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "invalid-records-dropped",
      `${normalized.invalidCount} invalid market history record(s) were excluded in memory.`,
      "error",
      { count: normalized.invalidCount }
    ));
  }
  if (normalized.unsupportedSchemaCount > 0) {
    needsMigration = true;
    diagnostics.push(diagnostic(
      "unsupported-record-schema",
      `${normalized.unsupportedSchemaCount} market history record(s) use an unsupported schema.`,
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
      "duplicate-samples-collapsed",
      `${normalized.duplicateCount} duplicate market history sample(s) were collapsed.`,
      "warning",
      { count: normalized.duplicateCount }
    ));
  }

  return {
    ok: !diagnostics.some(item => item.severity === "error"),
    envelope,
    history: envelope,
    diagnostics,
    needsMigration,
  };
}

function pruneNormalizedMarketHistory(envelope, options = {}) {
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const ttlMs = options.ttlMs === undefined
    ? DEFAULT_MARKET_HISTORY_TTL_MS
    : Number(options.ttlMs);
  const maxEntries = options.maxEntries === undefined
    ? DEFAULT_MARKET_HISTORY_MAX_ENTRIES
    : Number(options.maxEntries);
  const futureToleranceMs = options.futureToleranceMs === undefined
    ? DEFAULT_MARKET_HISTORY_FUTURE_TOLERANCE_MS
    : Math.max(0, Number(options.futureToleranceMs) || 0);
  const ttlEnabled = ttlMs !== Infinity && Number.isFinite(ttlMs) && Number.isFinite(now);
  const effectiveTtl = ttlEnabled ? Math.max(0, ttlMs) : Infinity;
  let records = envelope.records.filter(record => (
    (effectiveTtl === Infinity || now - record.observedAt <= effectiveTtl)
    && (!Number.isFinite(now) || record.observedAt <= now + futureToleranceMs)
  ));

  if (maxEntries !== Infinity && Number.isFinite(maxEntries)) {
    const limit = Math.max(0, Math.floor(maxEntries));
    if (records.length > limit) {
      const groups = new Map();
      records.forEach((record, index) => {
        const key = JSON.stringify([record.appid, record.marketHashName, record.currencyId]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ index, observedAt: record.observedAt });
      });
      const rankedGroups = [...groups.values()]
        .map(group => group.sort((left, right) => (
          right.observedAt - left.observedAt || right.index - left.index
        )))
        .sort((left, right) => (
          right[0].observedAt - left[0].observedAt || right[0].index - left[0].index
        ));
      const retained = new Set();
      for (let depth = 0; retained.size < limit; depth += 1) {
        let added = false;
        for (const group of rankedGroups) {
          if (retained.size >= limit) break;
          if (!group[depth]) continue;
          retained.add(group[depth].index);
          added = true;
        }
        if (!added) break;
      }
      records = records.filter((_, index) => retained.has(index));
    }
  }
  return { ...envelope, records };
}

export function pruneMarketHistory(history, options = {}) {
  return pruneNormalizedMarketHistory(normalizeMarketHistory(history, options), options);
}

export function upsertManyMarketHistory(history, records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError("Market history records must be an array.");
  const sampleIntervalMs = getSampleIntervalMs(options);
  const envelope = normalizeMarketHistory(history, options);
  const nextRecords = [...envelope.records];
  const indexByKey = new Map(nextRecords.map((record, index) => [
    getNormalizedSampleKey(record, sampleIntervalMs),
    index,
  ]));

  records.forEach(record => {
    const normalized = normalizeHistoryRecord(record);
    const key = getNormalizedSampleKey(normalized, sampleIntervalMs);
    if (!normalized || key === null) {
      throw new TypeError(
        "A history record requires appid, marketHashName, currencyId, source, and observedAt."
      );
    }
    const index = indexByKey.get(key);
    if (index === undefined) {
      indexByKey.set(key, nextRecords.length);
      nextRecords.push(normalized);
    } else if (nextRecords[index].observedAt <= normalized.observedAt) {
      nextRecords[index] = normalized;
    }
  });

  return pruneNormalizedMarketHistory({ ...envelope, records: nextRecords }, options);
}

export function upsertMarketHistory(history, record, options = {}) {
  return upsertManyMarketHistory(history, [record], options);
}

function resolveGMGetValue(explicit) {
  if (typeof explicit === "function") return explicit;
  return typeof GM_getValue === "function" ? GM_getValue : null;
}

function resolveGMSetValue(explicit) {
  if (typeof explicit === "function") return explicit;
  return typeof GM_setValue === "function" ? GM_setValue : null;
}

function saveNormalizedMarketHistory(envelope, options = {}) {
  const storageKey = options.storageKey || options.key || MARKET_HISTORY_STORAGE_KEY;
  const setValue = resolveGMSetValue(options.setValue);
  if (!setValue) {
    return {
      ok: false,
      envelope: null,
      history: null,
      storageKey,
      diagnostics: [diagnostic("gm-set-unavailable", "GM_setValue is not available.")],
    };
  }
  const raw = JSON.stringify(envelope);
  try {
    setValue(storageKey, raw);
  } catch (error) {
    return {
      ok: false,
      envelope,
      history: envelope,
      raw,
      storageKey,
      diagnostics: [diagnostic(
        "gm-write-failed",
        "Failed to write market history.",
        "error",
        { error: String(error?.message || error) }
      )],
    };
  }
  return {
    ok: true,
    envelope,
    history: envelope,
    raw,
    storageKey,
    diagnostics: [],
  };
}

export function loadMarketHistory(options = {}) {
  const storageKey = options.storageKey || options.key || MARKET_HISTORY_STORAGE_KEY;
  const getValue = resolveGMGetValue(options.getValue);
  if (!getValue) {
    return {
      ok: false,
      envelope: null,
      history: null,
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
      history: null,
      storageKey,
      diagnostics: [diagnostic(
        "gm-read-failed",
        "Failed to read market history.",
        "error",
        { error: String(error?.message || error) }
      )],
      needsMigration: false,
    };
  }
  return { ...decodeMarketHistory(raw, options), raw, storageKey };
}

export function saveMarketHistory(history, options = {}) {
  const decoded = decodeMarketHistory(history, options);
  if (!decoded.ok || !decoded.envelope) return decoded;
  return saveNormalizedMarketHistory(pruneNormalizedMarketHistory(decoded.envelope, options), options);
}

/** Read, sample, prune, and persist observations in one GM storage transaction. */
export function upsertManyStoredMarketHistory(records, options = {}) {
  if (!Array.isArray(records)) throw new TypeError("Market history records must be an array.");
  const loaded = loadMarketHistory(options);
  if (!loaded.ok || !loaded.envelope || records.length === 0) {
    return { ...loaded, saved: false };
  }
  const updated = upsertManyMarketHistory(loaded.envelope, records, options);
  const saved = saveNormalizedMarketHistory(updated, options);
  return { ...saved, saved: saved.ok };
}

export function upsertStoredMarketHistory(record, options = {}) {
  return upsertManyStoredMarketHistory([record], options);
}

function normalizeIdentity(identity) {
  const appid = String(identity?.appid ?? "753").trim();
  const marketHashName = String(
    identity?.marketHashName ?? identity?.market_hash_name ?? ""
  ).trim();
  const currencyId = Number(identity?.currencyId ?? identity?.currency);
  if (!appid || !marketHashName || !Number.isSafeInteger(currencyId) || currencyId <= 0) {
    return null;
  }
  return { appid, marketHashName, currencyId };
}

export function selectMarketHistoryRecords(history, identity, options = {}) {
  const normalizedIdentity = normalizeIdentity(identity);
  if (!normalizedIdentity) return [];
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const ttlMs = options.ttlMs === undefined
    ? DEFAULT_MARKET_HISTORY_TTL_MS
    : Number(options.ttlMs);
  const futureToleranceMs = options.futureToleranceMs === undefined
    ? DEFAULT_MARKET_HISTORY_FUTURE_TOLERANCE_MS
    : Math.max(0, Number(options.futureToleranceMs) || 0);
  const retentionFrom = ttlMs === Infinity || !Number.isFinite(ttlMs) || !Number.isFinite(now)
    ? -Infinity
    : now - Math.max(0, ttlMs);
  const requestedFrom = options.from === undefined ? -Infinity : Number(options.from);
  const requestedTo = options.to === undefined ? Infinity : Number(options.to);
  const from = Math.max(retentionFrom, requestedFrom);
  const to = Number.isFinite(now)
    ? Math.min(requestedTo, now + futureToleranceMs)
    : requestedTo;
  return normalizeMarketHistory(history, options).records
    .filter(record => (
      record.appid === normalizedIdentity.appid
      && record.marketHashName === normalizedIdentity.marketHashName
      && record.currencyId === normalizedIdentity.currencyId
      && record.observedAt >= from
      && record.observedAt <= to
    ))
    .sort((left, right) => left.observedAt - right.observedAt);
}

/** Normalize once and index a currency partition for multi-item overview rendering. */
export function groupMarketHistoryRecordsByItem(history, scope, options = {}) {
  const appid = String(scope?.appid ?? "753").trim();
  const currencyId = Number(scope?.currencyId ?? scope?.currency);
  if (!appid || !Number.isSafeInteger(currencyId) || currencyId <= 0) return new Map();
  const now = options.now === undefined ? Date.now() : Number(options.now);
  const ttlMs = options.ttlMs === undefined
    ? DEFAULT_MARKET_HISTORY_TTL_MS
    : Number(options.ttlMs);
  const futureToleranceMs = options.futureToleranceMs === undefined
    ? DEFAULT_MARKET_HISTORY_FUTURE_TOLERANCE_MS
    : Math.max(0, Number(options.futureToleranceMs) || 0);
  const from = ttlMs === Infinity || !Number.isFinite(ttlMs) || !Number.isFinite(now)
    ? -Infinity
    : now - Math.max(0, ttlMs);
  const to = Number.isFinite(now) ? now + futureToleranceMs : Infinity;
  const groups = new Map();
  normalizeMarketHistory(history, options).records.forEach(record => {
    if (
      record.appid !== appid
      || record.currencyId !== currencyId
      || record.observedAt < from
      || record.observedAt > to
    ) return;
    if (!groups.has(record.marketHashName)) groups.set(record.marketHashName, []);
    groups.get(record.marketHashName).push(record);
  });
  groups.forEach(records => records.sort((left, right) => left.observedAt - right.observedAt));
  return groups;
}

const SERIES_FIELDS = ["lowestSellMinor", "medianMinor", "highestBuyMinor", "volume"];

/** Merge endpoint-specific observations into bounded display buckets. */
export function aggregateMarketHistoryRecords(records, options = {}) {
  const normalized = normalizeHistoryRecords(Array.isArray(records) ? records : [], {
    ...options,
    sampleIntervalMs: 1,
  }).records.sort((left, right) => left.observedAt - right.observedAt);
  if (normalized.length === 0) return [];

  const maxPointsValue = options.maxPoints === undefined
    ? DEFAULT_MARKET_HISTORY_MAX_POINTS
    : Number(options.maxPoints);
  const maxPoints = Number.isFinite(maxPointsValue)
    ? Math.max(1, Math.floor(maxPointsValue))
    : DEFAULT_MARKET_HISTORY_MAX_POINTS;
  const firstAt = normalized[0].observedAt;
  const lastAt = normalized.at(-1).observedAt;
  const bucketMs = Math.max(1, Math.ceil(Math.max(1, lastAt - firstAt + 1) / maxPoints));
  const buckets = new Map();

  normalized.forEach(record => {
    const bucketKey = Math.floor((record.observedAt - firstAt) / bucketMs);
    let point = buckets.get(bucketKey);
    if (!point) {
      point = {
        observedAt: record.observedAt,
        lowestSellMinor: null,
        medianMinor: null,
        highestBuyMinor: null,
        volume: null,
      };
      buckets.set(bucketKey, point);
    }
    point.observedAt = Math.max(point.observedAt, record.observedAt);
    SERIES_FIELDS.forEach(field => {
      if (record[field] !== null) point[field] = record[field];
    });
  });

  return [...buckets.values()].sort((left, right) => left.observedAt - right.observedAt);
}

export function getMarketHistoryStatistics(points, field) {
  if (!SERIES_FIELDS.includes(field)) return null;
  const values = (Array.isArray(points) ? points : [])
    .map(point => point?.[field])
    .filter(value => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0);
  if (values.length === 0) return null;
  const first = values[0];
  const current = values.at(-1);
  const change = current - first;
  return {
    first,
    current,
    low: Math.min(...values),
    high: Math.max(...values),
    change,
    percentChange: first > 0 ? (change / first) * 100 : null,
    sampleCount: values.length,
  };
}

function getPriceOverviewRecords(records) {
  return (Array.isArray(records) ? records : [])
    .filter(record => record?.source === "priceoverview")
    .sort((left, right) => Number(left.observedAt) - Number(right.observedAt));
}

/** Build the current row metrics without mixing endpoint snapshots. */
export function getMarketOverviewMetrics(records) {
  const overview = getPriceOverviewRecords(records);
  const prices = overview.filter(record => (
    Number.isFinite(Number(record.lowestSellMinor))
    && Number(record.lowestSellMinor) > 0
  ));
  const volumes = overview.filter(record => (
    record.volume !== null
    && record.volume !== undefined
    && record.volume !== ""
    && Number.isFinite(Number(record.volume))
    && Number(record.volume) >= 0
  ));
  const latestRecord = overview.at(-1) || null;
  const latestHasPrice = latestRecord
    && Number.isFinite(Number(latestRecord.lowestSellMinor))
    && Number(latestRecord.lowestSellMinor) > 0;
  const currentRecord = latestHasPrice ? latestRecord : null;
  const previousRecord = currentRecord
    ? prices.filter(record => record !== currentRecord).at(-1) || null
    : null;
  const currentMinor = currentRecord ? Number(currentRecord.lowestSellMinor) : null;
  const previousMinor = previousRecord ? Number(previousRecord.lowestSellMinor) : null;
  const changeMinor = currentMinor !== null && previousMinor !== null
    ? currentMinor - previousMinor
    : null;
  return {
    currentMinor,
    previousMinor,
    changeMinor,
    percentChange: changeMinor !== null && previousMinor > 0
      ? (changeMinor / previousMinor) * 100
      : null,
    volume24h: volumes.length > 0 ? Number(volumes.at(-1).volume) : null,
    observedAt: latestRecord?.observedAt ?? null,
    priceSampleCount: prices.length,
  };
}

/** Return a bounded lowest-sell series for a compact row sparkline. */
export function getMarketSparklinePoints(records, options = {}) {
  const from = options.from === undefined ? -Infinity : Number(options.from);
  const maxValue = options.maxPoints === undefined ? 96 : Number(options.maxPoints);
  const maxPoints = Number.isFinite(maxValue) ? Math.max(1, Math.floor(maxValue)) : 96;
  const points = getPriceOverviewRecords(records)
    .filter(record => (
      Number(record.observedAt) >= from
      && Number.isFinite(Number(record.lowestSellMinor))
      && Number(record.lowestSellMinor) > 0
    ))
    .map(record => ({
      observedAt: Number(record.observedAt),
      value: Number(record.lowestSellMinor),
    }));
  if (points.length <= maxPoints) return points;
  if (maxPoints === 1) return [points.at(-1)];
  const selected = [];
  for (let index = 0; index < maxPoints; index += 1) {
    selected.push(points[Math.round(index * (points.length - 1) / (maxPoints - 1))]);
  }
  return selected;
}
