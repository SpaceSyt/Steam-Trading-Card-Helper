import { state } from "../state.js";
import { RequestQueue } from "../request/queue.js";
import {
  aggregateActiveBuyOrders,
  isCancelBuyOrderResponseSuccessful,
} from "../services/active-buy-orders.js";
import { calculateAutomaticBuyPrice } from "../services/order-wall.js";
import { getActiveOrderPricingProfile } from "../config.js";
import {
  fetchActiveBuyOrderSnapshot,
  getCurrencyMarketKey,
  getOrderCurrencyContext,
} from "./orders.js";
import { formatMoney } from "../utils/format.js";
import { getMarketMinimumPriceCents, getSessionId } from "../utils/steam.js";
import { enableCheckboxDragSelection } from "../ui/checkbox-drag.js";
import { isSharedActionBusy, updateAllActionStates } from "../ui/action-state.js";
import { priceCard } from "../parsers/price.js";

const LOWEST_SELL_CACHE_TTL_MS = 10 * 60 * 1000;

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function setStatus(text, type = "") {
  const element = document.getElementById("stch-active-orders-status");
  if (!element) return;
  element.textContent = text || "";
  element.className = `stch-status-text${type ? ` ${type}` : ""}`;
  element.style.display = text ? "" : "none";
}

function appendCancelLog(text, type = "") {
  const log = document.getElementById("stch-active-orders-log");
  if (!log) return;
  log.style.display = "";
  const line = createElement("div", type, text);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function getSmartComparison(group) {
  if (group.appid !== "753") {
    return { available: false, label: "非社区物品，暂无定价缓存", className: "unavailable" };
  }
  const depth = state.marketOrderDepths.get(getCurrencyMarketKey(group.marketHashName))?.depth;
  if (!depth) return { available: false, label: "暂无智能定价缓存", className: "unavailable" };
  const profile = getActiveOrderPricingProfile({
    ...state.cfg,
    automaticPricingEnabled: true,
  });
  const adjustment = Number(profile.adjustment);
  const quote = calculateAutomaticBuyPrice(depth, {
    strategy: profile.priceSource,
    strategyRule: profile.strategyRule,
    adjustmentMinor: Math.round((Number.isFinite(adjustment) ? adjustment : 0) * 100),
    minimumPriceMinor: getMarketMinimumPriceCents(getOrderCurrencyContext()),
  });
  if (!quote?.finalPriceMinor) {
    return { available: false, label: "缓存无法生成建议价", className: "unavailable" };
  }
  const representative = group.remainingQuantity > 0
    ? Math.round(group.frozenMinor / group.remainingQuantity)
    : group.minPriceMinor;
  const delta = representative - quote.finalPriceMinor;
  const sign = delta > 0 ? "+" : "−";
  return {
    available: true,
    suggestedMinor: quote.finalPriceMinor,
    deltaMinor: delta,
    label: delta === 0
      ? `与建议价 ${formatMoney(quote.finalPriceMinor)} 一致`
      : `${delta > 0 ? "高于" : "低于"}建议价 ${sign}${formatMoney(Math.abs(delta))}`,
    className: delta > 0 ? "high" : (delta < 0 ? "low" : "matched"),
  };
}

function getVisibleGroups() {
  if (state.activeOrdersGameFilter === "all") return state.activeBuyOrderGroups;
  return state.activeBuyOrderGroups.filter(group => (
    (group.gameName || `App ${group.appid}`) === state.activeOrdersGameFilter
  ));
}

function applyCachedLowestSellPrices(groups) {
  const now = Date.now();
  const currencyId = getOrderCurrencyContext().currencyId;
  groups.forEach(group => {
    const cached = state.activeOrderLowestPrices.get(group.key);
    if (
      !cached
      || cached.currencyId !== currencyId
      || now - cached.fetchedAt > LOWEST_SELL_CACHE_TTL_MS
    ) {
      if (cached) state.activeOrderLowestPrices.delete(group.key);
      return;
    }
    group.lowestSellMinor = cached.lowestSellMinor;
    group.lowestSellState = "ready";
  });
}

function updateHeaderSelectionState(visibleGroups = getVisibleGroups()) {
  const checkbox = document.getElementById("stch-active-orders-select-all");
  if (!checkbox) return;
  const selectedCount = visibleGroups.filter(group => (
    state.selectedActiveBuyOrderGroups.has(group.key)
  )).length;
  checkbox.checked = visibleGroups.length > 0 && selectedCount === visibleGroups.length;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleGroups.length;
  checkbox.disabled = isSharedActionBusy() || visibleGroups.length === 0;
}

function renderGameFilter() {
  const select = document.getElementById("stch-active-orders-game");
  if (!select) return;
  const games = [...new Set(state.activeBuyOrderGroups.map(group => (
    group.gameName || `App ${group.appid}`
  )))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  if (state.activeOrdersGameFilter !== "all" && !games.includes(state.activeOrdersGameFilter)) {
    state.activeOrdersGameFilter = "all";
  }
  select.replaceChildren();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = `全部游戏 (${games.length})`;
  select.appendChild(all);
  games.forEach(game => {
    const option = document.createElement("option");
    option.value = game;
    option.textContent = game;
    select.appendChild(option);
  });
  select.value = state.activeOrdersGameFilter;
}

function priceLabel(group) {
  if (group.minPriceMinor === group.maxPriceMinor) return formatMoney(group.minPriceMinor);
  return `${formatMoney(group.minPriceMinor)}–${formatMoney(group.maxPriceMinor)}`;
}

function lowestSellLabel(group) {
  if (Number.isSafeInteger(group.lowestSellMinor) && group.lowestSellMinor > 0) {
    return formatMoney(group.lowestSellMinor);
  }
  if (group.lowestSellState === "loading") return "查询中";
  if (group.lowestSellState === "missing") return "无数据";
  if (group.lowestSellState === "failed") return "失败";
  return "—";
}

function updateSummary(visibleGroups = getVisibleGroups()) {
  const all = state.activeBuyOrderGroups;
  const quantity = all.reduce((sum, group) => sum + group.remainingQuantity, 0);
  const frozen = all.reduce((sum, group) => sum + group.frozenMinor, 0);
  const selected = all.filter(group => state.selectedActiveBuyOrderGroups.has(group.key));
  const selectedFrozen = selected.reduce((sum, group) => sum + group.frozenMinor, 0);
  const summary = document.getElementById("stch-active-orders-summary");
  if (summary) {
    summary.textContent = `${all.length} 项 · 剩余 ${quantity} 件 · 冻结 ${formatMoney(frozen)}`
      + `${visibleGroups.length === all.length ? "" : ` · 当前显示 ${visibleGroups.length} 项`}`
      + `${selected.length ? ` · 已选冻结 ${formatMoney(selectedFrozen)}` : ""}`;
  }
  updateHeaderSelectionState(visibleGroups);
  updateAllActionStates();
}

function renderOrderRow(group) {
  const row = createElement("div", "stch-active-order-row");
  row.dataset.groupKey = group.key;
  row.classList.toggle("selected", state.selectedActiveBuyOrderGroups.has(group.key));

  const item = createElement("a", "stch-active-order-item");
  item.href = group.listingUrl;
  item.target = "_blank";
  item.rel = "noopener noreferrer";
  if (group.imageUrl) {
    const image = createElement("img", "stch-active-order-image");
    image.src = group.imageUrl;
    image.alt = "";
    item.appendChild(image);
  }
  const names = createElement("span", "stch-active-order-names");
  names.appendChild(createElement("span", "stch-active-order-name", group.displayName));
  names.appendChild(createElement("span", "stch-active-order-game", group.gameName || group.marketHashName));
  item.appendChild(names);
  row.appendChild(item);

  const price = createElement("div", "stch-active-order-metric");
  price.appendChild(createElement("span", "stch-active-order-value", priceLabel(group)));
  row.appendChild(price);

  const lowest = createElement(
    "div",
    `stch-active-order-value stch-active-order-lowest ${group.lowestSellState || "idle"}`,
    lowestSellLabel(group)
  );
  row.appendChild(lowest);

  const quantity = createElement("div", "stch-active-order-metric");
  quantity.appendChild(createElement("span", "stch-active-order-value", String(group.remainingQuantity)));
  row.appendChild(quantity);

  const frozen = createElement("div", "stch-active-order-metric");
  frozen.appendChild(createElement("span", "stch-active-order-value", formatMoney(group.frozenMinor)));
  row.appendChild(frozen);

  const comparison = getSmartComparison(group);
  const smart = createElement("div", `stch-active-order-smart ${comparison.className}`, comparison.label);
  if (comparison.available) smart.title = `使用当前自动定价设置与已缓存订单簿计算；建议价 ${formatMoney(comparison.suggestedMinor)}`;
  row.appendChild(smart);

  const select = createElement("label", "stch-active-order-select");
  const checkbox = createElement("input", "stch-active-order-cb");
  checkbox.type = "checkbox";
  checkbox.checked = state.selectedActiveBuyOrderGroups.has(group.key);
  checkbox.setAttribute("aria-label", `选择 ${group.displayName}`);
  select.appendChild(checkbox);
  row.appendChild(select);

  checkbox.addEventListener("change", () => {
    if (checkbox.checked) state.selectedActiveBuyOrderGroups.add(group.key);
    else state.selectedActiveBuyOrderGroups.delete(group.key);
    row.classList.toggle("selected", checkbox.checked);
    updateSummary();
  });
  return row;
}

export function renderActiveBuyOrders() {
  const list = document.getElementById("stch-active-orders-list");
  if (!list) return;
  renderGameFilter();
  const visible = getVisibleGroups();
  list.innerHTML = "";
  if (visible.length === 0) {
    list.appendChild(createElement(
      "div",
      "stch-active-orders-empty",
      state.activeBuyOrderGroups.length ? "当前筛选没有结果" : "暂无已下订购单"
    ));
  } else {
    const fragment = document.createDocumentFragment();
    const header = createElement("div", "stch-active-order-header");
    ["物品", "买价", "最低售价", "剩余", "冻结金额", "智能定价"].forEach(label => {
      header.appendChild(createElement("span", "", label));
    });
    const selectAllWrap = createElement("label", "stch-active-order-select-all-wrap");
    const selectAll = createElement("input", "stch-active-order-select-all");
    selectAll.id = "stch-active-orders-select-all";
    selectAll.type = "checkbox";
    selectAll.setAttribute("aria-label", "全选当前游戏的订购单");
    selectAllWrap.appendChild(selectAll);
    header.appendChild(selectAllWrap);
    selectAll.addEventListener("change", () => {
      visible.forEach(group => {
        if (selectAll.checked) state.selectedActiveBuyOrderGroups.add(group.key);
        else state.selectedActiveBuyOrderGroups.delete(group.key);
      });
      renderActiveBuyOrders();
    });
    fragment.appendChild(header);
    let previousGame = null;
    visible.forEach(group => {
      const game = group.gameName || `App ${group.appid}`;
      if (game !== previousGame) {
        fragment.appendChild(createElement("div", "stch-active-order-game-separator", game));
        previousGame = game;
      }
      fragment.appendChild(renderOrderRow(group));
    });
    list.appendChild(fragment);
  }
  updateSummary(visible);
}

export async function refreshActiveBuyOrders() {
  if (isSharedActionBusy()) return;
  state.activeOrdersLoading = true;
  updateAllActionStates();
  setStatus("正在读取 Steam 市场订购单…");
  const queue = new RequestQueue(
    state.cfg.requestInterval,
    state.cfg.batchSize,
    state.cfg.batchPause,
    state
  );
  try {
    const snapshot = await fetchActiveBuyOrderSnapshot(queue);
    state.activeBuyOrders = snapshot.orders;
    state.activeBuyOrderGroups = aggregateActiveBuyOrders(snapshot.orders);
    applyCachedLowestSellPrices(state.activeBuyOrderGroups);
    state.activeOrdersDiagnostics = snapshot.diagnostics;
    state.activeOrdersLoadedAt = snapshot.observedAt;
    const keys = new Set(state.activeBuyOrderGroups.map(group => group.key));
    state.selectedActiveBuyOrderGroups.forEach(key => {
      if (!keys.has(key)) state.selectedActiveBuyOrderGroups.delete(key);
    });
    renderActiveBuyOrders();
    setStatus(
      snapshot.diagnostics.length
        ? `已读取 ${snapshot.orders.length} 笔；另有 ${snapshot.diagnostics.length} 行无法确认，未纳入操作`
        : `已读取 ${snapshot.orders.length} 笔订购单`,
      snapshot.diagnostics.length ? "warn" : "ok"
    );
  } catch (error) {
    setStatus(`读取失败：${error?.message || error}`, "err");
  } finally {
    queue.stop();
    state.activeOrdersLoading = false;
    updateAllActionStates();
  }
}

async function querySelectedLowestSellPrices() {
  if (isSharedActionBusy()) return;
  const groups = state.activeBuyOrderGroups.filter(group => (
    state.selectedActiveBuyOrderGroups.has(group.key)
  ));
  if (groups.length === 0) return;

  state.activeOrdersLoading = true;
  groups.forEach(group => { group.lowestSellState = "loading"; });
  renderActiveBuyOrders();
  updateAllActionStates();
  const queue = new RequestQueue(
    state.cfg.requestInterval,
    state.cfg.batchSize,
    state.cfg.batchPause,
    state,
    text => setStatus(text || "正在查询最低售价")
  );
  let found = 0;
  let missing = 0;
  try {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      setStatus(`正在查询最低售价 ${index + 1}/${groups.length}：${group.displayName}`);
      const result = await priceCard(group.marketHashName, queue, {
        appid: group.appid,
        currencyId: getOrderCurrencyContext().currencyId,
      });
      const lowest = Number(result?.record?.lowestSellMinor);
      if (Number.isSafeInteger(lowest) && lowest > 0) {
        group.lowestSellMinor = lowest;
        group.lowestSellState = "ready";
        state.activeOrderLowestPrices.set(group.key, {
          lowestSellMinor: lowest,
          currencyId: getOrderCurrencyContext().currencyId,
          fetchedAt: Date.now(),
        });
        found += 1;
      } else {
        group.lowestSellMinor = null;
        group.lowestSellState = result?.noPriceData ? "missing" : "failed";
        missing += 1;
      }
      renderActiveBuyOrders();
    }
    setStatus(
      missing ? `最低售价查询完成：成功 ${found} 项，缺失或失败 ${missing} 项` : `最低售价查询完成：${found} 项`,
      missing ? "warn" : "ok"
    );
  } catch (error) {
    setStatus(`最低售价查询中断：${error?.message || error}`, "err");
  } finally {
    queue.stop();
    groups.forEach(group => {
      if (group.lowestSellState === "loading") group.lowestSellState = "failed";
    });
    state.activeOrdersLoading = false;
    renderActiveBuyOrders();
    updateAllActionStates();
  }
}

async function cancelBuyOrder(order) {
  const sessionid = getSessionId();
  if (!sessionid) throw new Error("未找到 Steam sessionid");
  const response = await window.fetch("https://steamcommunity.com/market/cancelbuyorder/", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: new URLSearchParams({ sessionid, buy_orderid: order.orderId }).toString(),
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // An ambiguous response must remain visible and must not be retried automatically.
  }
  if (!isCancelBuyOrderResponseSuccessful(response.ok, data)) {
    throw new Error(`Steam 返回未确认结果（HTTP ${response.status}）`);
  }
}

async function cancelGroups(groups) {
  if (isSharedActionBusy() || groups.length === 0) return;
  const orders = groups.flatMap(group => group.orders);
  const frozen = orders.reduce((sum, order) => sum + order.frozenMinor, 0);
  if (!confirm(
    `确认撤销选中的 ${groups.length} 项订购单？\n`
    + `剩余 ${orders.reduce((sum, order) => sum + order.remainingQuantity, 0)} 件，冻结 ${formatMoney(frozen)}。\n\n`
    + "撤单将逐笔执行；结果不明确的订单不会自动重试。"
  )) return;

  state.activeOrdersCancelling = true;
  updateAllActionStates();
  const cancelLog = document.getElementById("stch-active-orders-log");
  if (cancelLog) {
    cancelLog.innerHTML = "";
    cancelLog.style.display = "";
  }
  const succeeded = new Set();
  const failures = [];
  for (let index = 0; index < orders.length; index += 1) {
    const order = orders[index];
    setStatus(`正在撤单 ${index + 1}/${orders.length}：${order.displayName}`);
    try {
      await cancelBuyOrder(order);
      succeeded.add(order.orderId);
      appendCancelLog(`[成功] ${order.displayName} · ${formatMoney(order.unitPriceMinor)} × ${order.remainingQuantity}`, "ok");
    } catch (error) {
      failures.push({ order, message: error?.message || String(error) });
      appendCancelLog(`[失败] ${order.displayName} · ${error?.message || error}`, "err");
    }
    if (index + 1 < orders.length) {
      await new Promise(resolve => setTimeout(resolve, 450));
    }
  }

  state.activeBuyOrders = state.activeBuyOrders.filter(order => !succeeded.has(order.orderId));
  state.activeBuyOrderGroups = aggregateActiveBuyOrders(state.activeBuyOrders);
  applyCachedLowestSellPrices(state.activeBuyOrderGroups);
  const remainingKeys = new Set(state.activeBuyOrderGroups.map(group => group.key));
  state.selectedActiveBuyOrderGroups.forEach(key => {
    if (!remainingKeys.has(key)) state.selectedActiveBuyOrderGroups.delete(key);
  });
  state.activeOrdersCancelling = false;
  renderActiveBuyOrders();
  updateAllActionStates();
  if (failures.length) {
    const preview = failures.slice(0, 3).map(item => `${item.order.displayName}: ${item.message}`).join("；");
    setStatus(`撤单完成：成功 ${succeeded.size}，失败 ${failures.length}。${preview}`, "warn");
  } else {
    setStatus(`撤单完成：成功 ${succeeded.size} 笔`, "ok");
  }
}

export function initActiveBuyOrdersUi() {
  const list = document.getElementById("stch-active-orders-list");
  if (!list || list.dataset.ready === "1") return;
  list.dataset.ready = "1";
  enableCheckboxDragSelection(list, {
    checkboxSelector: ".stch-active-order-cb",
    activationSelector: ".stch-active-order-select",
  });
  document.getElementById("stch-active-orders-game")?.addEventListener("change", event => {
    state.activeOrdersGameFilter = event.currentTarget.value;
    renderActiveBuyOrders();
  });
  document.getElementById("stch-active-orders-refresh")?.addEventListener("click", () => {
    void refreshActiveBuyOrders();
  });
  document.getElementById("stch-active-orders-query-prices")?.addEventListener("click", () => {
    void querySelectedLowestSellPrices();
  });
  document.getElementById("stch-active-orders-cancel-selected")?.addEventListener("click", () => {
    const selected = state.activeBuyOrderGroups.filter(group => state.selectedActiveBuyOrderGroups.has(group.key));
    void cancelGroups(selected);
  });
  renderActiveBuyOrders();
}

export function activateActiveBuyOrdersTab() {
  initActiveBuyOrdersUi();
  if (!state.activeOrdersLoadedAt && !state.activeOrdersLoading) void refreshActiveBuyOrders();
  else renderActiveBuyOrders();
}

export function resetActiveBuyOrdersRuntime() {
  state.activeBuyOrders = [];
  state.activeBuyOrderGroups = [];
  state.selectedActiveBuyOrderGroups = new Set();
  state.activeOrdersLoading = false;
  state.activeOrdersCancelling = false;
  state.activeOrdersLoadedAt = 0;
  state.activeOrdersGameFilter = "all";
  state.activeOrderLowestPrices = new Map();
  state.activeOrdersDiagnostics = [];
}
