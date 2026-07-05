import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { formatCNY } from "../utils/format.js";

import { getMarketMinimumPriceCents, getSessionId } from "../utils/steam.js";

import { getBadgeTargetLevel, getBadgeUrlSuffix } from "../utils/badge.js";

import { getMultibuyQuantity } from "./multibuy.js";

import { parseMarketOrderbookFromListingHtml, parseMarketHashNameFromHref } from "../parsers/market-listing.js";

import { upsertOrderResult, getCachedOrderResult, readRawOrderCache, isOrderCacheFresh, saveOrderCache } from "../services/order-cache.js";

import { getSelectedResults, getSelectedOrderResults, refreshResultInfo, getResultKey } from "../services/result-info.js";

import { updateAllActionStates, isSharedActionBusy } from "../ui/action-state.js";

import { renderOrderResults } from "../ui/render.js";

import { scanStatus, orderStatus, orderLog } from "../status-controllers.js";

import { createTextSpan } from "../utils/dom.js";

import { unsafeWindow } from "../globals.js";

const { log, setStatus } = scanStatus;

const { setStatus: setOrderStatus } = orderStatus;

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
      orderLog,
      cfg.scanInterval
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
        `补全 ¥${info.cheapestSetCNY} | 全套 ¥${info.fullSetCNY} | 满级 ¥${info.level5CNY}`,
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

  export async function loadActiveBuyOrders() {
    const response = await window.fetch(
      "https://steamcommunity.com/market/mylistings?start=0&count=100",
      { credentials: "include" }
    );
    if (!response.ok) {
      throw new Error(`读取现有订购单失败 (${response.status})`);
    }
    const data = await response.json();
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
    const pending = state.pendingOrderQuantities.get(marketHashName);
    if (!pending) return 0;
    if (Date.now() - pending.createdAt > 2 * 60 * 1000) {
      state.pendingOrderQuantities.delete(marketHashName);
      return 0;
    }
    return pending.expectedQuantity;
  }

  export function getOrderPriceSourceLabel(priceSource) {
    if (priceSource === "median") return "平均价格";
    if (priceSource === "highest") return "求购最高";
    return "在售最低";
  }

  export async function fetchHighestBuyPrice(marketHashName) {
    const cached = state.highestBuyPrices.get(marketHashName);
    if (
      Number.isFinite(cached?.priceCents)
      && cached.priceCents > 0
      && Date.now() - cached.fetchedAt < 30000
    ) {
      return cached.priceCents;
    }

    const listingUrl =
      `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}`;
    const listingResponse = await window.fetch(listingUrl, { credentials: "include" });
    if (!listingResponse.ok) {
      throw new Error(`读取商品页失败 (${listingResponse.status})`);
    }
    const listingHtml = await listingResponse.text();
    const newOrderbook = parseMarketOrderbookFromListingHtml(
      listingHtml,
      marketHashName
    );
    if (newOrderbook) {
      const walletCurrency = Number(
        unsafeWindow.g_rgWalletInfo?.wallet_currency || 23
      );
      if (
        newOrderbook.currency != null
        && newOrderbook.currency !== walletCurrency
      ) {
        throw new Error(
          `商品页币种不一致 (${newOrderbook.currency}/${walletCurrency})`
        );
      }
      if (newOrderbook.highestBuyCents <= 0) {
        throw new Error("当前没有可用的最高求购价格");
      }
      state.highestBuyPrices.set(marketHashName, {
        priceCents: newOrderbook.highestBuyCents,
        fetchedAt: Date.now(),
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
      country: unsafeWindow.g_strCountryCode || "CN",
      language: unsafeWindow.g_strLanguage || "schinese",
      currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
      item_nameid: itemNameIdMatch[1],
    });
    const histogramResponse = await window.fetch(
      `https://steamcommunity.com/market/itemordershistogram?${params}`,
      { credentials: "include" }
    );
    if (!histogramResponse.ok) {
      throw new Error(`读取市场订单簿失败 (${histogramResponse.status})`);
    }
    const histogram = await histogramResponse.json();
    const highestBuyCents = parseInt(histogram?.highest_buy_order, 10);
    if (
      (histogram?.success !== true && histogram?.success !== 1)
      || !Number.isFinite(highestBuyCents)
      || highestBuyCents <= 0
    ) {
      throw new Error("当前没有可用的最高求购价格");
    }

    state.highestBuyPrices.set(marketHashName, {
      priceCents: highestBuyCents,
      fetchedAt: Date.now(),
    });
    return highestBuyCents;
  }

  export async function buildBuyOrderPlan(selected, activeOrders, ui = {}) {
    const statusFn = ui.setStatus || setStatus;
    const logFn = ui.log || log;
    const configuredPriceSource =
      document.getElementById("stch-order-price-source")?.value
      || state.cfg.orderPriceSource
      || "lowest";
    const priceSource = ["lowest", "median", "highest"].includes(configuredPriceSource)
      ? configuredPriceSource
      : "lowest";
    const adjustmentInput = document.getElementById("stch-price-adjustment");
    const adjustmentValue = adjustmentInput
      ? parseFloat(adjustmentInput.value)
      : state.cfg.priceAdjustment;
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
    };
    const candidates = [];

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
      if (
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
          basePriceCents = await fetchHighestBuyPrice(card.marketHashName);
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

      const adjustedPrice = basePriceCents + adjustmentCents;
      const unitPriceCents = Math.max(minimumCents, adjustedPrice);
      if (unitPriceCents !== adjustedPrice) skipped.clamped++;
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
        totalPriceCents: unitPriceCents * quantity,
      });
    }

    return { plan, skipped, priceSource, adjustmentCents, minimumCents };
  }

  export function showBuyOrderConfirmation(planData, selectedGameCount) {
    return new Promise(resolve => {
      const { plan, skipped, priceSource, adjustmentCents, minimumCents } = planData;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
      const totalCents = plan.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const plannedGameCount = new Set(plan.map(item => `${item.appid}:${item.gameName}`)).size;
      const adjustmentText = `${adjustmentCents >= 0 ? "+" : "-"}¥${formatCNY(Math.abs(adjustmentCents))}`;

      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认提交长期订购单</h3>
          <div class="stch-order-summary">
            游戏 <b>${plannedGameCount}</b>/${selectedGameCount} 个 · 卡牌种类 <b>${plan.length}</b> ·
            数量 <b>${totalQuantity}</b> 张 · 新增最高占用 <b>¥${formatCNY(totalCents)}</b><br>
            价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> ·
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
        row.appendChild(createTextSpan("", `¥${formatCNY(item.unitPriceCents)}`));
        list.appendChild(row);
      });

      const notes = [];
      if (skipped.covered) notes.push(`${skipped.covered} 种卡牌已被现有订购单覆盖`);
      if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 种卡牌缺少所选价格，已跳过`);
      if (skipped.missingHash) notes.push(`${skipped.missingHash} 种卡牌缺少市场标识，已跳过`);
      if (skipped.clamped) {
        notes.push(`${skipped.clamped} 种卡牌低于 Steam 最低价，已调整为 ¥${formatCNY(minimumCents)}`);
      }
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
        currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
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
    const selected = isOrder ? getSelectedOrderResults() : getSelectedResults();
    if (selected.length === 0 || isSharedActionBusy()) return;

    const statusFn = isOrder ? setOrderStatus : setStatus;
    const logFn = isOrder ? orderLog : log;
    const ui = { setStatus: statusFn, log: logFn };

    state.bulkActionRunning = true;
    updateAllActionStates();
    let submitted = 0;
    let failed = 0;
    try {
      statusFn("读取现有订购单");
      const activeOrders = await loadActiveBuyOrders();
      const planData = await buildBuyOrderPlan(selected, activeOrders, ui);
      if (planData.plan.length === 0) {
        logFn(
          `无需提交订购单：已有订单已覆盖，或没有可用的${getOrderPriceSourceLabel(planData.priceSource)}`,
          "warn"
        );
        return;
      }

      const confirmed = await showBuyOrderConfirmation(planData, selected.length);
      if (!confirmed) return;

      for (let index = 0; index < planData.plan.length; index++) {
        const item = planData.plan[index];
        statusFn(`提交订购单 ${index + 1}/${planData.plan.length}: ${item.cardName}`);
        try {
          const result = await createLongTermBuyOrder(item, ui);
          submitted++;
          state.pendingOrderQuantities.set(item.marketHashName, {
            expectedQuantity: item.reservedQuantity + item.quantity,
            createdAt: Date.now(),
          });
          logFn(
            `  ✓ ${item.gameName} · ${item.cardName}: ${item.quantity} 张 @ ` +
            `¥${formatCNY(item.unitPriceCents)}，订单 ${result.buy_orderid}`,
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
      logFn(`长期订购单提交结束: 成功 ${submitted}, 失败 ${failed}`, failed ? "warn" : "ok");
    } catch (error) {
      logFn(`无法提交长期订购单: ${error?.message || error}`, "err");
    } finally {
      state.bulkActionRunning = false;
      statusFn(null);
      updateAllActionStates();
    }
  }

  export async function submitSelectedBuyOrders() {
    return submitBuyOrdersForSelection("scan");
  }

  export async function submitSelectedOrderBuyOrders() {
    return submitBuyOrdersForSelection("order");
  }
