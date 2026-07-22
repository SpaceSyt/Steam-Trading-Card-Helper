import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { formatMoney } from "../utils/format.js";

import { getMarketMinimumPriceCents, getSessionId } from "../utils/steam.js";

import { getBadgeTargetLevel } from "../utils/badge.js";

import { getMultibuyQuantity } from "./multibuy.js";

import {
  parseMarketListingSnapshotFromHtml,
  parseMarketOrderDepthFromListingHtml,
  parseMarketOrderbookFromListingHtml,
} from "../parsers/market-listing.js";
import { getActiveOrderPricingProfile } from "../config.js";
import { calculateAutomaticBuyPrice } from "../services/order-wall.js";

import { upsertOrderResult, getCachedOrderResult } from "../services/order-cache.js";

import { getSelectedResults, getSelectedOrderResults, refreshResultInfo } from "../services/result-info.js";

import {
  isPriceOverviewProbeBlocked,
  updateAllActionStates,
} from "../ui/action-state.js";

import { scanStatus, orderStatus, orderLog } from "../status-controllers.js";

import { createTextSpan } from "../utils/dom.js";

import { unsafeWindow } from "../globals.js";
import {
  getActiveCurrencyContext,
  getCurrencyContextById,
} from "../services/currency.js";
import {
  normalizeListingOrderbook,
} from "../services/market-data.js";
import { persistMarketObservations } from "../services/market-observations.js";
import { parseActiveBuyOrdersResponse } from "../services/active-buy-orders.js";

const { log, setStatus } = scanStatus;

export const NO_BUY_ORDERS_ERROR_CODE = "STCH_NO_BUY_ORDERS";

function createNoBuyOrdersError() {
  const error = new Error("当前没有可用的最高求购价格");
  error.code = NO_BUY_ORDERS_ERROR_CODE;
  return error;
}

export function isNoBuyOrdersError(error) {
  return error?.code === NO_BUY_ORDERS_ERROR_CODE;
}

const { setStatus: setOrderStatus } = orderStatus;

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

  export async function addManualOrderAppid() {
    if (isPriceOverviewProbeBlocked(state.orderActionRunning)) return;
    const input = document.getElementById("stch-order-appid");
    const appid = String(input?.value || "").trim();
    if (!/^\d+$/.test(appid)) {
      setOrderStatus("请输入有效的 AppID，例如 4761370", false);
      return;
    }

    const isFoil = !!document.getElementById("stch-order-manual-foil")?.checked;
    const existing = getCachedOrderResult({ appid, isFoil });
    state.orderActionRunning = true;
    updateAllActionStates();

    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setOrderStatus,
      orderLog,
      { stopPredicate: () => false }
    );

    try {
      setOrderStatus(`读取 ${appid}${isFoil ? " 闪卡" : ""}`);
      orderLog(`[${appid}] 开始读取${isFoil ? "闪卡" : "普通卡"}卡牌页并查价`, "info");
      const info = await refreshResultInfo(
        { appid, isFoil, gameName: existing?.gameName || "" },
        queue
      );
      upsertOrderResult(info, { select: true, render: true });
      if (input) input.value = "";
      orderLog(
        `[${appid}] ${info.gameName || ""}: 已加入订购缓存，` +
        `补全 ${info.hasIncompletePricing ? "-" : formatMoney(info.cheapestSetCostCents)} | ` +
        `全套 ${info.hasIncompletePricing ? "-" : formatMoney(info.fullSetCostCents)} | ` +
        `满级 ${info.hasIncompletePricing ? "-" : formatMoney(info.level5CostCents)}`,
        info.hasIncompletePricing ? "warn" : "ok"
      );
    } catch (error) {
      orderLog(`[${appid}] 加入失败: ${error?.message || error}`, "err");
    } finally {
      queue.stop();
      state.orderActionRunning = false;
      setOrderStatus(null);
      updateAllActionStates();
    }
  }

  export async function fetchActiveBuyOrderSnapshot(queue = null) {
    const ownedQueue = queue ? null : new RequestQueue(
      state.cfg.requestInterval,
      state.cfg.batchSize,
      state.cfg.batchPause,
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

  export async function loadActiveBuyOrders(queue = null) {
    const snapshot = await fetchActiveBuyOrderSnapshot(queue);
    if (snapshot.diagnostics.length > 0) {
      throw new Error(`无法完整解析现有 Steam 订购单（${snapshot.diagnostics.length} 项）`);
    }
    const orders = new Map();
    snapshot.orders.filter(order => order.appid === "753").forEach(order => {
      const current = orders.get(order.marketHashName) || { quantity: 0, orderIds: [] };
      current.quantity += order.remainingQuantity;
      current.orderIds.push(order.orderId);
      orders.set(order.marketHashName, current);
    });
    return orders;
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

  export function getOrderPriceSourceLabel(priceSource) {
    if (priceSource === "conservative") return "保守";
    if (priceSource === "balanced") return "平衡";
    if (priceSource === "aggressive") return "抢单";
    if (priceSource === "median") return "平均价格";
    if (priceSource === "highest") return "求购最高";
    return "在售最低";
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
      state.cfg.batchSize,
      state.cfg.batchPause,
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
      const listingUrl =
        `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}?l=english`;
      const listingResponse = await requestQueue.fetch(listingUrl, {
        requestPolicy: "default",
      });
      const listingHtml = listingResponse?.text || "";
      const listingSnapshot = parseMarketListingSnapshotFromHtml(
        listingHtml,
        marketHashName
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
      if (
        Number.isInteger(listingSnapshot?.currency)
        && listingSnapshot.currency > 0
        && listingSnapshot.currency !== currencyContext.currencyId
      ) {
        throw new Error(
          `商品页币种不一致 (${listingSnapshot.currency}/${currencyContext.currencyId})`
        );
      }
      if (
        Number.isInteger(listingSnapshot?.currency)
        && listingSnapshot.currency > 0
        && !(Number.isFinite(listingSnapshot.highestBuyCents) && listingSnapshot.highestBuyCents > 0)
      ) {
        throw createNoBuyOrdersError();
      }
      const newOrderbook = parseMarketOrderbookFromListingHtml(listingHtml, marketHashName);
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
    const cached = state.marketOrderDepths.get(cacheKey);
    if (cached?.depth && Date.now() - cached.fetchedAt < 30000) {
      return cached.depth;
    }

    const ownedQueue = queue ? null : new RequestQueue(
      state.cfg.requestInterval,
      state.cfg.batchSize,
      state.cfg.batchPause,
      state,
      null,
      null,
      { stopPredicate: () => false }
    );
    const requestQueue = queue || ownedQueue;
    try {
      const listingUrl =
        `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}?l=english`;
      const response = await requestQueue.fetch(listingUrl, { requestPolicy: "default" });
      const listingHtml = response?.text || "";
      const snapshot = parseMarketListingSnapshotFromHtml(listingHtml, marketHashName);
      const depth = parseMarketOrderDepthFromListingHtml(listingHtml, marketHashName);
      if (!depth) {
        if (
          Number.isInteger(snapshot?.currency)
          && snapshot.currency > 0
          && snapshot.currency !== currencyContext.currencyId
        ) {
          throw new Error(
            `商品页币种不一致 (${snapshot.currency}/${currencyContext.currencyId})`
          );
        }
        if (
          Number.isInteger(snapshot?.currency)
          && snapshot.currency > 0
          && !(Number.isFinite(snapshot.highestBuyCents) && snapshot.highestBuyCents > 0)
        ) {
          throw createNoBuyOrdersError();
        }
        throw new Error("商品页缺少有效的完整买单深度");
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
      state.marketOrderDepths.set(cacheKey, { depth, fetchedAt: observedAt });
      return depth;
    } finally {
      ownedQueue?.stop();
    }
  }

  export async function buildBuyOrderPlan(selected, activeOrders, ui = {}) {
    const statusFn = ui.setStatus || setStatus;
    const logFn = ui.log || log;
    const pricingProfile = getActiveOrderPricingProfile(
      state.cfg,
      state.automaticPricingDraft
    );
    const priceSource = pricingProfile.priceSource;
    const adjustmentValue = pricingProfile.adjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const currencyContext = getOrderCurrencyContext();
    const minimumCents = getMarketMinimumPriceCents(currencyContext);
    if (!Number.isSafeInteger(minimumCents) || minimumCents <= 0) {
      throw new Error("无法确认当前币种的 Steam 市场最低价");
    }
    const plan = [];
    const skipped = {
      covered: 0,
      missingPrice: 0,
      missingHash: 0,
      clamped: 0,
      minimumClamped: 0,
      sellGuardClamped: 0,
      minimumPriceFallback: 0,
    };
    const candidates = [];
    const marketRecords = [];

    for (const info of selected) {
      for (const card of info.cards) {
        if (!card.marketHashName) {
          skipped.missingHash++;
          continue;
        }

        const targetQuantity = getMultibuyQuantity(
          state.cfg.buyMode || "complete1",
          info.level,
          card.owned,
          getBadgeTargetLevel(info)
        );
        if (targetQuantity <= 0) continue;

        const activeQuantity = activeOrders.get(card.marketHashName)?.quantity || 0;
        const pendingQuantity = getPendingOrderExpectedQuantity(card.marketHashName);
        const reservedQuantity = Math.max(activeQuantity, pendingQuantity);
        const quantity = Math.max(0, targetQuantity - reservedQuantity);
        if (quantity <= 0) {
          skipped.covered++;
          continue;
        }

        candidates.push({
          info,
          card,
          quantity,
          reservedQuantity,
          targetQuantity,
        });
      }
    }

    for (let index = 0; index < candidates.length; index++) {
      const { info, card, quantity, reservedQuantity, targetQuantity } = candidates[index];
      let basePriceCents = null;
      let unitPriceCents = null;
      let automaticQuote = null;
      let pricingError = null;
      let minimumFallbackReason = null;
      if (pricingProfile.automatic) {
        statusFn(`自动定价 ${index + 1}/${candidates.length}: ${card.name}`);
        try {
          const depth = await fetchMarketOrderDepth(card.marketHashName, ui.queue || null, {
            onRecord: record => marketRecords.push(record),
          });
          automaticQuote = calculateAutomaticBuyPrice(depth, {
            strategy: priceSource,
            strategyRule: pricingProfile.strategyRule,
            adjustmentMinor: adjustmentCents,
            minimumPriceMinor: minimumCents,
          });
          basePriceCents = automaticQuote
            ? automaticQuote.wallReferencePriceMinor
              ?? automaticQuote.effectiveHighestBuyMinor
              ?? null
            : null;
          unitPriceCents = automaticQuote?.finalPriceMinor ?? null;
          if (!automaticQuote) {
            pricingError = new Error("无法根据订单簿计算自动定价");
          }
        } catch (error) {
          pricingError = error;
        }
      } else if (
        priceSource === "lowest"
        && card.priceSource === "lowest"
        && Number.isFinite(card.lowestCents)
        && card.lowestCents > 0
      ) {
        basePriceCents = card.lowestCents;
      } else if (
        priceSource === "median"
        && Number.isFinite(card.medianCents)
        && card.medianCents > 0
      ) {
        basePriceCents = card.medianCents;
      } else if (priceSource === "highest") {
        statusFn(`读取求购最高 ${index + 1}/${candidates.length}: ${card.name}`);
        try {
          basePriceCents = await fetchHighestBuyPrice(card.marketHashName, ui.queue || null, {
            persistMarketCache: false,
            onRecord: record => marketRecords.push(record),
          });
        } catch (error) {
          pricingError = error;
        }
      }
      if (basePriceCents == null) {
        const canUseMinimumFallback = state.cfg.minimumPriceFallback
          && (!pricingError || isNoBuyOrdersError(pricingError));
        if (canUseMinimumFallback) {
          basePriceCents = minimumCents;
          minimumFallbackReason = isNoBuyOrdersError(pricingError)
            ? "no-buy-orders"
            : "missing-price";
          skipped.minimumPriceFallback++;
          const reasonLabel = minimumFallbackReason === "no-buy-orders"
            ? "当前无买单"
            : "缺少所选价格";
          logFn(
            `  ${info.gameName} · ${card.name}: ${reasonLabel}，使用市场最低价 ${formatMoney(minimumCents)}`,
            "warn"
          );
        } else {
          if (pricingError) {
            logFn(
              `  ${info.gameName} · ${card.name}: ${pricingError?.message || pricingError}，已跳过`,
              "warn"
            );
          }
          skipped.missingPrice++;
          continue;
        }
      }

      if (unitPriceCents == null) {
        const adjustedPrice = basePriceCents + adjustmentCents;
        unitPriceCents = Math.max(minimumCents, adjustedPrice);
        if (unitPriceCents !== adjustedPrice) {
          skipped.clamped++;
          skipped.minimumClamped++;
        }
      } else {
        if (automaticQuote?.wasMinimumClamped) {
          skipped.clamped++;
          skipped.minimumClamped++;
        }
        if (automaticQuote?.wasSellGuardClamped) {
          skipped.clamped++;
          skipped.sellGuardClamped++;
        }
      }
      plan.push({
        appid: info.appid,
        gameName: info.gameName,
        cardName: card.name,
        marketHashName: card.marketHashName,
        quantity,
        reservedQuantity,
        targetQuantity,
        basePriceCents,
        unitPriceCents,
        automaticPricing: pricingProfile.automatic,
        strategyOffsetCents: automaticQuote && basePriceCents != null
          ? automaticQuote.strategyBasePriceMinor - basePriceCents
          : 0,
        wallClassification: minimumFallbackReason
          ? minimumFallbackReason
          : automaticQuote?.classification || null,
        isolatedHighPrice: automaticQuote?.detection?.isolation?.classification === "isolated-high",
        originalHighestBuyCents: automaticQuote?.highestBuyMinor ?? null,
        effectiveHighestBuyCents: automaticQuote?.effectiveHighestBuyMinor ?? null,
        minimumPriceFallback: minimumFallbackReason !== null,
        minimumFallbackReason,
        totalPriceCents: unitPriceCents * quantity,
      });
    }

    persistMarketObservations(marketRecords);
    return {
      plan,
      skipped,
      priceSource,
      adjustmentCents,
      minimumCents,
      automaticPricing: pricingProfile.automatic,
      strategyRule: pricingProfile.strategyRule || null,
    };
  }

  export function showBuyOrderConfirmation(planData, selectedGameCount) {
    return new Promise(resolve => {
      const {
        plan,
        skipped,
        priceSource,
        adjustmentCents,
        minimumCents,
        automaticPricing,
        strategyRule,
      } = planData;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
      const totalCents = plan.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const plannedGameCount = new Set(plan.map(item => `${item.appid}:${item.gameName}`)).size;
      const adjustmentText = adjustmentCents >= 0
        ? `+${formatMoney(adjustmentCents)}`
        : formatMoney(adjustmentCents);
      const signedMoney = value => value >= 0
        ? `+${formatMoney(value)}`
        : formatMoney(value);
      const pricingSummary = automaticPricing
        ? `价格基准 <b>自动定价 · ${getOrderPriceSourceLabel(priceSource)}</b> · `
          + `有墙调整 <b>${signedMoney(strategyRule?.wallOffsetMinor || 0)}</b> · `
          + `无墙调整 <b>${signedMoney(strategyRule?.noWallOffsetMinor || 0)}</b>`
        : `价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> · `
          + `买价调整 <b>${adjustmentText}</b>`;

      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认提交长期订购单</h3>
          <div class="stch-order-summary">
            游戏 <b>${plannedGameCount}</b>/${selectedGameCount} 个 · 卡牌种类 <b>${plan.length}</b> ·
            数量 <b>${totalQuantity}</b> 张 · 新增最高占用 <b>${formatMoney(totalCents)}</b><br>
            ${pricingSummary}
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note"></div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">提交订购单</div>
          </div>
        </div>
      `;

      const list = backdrop.querySelector(".stch-order-list");
      plan.forEach(item => {
        const row = document.createElement("div");
        row.className = "stch-order-item";
        row.title = `${item.gameName} · ${item.marketHashName}`;
        row.appendChild(createTextSpan("", `${item.gameName} · ${item.cardName}`));
        row.appendChild(createTextSpan("", `${item.quantity} 张`));
        const priceBasisLabel = item.minimumPriceFallback
          ? item.minimumFallbackReason === "no-buy-orders"
            ? "无买单 · 最低价回退"
            : "缺价 · 最低价回退"
          : item.automaticPricing
            ? `${item.isolatedHighPrice ? "孤立价已排除 · " : ""}${item.wallClassification === "near-wall" ? "有墙" : "无墙"}`
            : "";
        row.appendChild(createTextSpan(
          "stch-order-price-basis",
          `${priceBasisLabel ? `${priceBasisLabel} · ` : ""}基准 ${formatMoney(item.basePriceCents)}`
          + `${item.automaticPricing ? ` · 调整 ${signedMoney(item.strategyOffsetCents)}` : ""}`
        ));
        row.appendChild(createTextSpan("", formatMoney(item.unitPriceCents)));
        list.appendChild(row);
      });

      const notes = [];
      if (skipped.covered) notes.push(`${skipped.covered} 种卡牌已被现有订购单覆盖`);
      if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 种卡牌缺少所选价格，已跳过`);
      if (skipped.missingHash) notes.push(`${skipped.missingHash} 种卡牌缺少市场标识，已跳过`);
      if (skipped.minimumPriceFallback) notes.push(
        `${skipped.minimumPriceFallback} 种卡牌缺少可用价格，已使用市场最低价 ${formatMoney(minimumCents)}`
      );
      const isolatedHighPriceCount = plan.reduce(
        (count, item) => count + Number(item.isolatedHighPrice),
        0
      );
      if (isolatedHighPriceCount) notes.push(
        `${isolatedHighPriceCount} 种卡牌已排除顶部孤立高价`
      );
      if (skipped.minimumClamped) notes.push(
        `${skipped.minimumClamped} 种卡牌低于 Steam 最低价，已调整为 ${formatMoney(minimumCents)}`
      );
      if (skipped.sellGuardClamped) notes.push(
        `${skipped.sellGuardClamped} 种卡牌已限制在最低卖价以下`
      );
      backdrop.querySelector(".stch-order-note").textContent =
        `${notes.join("；") || "未发现需跳过的卡牌"}。` +
        "订单将长期保留，直到成交或手动取消；提交即表示同意 Steam 订户协议。";

      const finish = confirmed => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }

  export async function createLongTermBuyOrder(item, ui = {}) {
    const statusFn = ui.setStatus || setStatus;
    const logFn = ui.log || log;
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    if (unsafeWindow.g_bRequiresBillingInfo === true) {
      throw new Error("Steam 要求补充账单信息，请先在市场页面手动提交一次订单");
    }

    let confirmation = 0;
    for (let attempt = 0; attempt < 41; attempt++) {
      const body = new URLSearchParams({
        sessionid: sessionId,
        currency: String(getOrderCurrencyContext().currencyId),
        appid: "753",
        market_hash_name: item.marketHashName,
        price_total: String(item.totalPriceCents),
        quantity: String(item.quantity),
        first_name: "",
        last_name: "",
        billing_address: "",
        billing_address_two: "",
        billing_country: "",
        billing_city: "",
        billing_state: "",
        billing_postal_code: "",
        save_my_address: "0",
        confirmation: String(confirmation || 0),
      });
      const response = await window.fetch(
        "https://steamcommunity.com/market/createbuyorder/",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: body.toString(),
        }
      );
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (data?.success === 1) return data;
      if (data?.need_confirmation && data?.confirmation?.confirmation_id) {
        confirmation = data.confirmation.confirmation_id;
        if (attempt === 0) {
          logFn(`  ${item.cardName}: 等待 Steam 移动确认`, "warn");
          statusFn(`请在 Steam 移动应用中确认: ${item.cardName}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      throw new Error(data?.message || `提交失败 (${response.status})`);
    }
    throw new Error("等待 Steam 移动确认超时");
  }

  export async function submitBuyOrdersForSelection(source = "scan") {
    const isOrder = source === "order";
    const statusFn = isOrder ? setOrderStatus : setStatus;
    const logFn = isOrder ? orderLog : log;
    const selected = isOrder ? getSelectedOrderResults() : getSelectedResults();
    if (state.orderSubmissionRunning) return;
    if (selected.length === 0) {
      statusFn("请先勾选要提交订购单的卡组", false);
      return;
    }

    const queue = new RequestQueue(
      state.cfg.requestInterval,
      state.cfg.batchSize,
      state.cfg.batchPause,
      state,
      statusFn,
      logFn,
      { stopPredicate: () => false }
    );
    const ui = { setStatus: statusFn, log: logFn, queue };

    state.orderSubmissionRunning = true;
    updateAllActionStates();
    let submitted = 0;
    let failed = 0;
    let finalStatus = null;
    try {
      statusFn("读取现有订购单");
      const activeOrders = await loadActiveBuyOrders(queue);
      const planData = await buildBuyOrderPlan(selected, activeOrders, ui);
      if (planData.plan.length === 0) {
        finalStatus = `无需提交订购单：已有订单已覆盖，或没有可用的${getOrderPriceSourceLabel(planData.priceSource)}`;
        logFn(finalStatus, "warn");
        return;
      }

      const confirmed = await showBuyOrderConfirmation(planData, selected.length);
      if (!confirmed) {
        finalStatus = "已取消提交订购单";
        return;
      }

      for (let index = 0; index < planData.plan.length; index++) {
        const item = planData.plan[index];
        statusFn(`提交订购单 ${index + 1}/${planData.plan.length}: ${item.cardName}`);
        try {
          const result = await createLongTermBuyOrder(item, ui);
          submitted++;
          state.pendingOrderQuantities.set(getCurrencyMarketKey(item.marketHashName), {
            expectedQuantity: item.reservedQuantity + item.quantity,
            createdAt: Date.now(),
          });
          logFn(
            `  ✓ ${item.gameName} · ${item.cardName}: ${item.quantity} 张 @ ` +
            `${formatMoney(item.unitPriceCents)}，订单 ${result.buy_orderid}`,
            "ok"
          );
        } catch (error) {
          failed++;
          logFn(
            `  ✗ ${item.gameName} · ${item.cardName}: ${error?.message || error}`,
            "err"
          );
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      finalStatus = `长期订购单提交结束: 成功 ${submitted}, 失败 ${failed}`;
      logFn(finalStatus, failed ? "warn" : "ok");
    } catch (error) {
      finalStatus = `无法提交长期订购单: ${error?.message || error}`;
      logFn(finalStatus, "err");
    } finally {
      queue.stop();
      state.orderSubmissionRunning = false;
      if (isOrder && finalStatus) {
        statusFn(finalStatus, false);
      } else {
        statusFn(null);
      }
      updateAllActionStates();
    }
  }

  export async function submitSelectedBuyOrders() {
    return submitBuyOrdersForSelection("scan");
  }

  export async function submitSelectedOrderBuyOrders() {
    return submitBuyOrdersForSelection("order");
  }
