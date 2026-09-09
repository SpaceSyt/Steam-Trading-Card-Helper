import { state } from "../state.js";
import { RequestQueue } from "../request/queue.js";
import { getActiveCurrencyContext, getCurrencyContextById } from "./currency.js";
import { getMarketListingUrl, parseMarketListingSnapshotFromHtml, parseMarketListingWithDepthFromHtml } from "../parsers/market-listing.js";
import { normalizeListingOrderbook } from "./market-data.js";
import { persistMarketObservations } from "./market-observations.js";
import { parseActiveBuyOrdersResponse } from "./active-buy-orders.js";

export const NO_BUY_ORDERS_ERROR_CODE = "STCH_NO_BUY_ORDERS";

function createNoBuyOrdersError() {
  const error = new Error("当前没有可用的最高求购价格");
  error.code = NO_BUY_ORDERS_ERROR_CODE;
  return error;
}

export function isNoBuyOrdersError(error) {
  return error?.code === NO_BUY_ORDERS_ERROR_CODE;
}

export function getOrderCurrencyContext() {
  const activeContext = getActiveCurrencyContext();
  if (Number.isInteger(activeContext?.currencyId) && activeContext.currencyId > 0) {
    return activeContext;
  }

  const configuredCurrencyId = Number(state.cfg.currencyId);
  if (Number.isInteger(configuredCurrencyId) && configuredCurrencyId > 0) {
    return getCurrencyContextById(configuredCurrencyId);
  }

  throw new Error("无法确认 Steam 钱包币种");
}

export function getCurrencyMarketKey(marketHashName, currencyId = getOrderCurrencyContext().currencyId) {
  return JSON.stringify([String(currencyId), String(marketHashName || "")]);
}

export async function fetchActiveBuyOrderSnapshot(queue = null) {
  const ownedQueue = queue ? null : new RequestQueue(
    state.cfg.requestInterval,
    state,
    null,
    null,
    { stopPredicate: () => false }
  );
  const requestQueue = queue || ownedQueue;
  let data;
  try {
    const response = await requestQueue.fetch(
      "https://steamcommunity.com/market/mylistings?start=0&count=100&l=english",
      { requestPolicy: "default" }
    );
    data = response?.data;
  } finally {
    ownedQueue?.stop();
  }
  return parseActiveBuyOrdersResponse(data, {
    minorDigits: getOrderCurrencyContext().minorDigits,
  });
}

export function getPendingOrderExpectedQuantity(marketHashName) {
  const cacheKey = getCurrencyMarketKey(marketHashName);
  const pending = state.pendingOrderQuantities.get(cacheKey);
  if (!pending) return 0;
  if (Date.now() - pending.createdAt > 2 * 60 * 1000) {
    state.pendingOrderQuantities.delete(cacheKey);
    return 0;
  }
  return pending.expectedQuantity;
}

function validateListingSnapshot(snapshot, currencyId) {
  if (
    Number.isInteger(snapshot?.currency)
    && snapshot.currency > 0
    && snapshot.currency !== currencyId
  ) {
    throw new Error(`商品页币种不一致 (${snapshot.currency}/${currencyId})`);
  }
  if (
    Number.isInteger(snapshot?.currency)
    && snapshot.currency > 0
    && !(Number.isFinite(snapshot.highestBuyCents) && snapshot.highestBuyCents > 0)
  ) {
    throw createNoBuyOrdersError();
  }
}

export async function fetchHighestBuyPrice(marketHashName, queue = null, options = {}) {
  const currencyContext = getOrderCurrencyContext();
  const cacheKey = getCurrencyMarketKey(marketHashName, currencyContext.currencyId);
  const cached = state.highestBuyPrices.get(cacheKey);
  if (
    Number.isFinite(cached?.priceCents)
    && cached.priceCents > 0
    && Date.now() - cached.fetchedAt < 30000
  ) {
    if (typeof options.onCache === "function") options.onCache(cached);
    if (typeof options.onMetadata === "function") {
      options.onMetadata({
        displayName: cached.displayName || "",
        imageUrl: cached.imageUrl || "",
        sellOrderCount: cached.sellOrderCount ?? null,
        observedAt: cached.fetchedAt,
      });
    }
    return cached.priceCents;
  }

  const ownedQueue = queue ? null : new RequestQueue(
    state.cfg.requestInterval,
    state,
    null,
    null,
    { stopPredicate: () => false }
  );
  const requestQueue = queue || ownedQueue;
  const observeRecord = record => {
    if (!record) return;
    if (typeof options.onRecord === "function") options.onRecord(record);
    if (options.persistMarketCache !== false) {
      const persistence = persistMarketObservations(record);
      if (typeof options.onPersist === "function") options.onPersist(persistence);
    }
  };
  try {
    const listingUrl = getMarketListingUrl(marketHashName);
    const listingResponse = await requestQueue.fetch(listingUrl, {
      requestPolicy: "default",
    });
    const listingHtml = listingResponse?.text || "";
    const listingSnapshot = parseMarketListingSnapshotFromHtml(
      listingHtml,
      marketHashName,
      { includeHistory: false }
    );
    const metadataObservedAt = Date.now();
    if (listingSnapshot && typeof options.onMetadata === "function") {
      options.onMetadata({
        displayName: listingSnapshot.displayName || "",
        imageUrl: listingSnapshot.imageUrl || "",
        sellOrderCount: listingSnapshot.sellOrderCount,
        observedAt: metadataObservedAt,
      });
    }
    validateListingSnapshot(listingSnapshot, currencyContext.currencyId);
    const newOrderbook = listingSnapshot?.highestBuyCents !== null
      ? listingSnapshot
      : null;
    if (newOrderbook) {
      if (
        newOrderbook.currency != null
        && newOrderbook.currency !== currencyContext.currencyId
      ) {
        throw new Error(
          `商品页币种不一致 (${newOrderbook.currency}/${currencyContext.currencyId})`
        );
      }
      if (newOrderbook.highestBuyCents <= 0) {
        throw createNoBuyOrdersError();
      }
      const observedAt = Date.now();
      observeRecord(normalizeListingOrderbook(newOrderbook, {
        appid: "753",
        marketHashName,
        currencyId: currencyContext.currencyId,
        currencyCode: currencyContext.code,
        observedAt,
      }));
      state.highestBuyPrices.set(cacheKey, {
        currencyId: currencyContext.currencyId,
        priceCents: newOrderbook.highestBuyCents,
        fetchedAt: observedAt,
        displayName: listingSnapshot?.displayName || "",
        imageUrl: listingSnapshot?.imageUrl || "",
        sellOrderCount: listingSnapshot?.sellOrderCount ?? null,
      });
      return newOrderbook.highestBuyCents;
    }

    throw new Error("商品页缺少可用的 SSR 订单簿数据");
  } finally {
    ownedQueue?.stop();
  }
}

export async function fetchMarketOrderDepth(marketHashName, queue = null, options = {}) {
  const currencyContext = getOrderCurrencyContext();
  const cacheKey = getCurrencyMarketKey(marketHashName, currencyContext.currencyId);
  const depthKey = options.sell ? `${cacheKey}:sell` : cacheKey;
  const cached = state.marketOrderDepths.get(depthKey);
  if (cached?.depth && Date.now() - cached.fetchedAt < 30000) {
    return cached.depth;
  }

  const ownedQueue = queue ? null : new RequestQueue(
    state.cfg.requestInterval,
    state,
    null,
    null,
    { stopPredicate: () => false }
  );
  const requestQueue = queue || ownedQueue;
  try {
    const listingUrl = getMarketListingUrl(marketHashName);
    const response = await requestQueue.fetch(listingUrl, { requestPolicy: "default" });
    const listingHtml = response?.text || "";
    const { snapshot, depth } = parseMarketListingWithDepthFromHtml(
      listingHtml,
      marketHashName,
      { includeHistory: false, sell: options.sell }
    );
    if (!depth) {
      if (!options.sell) validateListingSnapshot(snapshot, currencyContext.currencyId);
      throw new Error(`商品页缺少有效的完整${options.sell ? "卖" : "买"}单深度`);
    }
    if (depth.currencyId !== currencyContext.currencyId) {
      throw new Error(
        `商品页币种不一致 (${depth.currencyId}/${currencyContext.currencyId})`
      );
    }

    const observedAt = Date.now();
    const record = normalizeListingOrderbook({
      eCurrency: depth.currencyId,
      amtMaxBuyOrder: depth.highestBuyMinor,
      amtMinSellOrder: depth.lowestSellMinor,
    }, {
      appid: "753",
      marketHashName,
      currencyId: currencyContext.currencyId,
      currencyCode: currencyContext.code,
      observedAt,
    });
    if (record && typeof options.onRecord === "function") options.onRecord(record);
    state.highestBuyPrices.set(cacheKey, {
      currencyId: currencyContext.currencyId,
      priceCents: depth.highestBuyMinor,
      fetchedAt: observedAt,
      displayName: snapshot?.displayName || "",
      imageUrl: snapshot?.imageUrl || "",
      sellOrderCount: depth.sellOrderCount ?? snapshot?.sellOrderCount ?? null,
    });
    state.marketOrderDepths.set(depthKey, { depth, fetchedAt: observedAt });
    return depth;
  } finally {
    ownedQueue?.stop();
  }
}

