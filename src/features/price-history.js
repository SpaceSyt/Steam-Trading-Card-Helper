import { state } from "../state.js";

import { priceCard } from "../parsers/price.js";
import { RequestQueue } from "../request/queue.js";
import { fetchHighestBuyPrice } from "./orders.js";
import { isPriceOverviewProbeBlocked, updateAllActionStates } from "../ui/action-state.js";

import { formatMoney } from "../utils/format.js";
import {
  getMarketOverviewMetrics,
  getMarketSparklinePoints,
  groupMarketHistoryRecordsByItem,
  loadMarketHistory,
} from "../services/market-history.js";
import { persistMarketObservations } from "../services/market-observations.js";
import {
  DEFAULT_MARKET_WATCHLIST_MAX_ITEMS,
  loadMarketWatchlist,
  removeStoredMarketWatchItem,
  upsertStoredMarketWatchItem,
} from "../services/market-watchlist.js";

const MARKET_APPID = "753";
const RANGE_MS = Object.freeze({
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  all: Infinity,
});

let resizeObserver = null;
let renderFrame = 0;
let refreshGeneration = 0;
let currentRefreshQueue = null;

function getCurrencyId() {
  return Number(
    state.currencyContext?.currencyId
      ?? state.currencyContext?.id
      ?? state.cfg.currencyId
  ) || 23;
}

function setHistoryStatus(text, kind = "") {
  const element = document.getElementById("stch-history-status");
  if (!element) return;
  element.textContent = text || "";
  element.classList.toggle("err", kind === "err");
  element.classList.toggle("warn", kind === "warn");
  element.style.display = text ? "" : "none";
}

function setRefreshRunning(running) {
  const button = document.getElementById("stch-history-refresh");
  if (!button) return;
  button.textContent = running ? "停止刷新" : "刷新全部价格";
  button.classList.toggle("stch-btn-danger", running);
  const addButton = document.getElementById("stch-history-add");
  if (addButton) {
    addButton.disabled = running;
    addButton.classList.toggle("disabled", running);
  }
}

function cancelCurrentRefresh() {
  if (!currentRefreshQueue) return false;
  refreshGeneration += 1;
  currentRefreshQueue.stop();
  currentRefreshQueue = null;
  state.historyRefreshing = false;
  setRefreshRunning(false);
  updateAllActionStates();
  return true;
}

export function stopPriceHistoryRefresh(options = {}) {
  const stopped = cancelCurrentRefresh();
  if (stopped) {
    setHistoryStatus(options.silent === true ? "" : "已停止刷新", "warn");
  }
  return stopped;
}

function collectCards(results) {
  const byHashName = new Map();
  for (const info of Array.isArray(results) ? results : []) {
    for (const card of Array.isArray(info?.cards) ? info.cards : []) {
      const marketHashName = String(card?.marketHashName || "").trim();
      if (!marketHashName) continue;
      const gameName = String(info.gameName || info.appid || "未知游戏").trim();
      const cardName = String(card.name || marketHashName).trim();
      const candidate = {
        appid: MARKET_APPID,
        marketHashName,
        currencyId: getCurrencyId(),
        displayName: cardName,
        imageUrl: String(card.imageUrl || "").trim(),
        label: `${gameName}${info.isFoil ? "（闪卡）" : ""} · ${cardName}`,
      };
      const previous = byHashName.get(marketHashName);
      if (!previous || (!previous.imageUrl && candidate.imageUrl)) {
        byHashName.set(marketHashName, candidate);
      }
    }
  }
  return [...byHashName.values()]
    .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
}

function getSourceCards(source = state.historySource) {
  if (source === "scan") return collectCards(state.results);
  if (source === "order") return collectCards(state.orderResults);
  return [];
}

function chooseAvailableSource() {
  const scanCards = getSourceCards("scan");
  const orderCards = getSourceCards("order");
  if (state.historySource === "scan" && scanCards.length > 0) return "scan";
  if (state.historySource === "order" && orderCards.length > 0) return "order";
  if (state.historySource === "manual") return "manual";
  if (scanCards.length > 0) return "scan";
  if (orderCards.length > 0) return "order";
  return "manual";
}

function renderSourceControls() {
  const sourceSelect = document.getElementById("stch-history-source");
  const cardSelect = document.getElementById("stch-history-card");
  const cardLabel = document.getElementById("stch-history-card-label");
  const manualLabel = document.getElementById("stch-history-manual-label");
  if (!sourceSelect || !cardSelect) return;

  const scanCards = getSourceCards("scan");
  const orderCards = getSourceCards("order");
  sourceSelect.querySelectorAll("option").forEach(option => {
    if (option.value === "scan") {
      option.textContent = `扫描结果 (${scanCards.length})`;
      option.disabled = scanCards.length === 0;
    } else if (option.value === "order") {
      option.textContent = `订购缓存 (${orderCards.length})`;
      option.disabled = orderCards.length === 0;
    }
  });

  state.historySource = chooseAvailableSource();
  sourceSelect.value = state.historySource;
  const manual = state.historySource === "manual";
  cardLabel?.classList.toggle("stch-history-hidden", manual);
  manualLabel?.classList.toggle("stch-history-hidden", !manual);
  if (manual) return;

  const cards = state.historySource === "scan" ? scanCards : orderCards;
  cardSelect.replaceChildren();
  cards.forEach(card => {
    const option = document.createElement("option");
    option.value = card.marketHashName;
    option.textContent = card.label;
    cardSelect.appendChild(option);
  });
  if (!cards.some(card => card.marketHashName === state.historyMarketHashName)) {
    state.historyMarketHashName = cards[0]?.marketHashName || "";
  }
  cardSelect.value = state.historyMarketHashName;
}

function updateRangeControls() {
  document.querySelectorAll("#stch-tab-history [data-history-range]").forEach(button => {
    const active = button.dataset.historyRange === state.historyRange;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function getCanvasSize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  const ratio = Math.max(1, Math.min(3, Number(window.devicePixelRatio) || 1));
  const pixelWidth = Math.max(1, Math.floor(width * ratio));
  const pixelHeight = Math.max(1, Math.floor(height * ratio));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  return { width, height, ratio };
}

function drawSparkline(canvas) {
  if (!canvas?.isConnected) return;
  const points = Array.isArray(canvas._stchPoints) ? canvas._stchPoints : [];
  const { width, height, ratio } = getCanvasSize(canvas);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  if (points.length === 0) return;

  const padding = 5;
  const chartWidth = Math.max(1, width - padding * 2);
  const chartHeight = Math.max(1, height - padding * 2);
  const firstAt = points[0].observedAt;
  const lastAt = points.at(-1).observedAt;
  const timeSpan = Math.max(1, lastAt - firstAt);
  let low = Math.min(...points.map(point => point.value));
  let high = Math.max(...points.map(point => point.value));
  if (low === high) {
    const margin = Math.max(1, low * 0.05);
    low -= margin;
    high += margin;
  }
  const coords = points.map((point, index) => ({
    x: points.length === 1
      ? padding + chartWidth / 2
      : padding + ((point.observedAt - firstAt) / timeSpan) * chartWidth,
    y: padding + chartHeight - ((point.value - low) / (high - low)) * chartHeight,
    index,
  }));

  context.strokeStyle = "rgba(102, 192, 244, 0.16)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(padding, height - padding);
  context.lineTo(width - padding, height - padding);
  context.stroke();

  context.strokeStyle = "#66c0f4";
  context.lineWidth = 2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(coords[0].x, coords[0].y);
  coords.slice(1).forEach(point => context.lineTo(point.x, point.y));
  context.stroke();
  if (coords.length === 1) {
    context.fillStyle = "#66c0f4";
    context.beginPath();
    context.arc(coords[0].x, coords[0].y, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

function scheduleSparklines() {
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    document.querySelectorAll("#stch-history-list canvas.stch-history-spark")
      .forEach(drawSparkline);
  });
}

function formatCount(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value))
    ? Number(value).toLocaleString("zh-CN")
    : "—";
}

function formatChange(metrics) {
  if (!Number.isFinite(metrics.changeMinor)) return "—";
  if (metrics.changeMinor === 0) return `${formatMoney(0)} (0.00%)`;
  const sign = metrics.changeMinor > 0 ? "+" : "−";
  const percent = Number.isFinite(metrics.percentChange)
    ? ` (${metrics.percentChange > 0 ? "+" : ""}${metrics.percentChange.toFixed(2)}%)`
    : "";
  return `${sign}${formatMoney(Math.abs(metrics.changeMinor))}${percent}`;
}

function createMetric(label, value, className = "") {
  const metric = document.createElement("div");
  metric.className = `stch-history-row-metric ${className}`.trim();
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("b");
  valueNode.textContent = value;
  metric.append(labelNode, valueNode);
  return metric;
}

function createItemRow(item, records) {
  const metrics = getMarketOverviewMetrics(records, { sorted: true });
  const range = RANGE_MS[state.historyRange] ?? RANGE_MS["7d"];
  const points = getMarketSparklinePoints(records, {
    from: range === Infinity ? -Infinity : Date.now() - range,
    maxPoints: 96,
    sorted: true,
  });
  const row = document.createElement("div");
  row.className = "stch-history-row";
  row.dataset.marketHashName = item.marketHashName;

  const link = document.createElement("a");
  link.className = "stch-history-item-link";
  link.href = `https://steamcommunity.com/market/listings/${MARKET_APPID}/${encodeURIComponent(item.marketHashName)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.title = "打开 Steam 市场挂牌页";
  const thumb = document.createElement("span");
  thumb.className = "stch-history-thumb";
  const placeholder = document.createElement("span");
  placeholder.className = "stch-history-thumb-placeholder";
  placeholder.textContent = "▧";
  thumb.appendChild(placeholder);
  if (item.imageUrl) {
    const image = document.createElement("img");
    image.src = item.imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("load", () => thumb.classList.add("loaded"));
    image.addEventListener("error", () => image.remove());
    thumb.appendChild(image);
  }
  const names = document.createElement("span");
  names.className = "stch-history-item-names";
  const name = document.createElement("b");
  name.textContent = item.displayName || item.marketHashName;
  const hash = document.createElement("small");
  hash.textContent = item.marketHashName;
  names.append(name, hash);
  link.append(thumb, names);

  const chart = document.createElement("div");
  chart.className = "stch-history-spark-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "stch-history-spark";
  canvas._stchPoints = points;
  canvas.setAttribute("aria-label", `${item.displayName || item.marketHashName} 价格折线图`);
  chart.appendChild(canvas);
  if (points.length === 0) {
    const empty = document.createElement("span");
    empty.className = "stch-history-spark-empty";
    empty.textContent = "暂无价格样本";
    chart.appendChild(empty);
  }

  const stats = document.createElement("div");
  stats.className = "stch-history-row-stats";
  stats.append(
    createMetric("在售", formatCount(item.sellOrderCount)),
    createMetric("24 小时销量", formatCount(metrics.volume24h)),
    createMetric("现价", Number.isFinite(metrics.currentMinor) ? formatMoney(metrics.currentMinor) : "—"),
    createMetric(
      "较上次",
      formatChange(metrics),
      Number.isFinite(metrics.changeMinor)
        ? metrics.changeMinor > 0 ? "up" : metrics.changeMinor < 0 ? "down" : "flat"
        : ""
    )
  );
  const observedValue = metrics.observedAt ?? item.metadataObservedAt;
  const observedAt = observedValue === null || observedValue === undefined
    ? null
    : Number(observedValue);
  if (observedAt !== null && Number.isFinite(observedAt)) {
    stats.title = `最新数据：${new Date(observedAt).toLocaleString()}`;
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "stch-history-remove";
  remove.textContent = "删除";
  remove.setAttribute("aria-label", `删除 ${item.displayName || item.marketHashName}`);
  remove.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    if (state.historyRefreshing) {
      setHistoryStatus("请先停止刷新，再删除已保存物品", "warn");
      return;
    }
    const result = removeStoredMarketWatchItem(item);
    if (!result.ok) {
      setHistoryStatus("已保存物品无法更新；原有数据未被修改", "err");
      return;
    }
    setHistoryStatus(`已从总览移除：${item.displayName || item.marketHashName}`);
    renderOverview();
  });

  row.append(link, chart, stats, remove);
  return row;
}

function renderOverview() {
  updateRangeControls();
  const list = document.getElementById("stch-history-list");
  const count = document.getElementById("stch-history-count");
  if (!list) return;
  list.replaceChildren();

  const watched = loadMarketWatchlist();
  if (!watched.ok || !watched.envelope) {
    if (count) count.textContent = "已保存 — 项";
    const empty = document.createElement("div");
    empty.className = "stch-history-list-empty error";
    empty.textContent = "已保存物品无法读取；原有数据未被修改。";
    list.appendChild(empty);
    setHistoryStatus("已保存物品读取失败", "err");
    return;
  }
  const items = [...watched.envelope.items]
    .sort((left, right) => left.addedAt - right.addedAt);
  if (count) count.textContent = `已保存 ${items.length} 项`;
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stch-history-list-empty";
    empty.textContent = "还没有已保存物品。请从扫描结果、订购缓存选择，或手动输入 market_hash_name 后添加。";
    list.appendChild(empty);
    return;
  }

  const history = loadMarketHistory();
  if (!history.ok || !history.envelope) {
    setHistoryStatus("本地价格历史读取失败；物品列表仍可管理", "err");
  }
  const currencyId = getCurrencyId();
  const recordsByItem = history.ok && history.envelope
    ? groupMarketHistoryRecordsByItem(history.envelope, {
      appid: MARKET_APPID,
      currencyId,
    }, { normalized: true })
    : new Map();
  const fragment = document.createDocumentFragment();
  items.forEach(item => {
    const records = recordsByItem.get(item.marketHashName) || [];
    fragment.appendChild(createItemRow(item, records));
  });
  list.appendChild(fragment);
  scheduleSparklines();
}

function getSelectedCandidate() {
  if (state.historySource === "manual") {
    const input = document.getElementById("stch-history-manual");
    const marketHashName = String(input?.value || "").trim();
    return marketHashName ? {
      appid: MARKET_APPID,
      marketHashName,
      currencyId: getCurrencyId(),
    } : null;
  }
  const cards = getSourceCards(state.historySource);
  const selected = document.getElementById("stch-history-card")?.value
    || state.historyMarketHashName;
  return cards.find(card => card.marketHashName === selected) || null;
}

function addSelectedItem() {
  if (state.historyRefreshing) {
    setHistoryStatus("请先停止刷新，再添加已保存物品", "warn");
    return;
  }
  const candidate = getSelectedCandidate();
  if (!candidate) {
    setHistoryStatus(
      state.historySource === "manual" ? "请输入 market_hash_name" : "请选择要保存的卡牌",
      "warn"
    );
    document.getElementById("stch-history-manual")?.focus();
    return;
  }
  const watched = loadMarketWatchlist();
  if (!watched.ok || !watched.envelope) {
    setHistoryStatus("已保存物品无法读取；原有数据未被修改", "err");
    return;
  }
  const alreadySaved = watched.envelope.items.some(item => (
    item.appid === MARKET_APPID && item.marketHashName === candidate.marketHashName
  ));
  if (!alreadySaved && watched.envelope.items.length >= DEFAULT_MARKET_WATCHLIST_MAX_ITEMS) {
    setHistoryStatus(
      `已保存物品已达 ${DEFAULT_MARKET_WATCHLIST_MAX_ITEMS} 项上限，请先删除不需要的物品`,
      "warn"
    );
    return;
  }
  const result = upsertStoredMarketWatchItem({
    ...candidate,
    appid: MARKET_APPID,
    currencyId: getCurrencyId(),
  });
  if (!result.ok) {
    setHistoryStatus("已保存物品无法更新；原有数据未被修改", "err");
    return;
  }
  state.historyMarketHashName = candidate.marketHashName;
  setHistoryStatus(`已添加：${candidate.displayName || candidate.marketHashName}`);
  renderOverview();
}

function mergeMetadata(previous, next) {
  if (!next) return previous;
  return {
    displayName: next.displayName || previous?.displayName || "",
    imageUrl: next.imageUrl || previous?.imageUrl || "",
    sellOrderCount: next.sellOrderCount ?? previous?.sellOrderCount ?? null,
    observedAt: Math.max(Number(previous?.observedAt) || 0, Number(next.observedAt) || 0),
  };
}

async function refreshAllPrices() {
  if (state.historyRefreshing) return;
  if (isPriceOverviewProbeBlocked(state.historyRefreshing)) {
    setHistoryStatus("请先停止当前操作，再刷新价格", "warn");
    return;
  }
  const watched = loadMarketWatchlist();
  if (!watched.ok || !watched.envelope) {
    setHistoryStatus("已保存物品无法读取；原有数据未被修改", "err");
    return;
  }
  const items = watched.envelope.items;
  if (items.length === 0) {
    setHistoryStatus("请先添加要保存的物品", "warn");
    return;
  }

  state.historyRefreshing = true;
  const generation = ++refreshGeneration;
  setRefreshRunning(true);
  updateAllActionStates();
  const queue = new RequestQueue(
    state.cfg.requestInterval,
    state.cfg.batchSize,
    state.cfg.batchPause,
    state,
    text => setHistoryStatus(text || "正在刷新全部价格"),
    null,
    { stopPredicate: () => false }
  );
  currentRefreshQueue = queue;
  const observations = [];
  let partialCount = 0;
  let metadataFailed = false;
  let observationsFlushed = false;
  const flushObservations = () => {
    observationsFlushed = true;
    return persistMarketObservations(observations);
  };

  try {
    for (let index = 0; index < items.length; index += 1) {
      if (generation !== refreshGeneration) break;
      const item = items[index];
      setHistoryStatus(`正在刷新 ${index + 1}/${items.length}：${item.displayName || item.marketHashName}`);
      const overview = await priceCard(item.marketHashName, queue, {
        appid: MARKET_APPID,
        currencyId: getCurrencyId(),
        persistMarketCache: false,
      });
      if (overview?.record) observations.push(overview.record);
      if (generation !== refreshGeneration) break;
      let metadata = null;
      try {
        await fetchHighestBuyPrice(item.marketHashName, queue, {
          persistMarketCache: false,
          onRecord: record => { if (record) observations.push(record); },
          onMetadata: value => { metadata = mergeMetadata(metadata, value); },
        });
      } catch (_) {
        // The listing metadata callback may still have supplied a sell count.
      }
      if (generation !== refreshGeneration) break;
      const refreshedPrice = Number.isFinite(Number(overview?.record?.lowestSellMinor))
        && Number(overview.record.lowestSellMinor) > 0;
      const refreshedVolume = overview?.record?.volume !== null
        && overview?.record?.volume !== undefined
        && Number.isFinite(Number(overview.record.volume));
      const refreshedSellCount = metadata?.sellOrderCount !== null
        && metadata?.sellOrderCount !== undefined
        && Number.isFinite(Number(metadata.sellOrderCount));
      if (!refreshedPrice || !refreshedVolume || !refreshedSellCount) partialCount += 1;
      if (metadata) {
        const updated = upsertStoredMarketWatchItem({
          ...item,
          displayName: metadata.displayName || item.displayName,
          imageUrl: metadata.imageUrl || item.imageUrl,
          sellOrderCount: metadata.sellOrderCount,
          metadataObservedAt: metadata.observedAt,
          currencyId: getCurrencyId(),
        });
        if (!updated.ok) metadataFailed = true;
      }
    }
    const persistence = flushObservations();
    renderOverview();
    if (generation !== refreshGeneration) return;
    if (!persistence.ok || metadataFailed) {
      setHistoryStatus("价格已读取，但部分本地数据保存失败；损坏的存储未被覆盖", "err");
    } else if (partialCount > 0) {
      setHistoryStatus(`刷新完成；${partialCount} 项缺少现价、销量或在售数量`, "warn");
    } else {
      setHistoryStatus(`刷新完成：${items.length} 项`);
    }
  } catch (error) {
    if (generation === refreshGeneration) {
      setHistoryStatus(error?.message || "刷新价格失败", "err");
    }
  } finally {
    if (!observationsFlushed && observations.length > 0) {
      const persistence = flushObservations();
      renderOverview();
      if (generation === refreshGeneration && !persistence.ok) {
        setHistoryStatus("已完成的价格已读取，但部分本地数据保存失败", "err");
      }
    }
    queue.stop();
    if (currentRefreshQueue === queue) currentRefreshQueue = null;
    if (generation === refreshGeneration) {
      state.historyRefreshing = false;
      setRefreshRunning(false);
      updateAllActionStates();
    }
  }
}

export function initPriceHistoryUi() {
  const root = document.getElementById("stch-tab-history");
  if (!root || root.dataset.ready === "1") return;
  root.dataset.ready = "1";

  document.getElementById("stch-history-source")?.addEventListener("change", event => {
    state.historySource = event.currentTarget.value;
    state.historyMarketHashName = "";
    setHistoryStatus("");
    renderSourceControls();
  });
  document.getElementById("stch-history-card")?.addEventListener("change", event => {
    state.historyMarketHashName = event.currentTarget.value;
  });
  document.getElementById("stch-history-add")?.addEventListener("click", addSelectedItem);
  document.getElementById("stch-history-manual")?.addEventListener("keydown", event => {
    if (event.key === "Enter") addSelectedItem();
  });
  document.getElementById("stch-history-refresh")?.addEventListener("click", event => {
    if (state.historyRefreshing) {
      stopPriceHistoryRefresh();
      return;
    }
    if (!event.currentTarget.classList.contains("disabled")) void refreshAllPrices();
  });
  root.querySelectorAll("[data-history-range]").forEach(button => {
    button.addEventListener("click", () => {
      state.historyRange = button.dataset.historyRange;
      renderOverview();
    });
  });

  resizeObserver?.disconnect();
  const list = document.getElementById("stch-history-list");
  if (list && typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      if (root.classList.contains("active")) scheduleSparklines();
    });
    resizeObserver.observe(list);
  }
}

export function activatePriceHistoryTab() {
  initPriceHistoryUi();
  renderSourceControls();
  updateRangeControls();
  renderOverview();
}

export function resetPriceHistoryRuntime() {
  refreshGeneration += 1;
  currentRefreshQueue?.stop();
  currentRefreshQueue = null;
  state.historySource = "scan";
  state.historyMarketHashName = "";
  state.historyRange = "7d";
  state.historyRefreshing = false;
  if (renderFrame) cancelAnimationFrame(renderFrame);
  renderFrame = 0;
}
