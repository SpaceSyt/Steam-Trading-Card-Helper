import { state } from "../state.js";

import { DEFAULT_CONFIG } from "../config.js";

import {
  ORDER_CACHE_BACKUP_KEY,
  ORDER_CACHE_KEY,
  ORDER_CACHE_SCHEMA_VERSION,
} from "../constants.js";

import { getBadgeTargetLevel } from "../utils/badge.js";

import { formatCNY } from "../utils/format.js";
import { formatMinorAmount, getCurrencyContextById } from "./currency.js";

import { getResultKey } from "./result-info.js";

const LEGACY_ORDER_CACHE_CURRENCY_ID = 23;

function normalizeCurrencyId(value, fallback = LEGACY_ORDER_CACHE_CURRENCY_ID) {
  const currencyId = Number(value);
  if (Number.isInteger(currencyId) && currencyId > 0) return currencyId;
  const fallbackId = Number(fallback);
  return Number.isInteger(fallbackId) && fallbackId > 0
    ? fallbackId
    : LEGACY_ORDER_CACHE_CURRENCY_ID;
}

export function getActiveOrderCurrencyId() {
  return normalizeCurrencyId(
    state?.currencyContext?.id
      ?? state?.currencyContext?.currencyId
      ?? state?.cfg?.currencyId,
    DEFAULT_CONFIG.currencyId
  );
}

export function createOrderCacheEnvelope(updatedAt = Date.now()) {
  return {
    schemaVersion: ORDER_CACHE_SCHEMA_VERSION,
    updatedAt: Number(updatedAt) || Date.now(),
    partitions: {},
  };
}

export function normalizeOrderResult(info, cachedAt = Date.now(), currencyId = null) {
  if (!info?.appid) return null;
  const copy = JSON.parse(JSON.stringify(info));
  copy.appid = String(copy.appid).trim();
  copy.isFoil = !!copy.isFoil;
  copy.targetLevel = getBadgeTargetLevel(copy);
  copy.cachedAt = Number(copy.cachedAt || cachedAt) || cachedAt;
  copy.currencyId = normalizeCurrencyId(
    copy.currencyId,
    currencyId ?? getActiveOrderCurrencyId()
  );
  copy.cards = Array.isArray(copy.cards) ? copy.cards : [];
  copy.cardPrices = Array.isArray(copy.cardPrices) ? copy.cardPrices : [];
  copy.cheapestSetCostCents = Number(copy.cheapestSetCostCents) || 0;
  copy.fullSetCostCents = Number(copy.fullSetCostCents) || 0;
  copy.level5CostCents = Number(copy.level5CostCents) || 0;
  const currencyContext = getCurrencyContextById(copy.currencyId);
  copy.currencyCode = copy.currencyCode || currencyContext.code;
  copy.cheapestSetFormatted = formatMinorAmount(copy.cheapestSetCostCents, currencyContext);
  copy.fullSetFormatted = formatMinorAmount(copy.fullSetCostCents, currencyContext);
  copy.level5Formatted = formatMinorAmount(copy.level5CostCents, currencyContext);
  // Keep the v2.0 formatted aliases readable while callers migrate to generic money formatting.
  copy.cheapestSetCNY = copy.cheapestSetCNY || formatCNY(copy.cheapestSetCostCents);
  copy.fullSetCNY = copy.fullSetCNY || formatCNY(copy.fullSetCostCents);
  copy.level5CNY = copy.level5CNY || formatCNY(copy.level5CostCents);
  return copy.appid ? copy : null;
}

function normalizePartition(value, currencyId, now = Date.now()) {
  const items = Array.isArray(value) ? value : value?.items;
  return {
    currencyId,
    updatedAt: Number(value?.updatedAt) || now,
    items: (Array.isArray(items) ? items : [])
      .map(item => {
        const normalized = normalizeOrderResult(item, item?.cachedAt || now, currencyId);
        if (normalized) normalized.currencyId = currencyId;
        return normalized;
      })
      .filter(Boolean),
  };
}

export function decodeOrderCache(raw, options = {}) {
  const now = Number(options.now) || Date.now();
  let parsed = raw;
  try {
    if (typeof parsed === "string") parsed = JSON.parse(parsed || "[]");
  } catch (error) {
    return {
      envelope: createOrderCacheEnvelope(now),
      migrated: false,
      corrupt: true,
      error,
      raw,
    };
  }

  if (Array.isArray(parsed)) {
    const envelope = createOrderCacheEnvelope(now);
    const currencyId = LEGACY_ORDER_CACHE_CURRENCY_ID;
    envelope.partitions[String(currencyId)] = normalizePartition(parsed, currencyId, now);
    return { envelope, migrated: true, corrupt: false, error: null, raw };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed.partitions)) {
    return {
      envelope: createOrderCacheEnvelope(now),
      migrated: false,
      corrupt: true,
      error: new Error("Invalid order cache envelope"),
      raw,
    };
  }

  if (Number(parsed.schemaVersion) !== ORDER_CACHE_SCHEMA_VERSION) {
    return {
      envelope: createOrderCacheEnvelope(now),
      migrated: false,
      corrupt: true,
      error: new Error(`Unsupported order cache schema: ${parsed.schemaVersion}`),
      raw,
    };
  }

  const envelope = createOrderCacheEnvelope(parsed.updatedAt || now);
  for (const [key, value] of Object.entries(parsed.partitions || {})) {
    const currencyId = Number(value?.currencyId ?? key);
    if (!Number.isInteger(currencyId) || currencyId <= 0) continue;
    envelope.partitions[String(currencyId)] = normalizePartition(value, currencyId, now);
  }
  return { envelope, migrated: false, corrupt: false, error: null, raw };
}

export function replaceOrderCachePartition(envelope, currencyId, items, now = Date.now()) {
  const next = decodeOrderCache(envelope, { now });
  const safeEnvelope = next.corrupt ? createOrderCacheEnvelope(now) : next.envelope;
  const normalizedCurrencyId = normalizeCurrencyId(currencyId);
  safeEnvelope.partitions[String(normalizedCurrencyId)] = normalizePartition(
    { items, updatedAt: now },
    normalizedCurrencyId,
    now
  );
  safeEnvelope.updatedAt = now;
  return safeEnvelope;
}

function readStoredOrderCache(options = {}) {
  const raw = GM_getValue(ORDER_CACHE_KEY, "[]");
  const decoded = decodeOrderCache(raw);
  if (decoded.migrated && options.persistMigration !== false) {
    GM_setValue(ORDER_CACHE_KEY, JSON.stringify(decoded.envelope));
  }
  return decoded;
}

function persistEnvelope(envelope) {
  GM_setValue(ORDER_CACHE_KEY, JSON.stringify(envelope));
}

export function getOrderCacheDays() {
  const days = Number(state?.cfg?.orderCacheDays ?? DEFAULT_CONFIG.orderCacheDays);
  return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : DEFAULT_CONFIG.orderCacheDays;
}

export function getOrderCacheAgeDays(cachedAt) {
  const ts = Number(cachedAt) || Date.now();
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

export function isOrderCacheFresh(info) {
  return getOrderCacheAgeDays(info?.cachedAt) <= getOrderCacheDays();
}

export function loadOrderCache(currencyId = getActiveOrderCurrencyId()) {
  try {
    const decoded = readStoredOrderCache({ persistMigration: true });
    if (decoded.corrupt) {
      console.warn("[STCH] Order cache load failed; original value was preserved:", decoded.error);
      return [];
    }
    const normalizedCurrencyId = normalizeCurrencyId(currencyId);
    const partition = decoded.envelope.partitions[String(normalizedCurrencyId)];
    const items = partition?.items || [];
    const freshItems = items.filter(isOrderCacheFresh);
    if (freshItems.length !== items.length) {
      persistEnvelope(replaceOrderCachePartition(
        decoded.envelope,
        normalizedCurrencyId,
        freshItems
      ));
    }
    return freshItems;
  } catch (error) {
    console.warn("[STCH] Order cache load failed:", error);
    return [];
  }
}

export function saveOrderCache(currencyId = getActiveOrderCurrencyId()) {
  const now = Date.now();
  let decoded;
  try {
    decoded = readStoredOrderCache({ persistMigration: false });
  } catch (error) {
    decoded = { corrupt: true, raw: null, envelope: createOrderCacheEnvelope(now), error };
  }
  if (decoded.corrupt && decoded.raw != null) {
    // A later v2.1.x cache inspector can offer explicit recovery from this untouched backup.
    GM_setValue(ORDER_CACHE_BACKUP_KEY, decoded.raw);
  }
  const base = decoded.corrupt ? createOrderCacheEnvelope(now) : decoded.envelope;
  const envelope = replaceOrderCachePartition(base, currencyId, state.orderResults, now);
  persistEnvelope(envelope);
}

export function clearOrderCache() {
  state.orderResults = [];
  state.selectedOrderResults = new Set();
  state.pendingOrderQuantities = new Map();
  state.highestBuyPrices = new Map();
  persistEnvelope(createOrderCacheEnvelope());
}

export function pruneOrderCache(persist = false) {
  const before = state.orderResults.length;
  state.orderResults = state.orderResults
    .map(item => normalizeOrderResult(item, item?.cachedAt, getActiveOrderCurrencyId()))
    .filter(Boolean)
    .filter(isOrderCacheFresh);
  if (persist && state.orderResults.length !== before) {
    saveOrderCache();
    state.selectedOrderResults.forEach(key => {
      if (!state.orderResults.some(item => getResultKey(item) === key)) {
        state.selectedOrderResults.delete(key);
      }
    });
  }
  return before - state.orderResults.length;
}

export function getCachedOrderResult(info) {
  pruneOrderCache(true);
  const key = getResultKey(info);
  return state.orderResults.find(item => getResultKey(item) === key) || null;
}

export function upsertOrderResult(info, options = {}) {
  const currencyId = getActiveOrderCurrencyId();
  const item = normalizeOrderResult(info, options.cachedAt || Date.now(), currencyId);
  if (!item) return null;
  item.cachedAt = options.cachedAt || Date.now();
  item.currencyId = currencyId;
  pruneOrderCache(false);
  const key = getResultKey(item);
  const index = state.orderResults.findIndex(existing => getResultKey(existing) === key);
  if (index >= 0) state.orderResults[index] = item;
  else state.orderResults.push(item);
  if (options.select) state.selectedOrderResults.add(key);
  saveOrderCache(currencyId);
  return item;
}

export function removeOrderResultByKey(key, options = {}) {
  const before = state.orderResults.length;
  state.orderResults = state.orderResults.filter(item => getResultKey(item) !== key);
  state.selectedOrderResults.delete(key);
  if (state.orderResults.length !== before && options.persist !== false) {
    saveOrderCache();
  }
}

export function readRawOrderCache(currencyId = getActiveOrderCurrencyId()) {
  try {
    const decoded = readStoredOrderCache({ persistMigration: true });
    if (decoded.corrupt) return [];
    const normalizedCurrencyId = normalizeCurrencyId(currencyId);
    return decoded.envelope.partitions[String(normalizedCurrencyId)]?.items || [];
  } catch (_) {
    return [];
  }
}

export function getExpiredOrderCacheCount() {
  return readRawOrderCache().filter(item => !isOrderCacheFresh(item)).length;
}
