import { state } from "../state.js";

import { DEFAULT_CONFIG } from "../config.js";

import { ORDER_CACHE_KEY } from "../constants.js";

import { getBadgeTargetLevel } from "../utils/badge.js";

import { formatCNY } from "../utils/format.js";

import { getResultKey } from "./result-info.js";

  export function getOrderCacheDays() {
    const days = Number(state?.cfg?.orderCacheDays ?? DEFAULT_CONFIG.orderCacheDays);
    return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : DEFAULT_CONFIG.orderCacheDays;
  }

  export function getOrderCacheAgeDays(cachedAt) {
    const ts = Number(cachedAt) || Date.now();
    return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
  }

  export function normalizeOrderResult(info, cachedAt = Date.now()) {
    if (!info?.appid) return null;
    const copy = JSON.parse(JSON.stringify(info));
    copy.appid = String(copy.appid).trim();
    copy.isFoil = !!copy.isFoil;
    copy.targetLevel = getBadgeTargetLevel(copy);
    copy.cachedAt = Number(copy.cachedAt || cachedAt) || cachedAt;
    copy.cards = Array.isArray(copy.cards) ? copy.cards : [];
    copy.cardPrices = Array.isArray(copy.cardPrices) ? copy.cardPrices : [];
    copy.cheapestSetCostCents = Number(copy.cheapestSetCostCents) || 0;
    copy.fullSetCostCents = Number(copy.fullSetCostCents) || 0;
    copy.level5CostCents = Number(copy.level5CostCents) || 0;
    copy.cheapestSetCNY = copy.cheapestSetCNY || formatCNY(copy.cheapestSetCostCents);
    copy.fullSetCNY = copy.fullSetCNY || formatCNY(copy.fullSetCostCents);
    copy.level5CNY = copy.level5CNY || formatCNY(copy.level5CostCents);
    return copy.appid ? copy : null;
  }

  export function isOrderCacheFresh(info) {
    return getOrderCacheAgeDays(info?.cachedAt) <= getOrderCacheDays();
  }

  export function loadOrderCache() {
    try {
      const raw = GM_getValue(ORDER_CACHE_KEY, "[]");
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
      return parsed
        .map(item => normalizeOrderResult(item, item?.cachedAt))
        .filter(Boolean)
        .filter(isOrderCacheFresh);
    } catch (error) {
      console.warn("[STCH] Order cache load failed:", error);
      return [];
    }
  }

  export function saveOrderCache() {
    GM_setValue(
      ORDER_CACHE_KEY,
      JSON.stringify(state.orderResults.map(item => normalizeOrderResult(item, item.cachedAt)).filter(Boolean))
    );
  }

  export function pruneOrderCache(persist = false) {
    const before = state.orderResults.length;
    state.orderResults = state.orderResults
      .map(item => normalizeOrderResult(item, item?.cachedAt))
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
    const item = normalizeOrderResult(info, options.cachedAt || Date.now());
    if (!item) return null;
    item.cachedAt = options.cachedAt || Date.now();
    pruneOrderCache(false);
    const key = getResultKey(item);
    const index = state.orderResults.findIndex(existing => getResultKey(existing) === key);
    if (index >= 0) state.orderResults[index] = item;
    else state.orderResults.push(item);
    if (options.select) state.selectedOrderResults.add(key);
    saveOrderCache();
    return item;
  }

  export function removeOrderResultByKey(key, options = {}) {
    const before = state.orderResults.length;
    state.orderResults = state.orderResults.filter(item => getResultKey(item) !== key);
    state.selectedOrderResults.delete(key);
    if (state.orderResults.length !== before) {
      if (options.persist !== false) saveOrderCache();
    }
  }

  export function readRawOrderCache() {
    try {
      const raw = GM_getValue(ORDER_CACHE_KEY, "[]");
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.map(item => normalizeOrderResult(item, item?.cachedAt)).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  export function getExpiredOrderCacheCount() {
    return readRawOrderCache().filter(item => !isOrderCacheFresh(item)).length;
  }
