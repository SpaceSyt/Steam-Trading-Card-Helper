import { marketFetch } from "../request/http.js";
import { state } from "../state.js";
import { createLongTermBuyOrder, getBuyOrderSession } from "./orders.js";
import { showConfirmation } from "../ui/confirmation.js";
import { RequestQueue } from "../request/queue.js";
import {
  aggregateActiveBuyOrders,
  isCancelBuyOrderResponseSuccessful,
} from "../services/active-buy-orders.js";
import { calculateAutomaticBuyPrice } from "../services/order-wall.js";
import { getActiveOrderPricingProfile } from "../config.js";
import {
  fetchActiveBuyOrderSnapshot,
  getOrderCurrencyContext,
} from "../services/market-orders.js";
import { formatMoney } from "../utils/format.js";
import { getMarketMinimumPriceCents, getSessionId } from "../utils/steam.js";
import { enableCheckboxDragSelection } from "../ui/checkbox-drag.js";
import {
  isIndependentProbeBlocked,
  isPriceOverviewProbeBlocked,
  isSharedActionBusy,
  updateAllActionStates,
} from "../ui/action-state.js";
import {
  isPriceCardError,
  isPriceCardNoPrice,
  isPriceCardPriced,
  priceCard,
} from "../parsers/price.js";
import { persistMarketObservations } from "../services/market-observations.js";
import {
  createRequestQueuePool,
  getHtmlRequestConcurrency,
  runWithConcurrency,
} from "../utils/concurrency.js";
import { setStatusText } from "../utils/dom.js";

const LOWEST_SELL_CACHE_TTL_MS = 10 * 60 * 1000;

function createElement(tag, className = "", text = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function setStatus(text, type = "") {
  setStatusText("stch-active-orders-status", text, type);
}

function appendCancelLog(text, type = "") {
  const log = document.getElementById("stch-active-orders-log");
  if (!log) return;
  log.style.display = "";
  const line = createElement("div", type, text);
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

function getSmartPricingContext() {
  try {
    const currencyContext = getOrderCurrencyContext();
    const minimumPriceMinor = getMarketMinimumPriceCents(currencyContext);
    if (
      !Number.isInteger(currencyContext?.currencyId)
      || !Number.isSafeInteger(minimumPriceMinor)
      || minimumPriceMinor <= 0
    ) return null;
    const profile = getActiveOrderPricingProfile({
      ...state.cfg,
      automaticPricingEnabled: true,
    }, state.cfg.automaticPricingEnabled ? state.automaticPricingDraft : null);
    const adjustment = Number(profile.adjustment);
    return {
      currencyId: currencyContext.currencyId,
      minimumPriceMinor,
      strategy: profile.priceSource,
      strategyRule: profile.strategyRule,
      adjustmentMinor: Math.round((Number.isFinite(adjustment) ? adjustment : 0) * 100),
    };
  } catch (_) {
    return null;
  }
}

function smartPriceDelta(group) {
  return group.suggestedMinor * group.remainingQuantity - group.frozenMinor;
}

function updateSmartCell(group) {
  const cell = group._smartCell;
  const price = group.suggestedMinor;
  if (price) {
    const delta = smartPriceDelta(group);
    cell.className = "stch-active-order-smart" + (delta < 0 ? " saving" : delta > 0 ? " increase" : "");
    cell.textContent = (delta < 0 ? "↓ " : delta > 0 ? "↑ " : "") + formatMoney(price, group.quoteCurrencyId);
  } else {
    cell.className = "stch-active-order-smart unavailable";
    cell.textContent = group.lowestSellState === "loading" ? "查询中" : price === null ? "无可用买价" : "—";
  }
}

function getVisibleGroups() {
  if (state.activeOrdersGameFilter === "all") return state.activeBuyOrderGroups;
  return state.activeBuyOrderGroups.filter(group => (
    (group.gameName || `App ${group.appid}`) === state.activeOrdersGameFilter
  ));
}

function selectVisibleOrders(matches) {
  if (isSharedActionBusy()) return;
  const visible = getVisibleGroups();
  for (const group of visible) {
    const selected = matches(group);
    if (selected) state.selectedActiveBuyOrderGroups.add(group.key);
    else state.selectedActiveBuyOrderGroups.delete(group.key);
    const row = group._smartCell?.parentElement;
    if (row) {
      row.querySelector(".stch-active-order-cb").checked = selected;
      row.classList.toggle("selected", selected);
    }
  }
  updateSummary(visible);
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
  let selectedCount = 0;
  for (const group of visibleGroups) {
    if (state.selectedActiveBuyOrderGroups.has(group.key)) selectedCount++;
  }
  checkbox.checked = visibleGroups.length > 0 && selectedCount === visibleGroups.length;
  checkbox.indeterminate = selectedCount > 0 && selectedCount < visibleGroups.length;
  checkbox.disabled = isSharedActionBusy() || visibleGroups.length === 0;
  const disabled = checkbox.disabled || !visibleGroups.some(group => group.suggestedMinor);
  for (const id of ["overpriced", "underpriced"]) {
    const button = document.getElementById("stch-active-orders-" + id);
    if (button) {
      button.disabled = disabled;
      button.classList.toggle("disabled", disabled);
    }
  }
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
  const fragment = document.createDocumentFragment();
  const all = document.createElement("option");
  all.value = "all";
  all.textContent = `全部游戏 (${games.length})`;
  fragment.appendChild(all);
  games.forEach(game => {
    const option = document.createElement("option");
    option.value = game;
    option.textContent = game;
    fragment.appendChild(option);
  });
  select.replaceChildren(fragment);
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

function updateLowestSellCell(group) {
  const cell = group._lowestSellCell;
  if (!cell?.isConnected) return;
  cell.className = `stch-active-order-value stch-active-order-lowest ${group.lowestSellState || "idle"}`;
  cell.textContent = lowestSellLabel(group);
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

let summaryFrame = 0;
let imageObserver = null;
function scheduleSummaryUpdate() {
  if (summaryFrame) return;
  summaryFrame = requestAnimationFrame(() => {
    summaryFrame = 0;
    updateSummary();
  });
}

function observeImage(image, list) {
  const load = () => {
    image.src = image.dataset.src;
    delete image.dataset.src;
  };
  if (!("IntersectionObserver" in window)) {
    image.loading = "lazy";
    load();
    return;
  }
  imageObserver ||= new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      imageObserver.unobserve(entry.target);
      entry.target.src = entry.target.dataset.src;
      delete entry.target.dataset.src;
    });
  }, { root: list });
  imageObserver.observe(image);
}

function getCachedCardImages() {
  const images = new Map();
  [state.results, state.orderResults].forEach(results => results.forEach(info => {
    info.cards.forEach(card => {
      if (card.marketHashName && card.imageUrl && !images.has(card.marketHashName)) {
        images.set(card.marketHashName, card.imageUrl);
      }
    });
  }));
  return images;
}

function renderOrderRow(group, imageUrl) {
  const row = createElement("div", "stch-active-order-row");
  row.dataset.groupKey = group.key;
  row.classList.toggle("selected", state.selectedActiveBuyOrderGroups.has(group.key));

  const item = createElement("a", "stch-active-order-item");
  item.href = group.listingUrl;
  item.target = "_blank";
  item.rel = "noopener noreferrer";
  if (imageUrl) {
    const image = createElement("img", "stch-active-order-image");
    image.dataset.src = imageUrl;
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
  group._lowestSellCell = lowest;
  row.appendChild(lowest);

  const quantity = createElement("div", "stch-active-order-metric");
  quantity.appendChild(createElement(
    "span",
    "stch-active-order-value",
    String(group.remainingQuantity)
  ));
  row.appendChild(quantity);

  const frozen = createElement("div", "stch-active-order-metric");
  frozen.appendChild(createElement("span", "stch-active-order-value", formatMoney(group.frozenMinor)));
  row.appendChild(frozen);

  group._smartCell = createElement("div");
  updateSmartCell(group);
  row.appendChild(group._smartCell);

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
    scheduleSummaryUpdate();
  });
  return row;
}

export function renderActiveBuyOrders() {
  const list = document.getElementById("stch-active-orders-list");
  if (!list) return updateAllActionStates();
  imageObserver?.disconnect();
  imageObserver = null;
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
    fragment.appendChild(header);
    const cachedCardImages = getCachedCardImages();
    let previousGame = null;
    visible.forEach(group => {
      const game = group.gameName || `App ${group.appid}`;
      if (game !== previousGame) {
        fragment.appendChild(createElement("div", "stch-active-order-game-separator", game));
        previousGame = game;
      }
      fragment.appendChild(renderOrderRow(
        group,
        cachedCardImages.get(group.marketHashName) || group.imageUrl
      ));
    });
    list.appendChild(fragment);
    list.querySelectorAll(".stch-active-order-image[data-src]")
      .forEach(image => observeImage(image, list));
  }
  updateSummary(visible);
}

function applyActiveBuyOrderSnapshot(snapshot) {
  state.activeBuyOrders = snapshot.orders;
  state.activeBuyOrderGroups = aggregateActiveBuyOrders(snapshot.orders);
  applyCachedLowestSellPrices(state.activeBuyOrderGroups);
  state.activeOrdersLoadedAt = snapshot.observedAt;
  const keys = new Set(state.activeBuyOrderGroups.map(group => group.key));
  state.selectedActiveBuyOrderGroups.forEach(key => {
    if (!keys.has(key)) state.selectedActiveBuyOrderGroups.delete(key);
  });
}

export async function refreshActiveBuyOrders() {
  if (isIndependentProbeBlocked(
    state.activeOrdersLoading || state.activeOrderPriceQueryRunning
  )) return;
  state.activeOrdersLoading = true;
  updateAllActionStates();
  setStatus("正在读取 Steam 市场订购单…");
  const queue = new RequestQueue(
    state.cfg.requestInterval,
    state,
    null,
    null,
    { stopPredicate: () => false }
  );
  try {
    const snapshot = await fetchActiveBuyOrderSnapshot(queue);
    applyActiveBuyOrderSnapshot(snapshot);
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
    renderActiveBuyOrders();
  }
}

export async function querySelectedOrderPrices() {
  if (isPriceOverviewProbeBlocked(
    state.activeOrdersLoading || state.activeOrderPriceQueryRunning
  )) return;
  const groups = state.activeBuyOrderGroups.filter(group => (
    state.selectedActiveBuyOrderGroups.has(group.key)
  ));
  if (groups.length === 0) return;

  state.activeOrderPriceQueryRunning = true;
  function updatePriceCells(group) {
    updateLowestSellCell(group);
    if (group._smartCell?.isConnected) updateSmartCell(group);
  }
  groups.forEach(group => {
    group.lowestSellState = "loading";
    group.lowestSellMinor = null;
    group.suggestedMinor = null;
    group.quoteCurrencyId = null;
    state.activeOrderLowestPrices.delete(group.key);
    updatePriceCells(group);
  });
  updateHeaderSelectionState();
  updateAllActionStates();
  const queue = createRequestQueuePool(
    getHtmlRequestConcurrency(state.cfg),
    () => new RequestQueue(
      state.cfg.requestInterval,
      state,
      text => setStatus(text || "正在查价"),
      null,
      { stopPredicate: () => false }
    )
  );
  let found = 0;
  let quotes = 0;
  setStatus("正在查价");
  const observations = [];
  try {
    const currencyId = getOrderCurrencyContext().currencyId;
    const pricing = getSmartPricingContext();
    let completed = 0;
    await runWithConcurrency(groups, getHtmlRequestConcurrency(state.cfg), async group => {
      const result = await priceCard(group.marketHashName, queue, {
        appid: group.appid,
        currencyId,
        includeBuyDepth: Boolean(pricing),
        persistMarketCache: false,
      });
      if (result?.record) observations.push(result.record);
      if (pricing && result.buyDepth?.currencyId === pricing.currencyId) {
        group.suggestedMinor = calculateAutomaticBuyPrice(result.buyDepth, pricing)?.finalPriceMinor ?? null;
        if (group.suggestedMinor) {
          group.quoteCurrencyId = pricing.currencyId;
          quotes++;
        }
      }
      const lowest = Number(result?.record?.lowestSellMinor);
      if (isPriceCardPriced(result) && Number.isSafeInteger(lowest) && lowest > 0) {
        group.lowestSellMinor = lowest;
        group.lowestSellState = "ready";
        state.activeOrderLowestPrices.set(group.key, {
          lowestSellMinor: lowest,
          currencyId,
          fetchedAt: Date.now(),
        });
        found += 1;
      } else {
        group.lowestSellMinor = null;
        group.lowestSellState = isPriceCardNoPrice(result) || !isPriceCardError(result)
          ? "missing"
          : "failed";
      }
      updatePriceCells(group);
      completed++;
      setStatus(`正在查价 ${completed}/${groups.length}`);
    });
    setStatus(
      `查价完成：智能买价 ${quotes}/${groups.length} 项，最低售价 ${found}/${groups.length} 项`,
      quotes < groups.length || found < groups.length ? "warn" : "ok"
    );
  } catch (error) {
    setStatus(`查价中断：${error?.message || error}`, "err");
  } finally {
    queue.stop();
    if (observations.length > 0) persistMarketObservations(observations);
    groups.forEach(group => {
      if (group.lowestSellState === "loading") {
        group.lowestSellState = "failed";
        updatePriceCells(group);
      }
    });
    state.activeOrderPriceQueryRunning = false;
    updateHeaderSelectionState();
    updateAllActionStates();
  }
}

async function cancelBuyOrder(order) {
  const sessionid = getSessionId();
  if (!sessionid) throw new Error("未找到 Steam sessionid");
  const response = await marketFetch("https://steamcommunity.com/market/cancelbuyorder/", {
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

async function getCancelledOrderQuantity(order, sessionId) {
  const params = new URLSearchParams({ sessionid: sessionId, buy_orderid: order.orderId });
  const response = await marketFetch(`https://steamcommunity.com/market/getbuyorderstatus/?${params}`, {
    credentials: "include",
    cache: "no-store",
  });
  const data = await response.json();
  const quantity = Number(data?.quantity_remaining);
  if (!response.ok || data?.success !== 1 || ![0, false, "0"].includes(data.active)
    || !/^\d+$/.test(String(data.quantity_remaining)) || !Number.isSafeInteger(quantity)
    || quantity > order.remainingQuantity) {
    throw new Error(`无法确认订单 ${order.orderId} 撤销后的剩余数量`);
  }
  return quantity;
}

export async function relistSelectedBuyOrders() {
  if (isSharedActionBusy()) return;
  const selected = state.activeBuyOrderGroups.filter(group => state.selectedActiveBuyOrderGroups.has(group.key));
  const groups = selected.filter(group => group.suggestedMinor);
  if (!groups.length) return;
  const skipped = selected.length - groups.length;

  state.activeOrdersCancelling = true;
  updateAllActionStates();
  let changed = false;
  let completed = 0;
  let failure = "";
  try {
    const sessionId = getBuyOrderSession();
    const currencyId = getOrderCurrencyContext().currencyId;
    if (groups.some(group => group.quoteCurrencyId !== currencyId)) throw new Error("钱包币种已改变，请重新查价");
    const total = groups.reduce((sum, group) => sum + group.suggestedMinor * group.remainingQuantity, 0);
    const confirmed = await showConfirmation({
      title: "重挂选中订购单",
      summaryHtml: `${groups.length} 项 · ${formatMoney(total)}`
        + (skipped ? ` · 已跳过 ${skipped} 项无可用买价` : ""),
      note: "将撤销原单，再按所示单价重挂未成交数量。撤单后可能无法重新下单。",
      confirmLabel: "重挂选中",
    }, list => {
      for (const group of groups) {
        const row = createElement("div", "stch-order-item");
        row.append(createElement("span", "", group.displayName),
          createElement("span", "", `× ${group.remainingQuantity}`),
          createElement("span", "stch-order-price-basis", `${priceLabel(group)} → ${formatMoney(group.suggestedMinor)}`),
          createElement("span", "", formatMoney(group.suggestedMinor * group.remainingQuantity)));
        list.appendChild(row);
      }
    });
    if (!confirmed) return;

    const log = document.getElementById("stch-active-orders-log");
    log?.replaceChildren();
    const snapshot = await fetchActiveBuyOrderSnapshot();
    const current = new Map(aggregateActiveBuyOrders(snapshot.orders).map(group => [group.key, group]));
    for (const group of groups) {
      const live = current.get(group.key);
      const ambiguous = snapshot.diagnostics.some(row => group.orders.some(order => order.orderId === row.orderId)
        || (row.appid === group.appid && row.marketHashName === group.marketHashName));
      if (ambiguous || live?.orderCount !== group.orderCount || group.orders.some(order =>
        !live.orders.some(other => other.orderId === order.orderId && other.remainingQuantity === order.remainingQuantity
          && other.unitPriceMinor === order.unitPriceMinor)
      )) {
        applyActiveBuyOrderSnapshot(snapshot);
        throw new Error("订购单已变动或无法核对，请刷新后重新查价");
      }
    }

    for (const group of groups) {
      const { displayName, marketHashName, suggestedMinor } = group;
      let quantity = 0;
      setStatus(`正在重挂 ${completed + 1}/${groups.length}：${displayName}`);
      for (const order of group.orders) {
        if (getBuyOrderSession() !== sessionId || getOrderCurrencyContext().currencyId !== currencyId) {
          throw new Error("Steam 会话或币种已改变");
        }
        changed = true;
        try {
          await cancelBuyOrder(order);
        } catch (error) {
          throw new Error(`${displayName} · 撤单结果未确认（${order.orderId}）：${error.message}`);
        }
        appendCancelLog(`已撤销 ${displayName} · ${order.orderId}`, "ok");
        quantity += await getCancelledOrderQuantity(order, sessionId);
      }
      if (quantity > 0) {
        if (getBuyOrderSession() !== sessionId) throw new Error("Steam 会话或币种已改变");
        try {
          await createLongTermBuyOrder({
            marketAppid: group.appid, marketHashName, cardName: displayName, currencyId,
            quantity, totalPriceCents: suggestedMinor * quantity,
          }, { setStatus, log: appendCancelLog });
        } catch (error) {
          throw new Error(`${displayName} · 原单已撤销，新单未确认：${error.message}`);
        }
      }
      appendCancelLog(`${displayName} · ${formatMoney(suggestedMinor)} × ${quantity}`, "ok");
      completed++;
    }
  } catch (error) {
    failure = error?.message || String(error);
    appendCancelLog(failure, "err");
  } finally {
    if (changed) {
      try {
        applyActiveBuyOrderSnapshot(await fetchActiveBuyOrderSnapshot());
      } catch (error) {
        applyActiveBuyOrderSnapshot({ orders: [], observedAt: 0 });
        const refreshError = `读取失败：${error?.message || error}`;
        appendCancelLog(refreshError, "err");
        failure ||= refreshError;
      }
    }
    state.activeOrdersCancelling = false;
    renderActiveBuyOrders();
    if (failure) setStatus(`重挂停止（已完成 ${completed}/${groups.length}）：${failure}`, "err");
    else if (changed) setStatus(`重挂完成：${completed} 项`, "ok");
  }
}

async function cancelGroups(groups) {
  if (isSharedActionBusy() || groups.length === 0) return;
  const orders = groups.flatMap(group => group.orders);
  const frozen = orders.reduce((sum, order) => sum + order.frozenMinor, 0);
  const remaining = orders.reduce((sum, order) => sum + order.remainingQuantity, 0);
  if (!confirm(`撤销 ${groups.length} 项（${remaining} 件，冻结 ${formatMoney(frozen)}）？`)) return;

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
  document.getElementById("stch-active-orders-select-all")?.addEventListener("change", event => {
    const checked = event.currentTarget.checked;
    selectVisibleOrders(() => checked);
  });
  for (const [id, direction] of [["overpriced", -1], ["underpriced", 1]]) {
    document.getElementById("stch-active-orders-" + id)?.addEventListener("click", () => {
      selectVisibleOrders(group => Boolean(group.suggestedMinor) && direction * smartPriceDelta(group) > 0);
    });
  }
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
    void querySelectedOrderPrices();
  });
  document.getElementById("stch-active-orders-relist")?.addEventListener("click", () => {
    void relistSelectedBuyOrders();
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
  state.activeOrderPriceQueryRunning = false;
  state.activeOrdersCancelling = false;
  state.activeOrdersLoadedAt = 0;
  state.activeOrdersGameFilter = "all";
  state.activeOrderLowestPrices = new Map();
}
