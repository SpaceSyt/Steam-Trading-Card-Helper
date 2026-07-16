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
  parseMarketHashNameFromHref,
} from "../parsers/market-listing.js";
import { getActiveOrderPricingProfile } from "../config.js";
import { calculateAutomaticBuyPrice } from "../services/order-wall.js";

import { upsertOrderResult, getCachedOrderResult, readRawOrderCache, isOrderCacheFresh, saveOrderCache } from "../services/order-cache.js";

import { getSelectedResults, getSelectedOrderResults, refreshResultInfo, getResultKey } from "../services/result-info.js";

import { updateAllActionStates, isSharedActionBusy } from "../ui/action-state.js";

import { renderOrderResults } from "../ui/render.js";

import { scanStatus, orderStatus, orderLog } from "../status-controllers.js";

import { createTextSpan } from "../utils/dom.js";

import { unsafeWindow } from "../globals.js";
import {
  getActiveCurrencyContext,
  getCurrencyContextById,
} from "../services/currency.js";
import {
  normalizeItemOrdersHistogram,
  normalizeListingOrderbook,
} from "../services/market-data.js";
import { persistMarketObservations } from "../services/market-observations.js";

const { log, setStatus } = scanStatus;

const { setStatus: setOrderStatus } = orderStatus;

  function getOrderCurrencyContext() {
    return getActiveCurrencyContext()
      || getCurrencyContextById(state.cfg.currencyId || 23);
  }

  function getCurrencyMarketKey(marketHashName, currencyId = getOrderCurrencyContext().currencyId) {
    return JSON.stringify([String(currencyId), String(marketHashName || "")]);
  }

  export async function addManualOrderAppid() {
    if (isSharedActionBusy()) return;
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
      orderLog
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
        `补全 ${formatMoney(info.cheapestSetCostCents)} | ` +
        `全套 ${formatMoney(info.fullSetCostCents)} | ` +
        `满级 ${formatMoney(info.level5CostCents)}`,
        "ok"
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

  export function deleteExpiredOrderResults() {
    if (isSharedActionBusy()) return;
    const raw = readRawOrderCache();
    const fresh = raw.filter(isOrderCacheFresh);
    const expiredCount = raw.length - fresh.length;
    if (expiredCount <= 0) {
      setOrderStatus("没有过期缓存", false);
      return;
    }
    if (!confirm(`将删除 ${expiredCount} 项过期订购缓存，确定？`)) return;
    state.orderResults = fresh;
    state.selectedOrderResults.forEach(key => {
      if (!state.orderResults.some(info => getResultKey(info) === key)) {
        state.selectedOrderResults.delete(key);
      }
    });
    saveOrderCache();
    renderOrderResults();
    setOrderStatus(`已删除 ${expiredCount} 项过期缓存`, false);
  }

  export async function loadActiveBuyOrders(queue = null) {
    const ownedQueue = queue ? null : new RequestQueue(
      state.cfg.requestInterval,
      state.cfg.batchSize,
      state.cfg.batchPause,
      state
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
    if (data?.success !== true && data?.success !== 1) {
      throw new Error("Steam 未返回现有订购单");
    }

    const doc = new DOMParser().parseFromString(data.results_html || "", "text/html");
    const orders = new Map();
    doc.querySelectorAll('[id^="mybuyorder_"]').forEach(row => {
      const link = row.querySelector('a[href*="/market/listings/"]');
      const href = link?.getAttribute("href") || "";
      if (!href.includes("/market/listings/753/")) return;
      const marketHashName = parseMarketHashNameFromHref(link?.getAttribute("href"));
      if (!marketHashName) {
        throw new Error("无法解析现有 Steam 卡牌订购单");
      }

      const quantityCell = row.querySelector(
        ".market_listing_buyorder_qty .market_listing_price"
      );
      const quantity = parseInt(quantityCell?.textContent || "", 10) || 0;
      if (quantity <= 0) {
        throw new Error(`无法解析现有订购单数量: ${marketHashName}`);
      }
      const orderId = row.id.replace("mybuyorder_", "");
      const current = orders.get(marketHashName) || { quantity: 0, orderIds: [] };
      current.quantity += quantity;
      if (orderId) current.orderIds.push(orderId);
      orders.set(marketHashName, current);
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
      state
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
          throw new Error("当前没有可用的最高求购价格");
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

      const itemNameIdMatch =
        listingHtml.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/)
        || listingHtml.match(/ItemActivityTicker\.Start\(\s*(\d+)\s*\)/);
      if (!itemNameIdMatch) {
        throw new Error("商品页缺少可用的订单簿数据");
      }

      const params = new URLSearchParams({
        country: unsafeWindow.g_rgWalletInfo?.wallet_country
          || unsafeWindow.g_strCountryCode
          || "CN",
        language: unsafeWindow.g_strLanguage || "schinese",
        currency: String(currencyContext.currencyId),
        item_nameid: itemNameIdMatch[1],
      });
      const histogramResponse = await requestQueue.fetch(
        `https://steamcommunity.com/market/itemordershistogram?${params}`,
        { requestPolicy: "default" }
      );
      const histogram = histogramResponse?.data;
      const histogramRecord = normalizeItemOrdersHistogram(histogram, {
        appid: "753",
        marketHashName,
        currencyId: currencyContext.currencyId,
        currencyCode: currencyContext.code,
        observedAt: Date.now(),
      });
      const highestBuyCents = histogramRecord?.highestBuyMinor;
      if (
        (histogram?.success !== true && histogram?.success !== 1)
        || !Number.isFinite(highestBuyCents)
        || highestBuyCents <= 0
      ) {
        throw new Error("当前没有可用的最高求购价格");
      }

      const histogramSellOrderCount = Number(
        String(histogram?.sell_order_count ?? "").replace(/[\s,.'’]/g, "")
      );
      if (typeof options.onMetadata === "function") {
        options.onMetadata({
          displayName: listingSnapshot?.displayName || "",
          imageUrl: listingSnapshot?.imageUrl || "",
          sellOrderCount: Number.isSafeInteger(histogramSellOrderCount)
            && histogramSellOrderCount >= 0
            ? histogramSellOrderCount
            : listingSnapshot?.sellOrderCount ?? null,
          observedAt: histogramRecord.observedAt,
        });
      }

      observeRecord(histogramRecord);
      state.highestBuyPrices.set(cacheKey, {
        currencyId: currencyContext.currencyId,
        priceCents: highestBuyCents,
        fetchedAt: histogramRecord.observedAt,
        displayName: listingSnapshot?.displayName || "",
        imageUrl: listingSnapshot?.imageUrl || "",
        sellOrderCount: Number.isSafeInteger(histogramSellOrderCount)
          && histogramSellOrderCount >= 0
          ? histogramSellOrderCount
          : listingSnapshot?.sellOrderCount ?? null,
      });
      return highestBuyCents;
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
      state
    );
    const requestQueue = queue || ownedQueue;
    try {
      const listingUrl =
        `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}?l=english`;
      const response = await requestQueue.fetch(listingUrl, { requestPolicy: "default" });
      const listingHtml = response?.text || "";
      const depth = parseMarketOrderDepthFromListingHtml(listingHtml, marketHashName);
      if (!depth) throw new Error("商品页缺少有效的完整买单深度");
      if (depth.currencyId !== currencyContext.currencyId) {
        throw new Error(
          `商品页币种不一致 (${depth.currencyId}/${currencyContext.currencyId})`
        );
      }

      const observedAt = Date.now();
      const snapshot = parseMarketListingSnapshotFromHtml(listingHtml, marketHashName);
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
    const pricingProfile = getActiveOrderPricingProfile(state.cfg);
    const priceSource = pricingProfile.priceSource;
    const adjustmentValue = pricingProfile.adjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const minimumCents = getMarketMinimumPriceCents();
    const plan = [];
    const skipped = {
      covered: 0,
      missingPrice: 0,
      missingHash: 0,
      clamped: 0,
      minimumClamped: 0,
      sellGuardClamped: 0,
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
      if (pricingProfile.automatic) {
        statusFn(`自动定价 ${index + 1}/${candidates.length}: ${card.name}`);
        try {
          const depth = await fetchMarketOrderDepth(card.marketHashName, ui.queue || null, {
            onRecord: record => marketRecords.push(record),
          });
          automaticQuote = calculateAutomaticBuyPrice(depth, {
            strategy: priceSource,
            adjustmentMinor: adjustmentCents,
            minimumPriceMinor: minimumCents,
          });
          basePriceCents = automaticQuote?.strategyBasePriceMinor ?? null;
          unitPriceCents = automaticQuote?.finalPriceMinor ?? null;
        } catch (error) {
          logFn(
            `  ${info.gameName} · ${card.name}: ${error?.message || error}，已跳过`,
            "warn"
          );
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
          logFn(
            `  ${info.gameName} · ${card.name}: ${error?.message || error}，已跳过`,
            "warn"
          );
        }
      }
      if (basePriceCents == null) {
        skipped.missingPrice++;
        continue;
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
        wallClassification: automaticQuote?.classification || null,
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
      } = planData;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
      const totalCents = plan.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const plannedGameCount = new Set(plan.map(item => `${item.appid}:${item.gameName}`)).size;
      const adjustmentText = adjustmentCents >= 0
        ? `+${formatMoney(adjustmentCents)}`
        : formatMoney(adjustmentCents);

      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认提交长期订购单</h3>
          <div class="stch-order-summary">
            游戏 <b>${plannedGameCount}</b>/${selectedGameCount} 个 · 卡牌种类 <b>${plan.length}</b> ·
            数量 <b>${totalQuantity}</b> 张 · 新增最高占用 <b>${formatMoney(totalCents)}</b><br>
            价格基准 <b>${automaticPricing ? "自动定价 · " : ""}${getOrderPriceSourceLabel(priceSource)}</b> ·
            买价调整 <b>${adjustmentText}</b>
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
        row.appendChild(createTextSpan(
          "stch-order-price-basis",
          item.automaticPricing
            ? `${item.wallClassification === "near-wall" ? "有墙" : "无墙"} · 基准 ${formatMoney(item.basePriceCents)}`
            : `基准 ${formatMoney(item.basePriceCents)}`
        ));
        row.appendChild(createTextSpan("", formatMoney(item.unitPriceCents)));
        list.appendChild(row);
      });

      const notes = [];
      if (skipped.covered) notes.push(`${skipped.covered} 种卡牌已被现有订购单覆盖`);
      if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 种卡牌缺少所选价格，已跳过`);
      if (skipped.missingHash) notes.push(`${skipped.missingHash} 种卡牌缺少市场标识，已跳过`);
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
    if (isSharedActionBusy()) return;
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
      logFn
    );
    const ui = { setStatus: statusFn, log: logFn, queue };

    state.bulkActionRunning = true;
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
      state.bulkActionRunning = false;
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
