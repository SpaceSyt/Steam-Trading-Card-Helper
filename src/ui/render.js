import { state } from "../state.js";

import { createTextSpan, createCheckboxHit } from "../utils/dom.js";

import { getProfileUrl, getMarketMinimumPriceCents } from "../utils/steam.js";

import { formatMoney } from "../utils/format.js";

import { getBadgeTargetLevel, getBadgeUrlSuffix } from "../utils/badge.js";

import { getResultKey, getSelectedOrderResults } from "../services/result-info.js";

import { pruneOrderCache, upsertOrderResult, getOrderCacheAgeDays } from "../services/order-cache.js";

import { openMultibuy } from "../features/multibuy.js";

import { updateBulkActionState, updateOrderActionState } from "./action-state.js";

import { updateResultColumns } from "../features/scan.js";
import { getActiveOrderPricingProfile } from "../config.js";
import { calculateAutomaticBuyPrice } from "../services/order-wall.js";
import { calculateResultPricingTotals } from "../services/pricing-estimate.js";
import { enableCheckboxDragSelection } from "./checkbox-drag.js";

  const pendingSelectionUpdates = new Set();
  let selectionUpdateFrame = 0;

  function scheduleSelectionUpdate(source) {
    pendingSelectionUpdates.add(source);
    if (selectionUpdateFrame) return;
    selectionUpdateFrame = requestAnimationFrame(() => {
      selectionUpdateFrame = 0;
      if (pendingSelectionUpdates.has("order")) {
        updateOrderSummary({ prune: false });
        updateOrderActionState();
      }
      if (pendingSelectionUpdates.has("scan")) updateBulkActionState();
      pendingSelectionUpdates.clear();
    });
  }

  function enableResultDragSelection(list) {
    enableCheckboxDragSelection(list, {
      checkboxSelector: ".stch-result-cb",
      activationSelector: ".stch-result-cb, .stch-check-hit, .stch-check",
      rowSelector: ".stch-game-row",
      excludeSelector: "[id$='select-all']",
    });
  }

  export function setSummary(html) {
    const el = document.getElementById("stch-summary");
    if (el) el.innerHTML = html;
  }

  export function setSummaryVisibility(visible) {
    const row = document.getElementById("stch-summary-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  export function getResultSourceState(source = "scan") {
    if (source === "order") {
      return {
        results: state.orderResults,
        selected: state.selectedOrderResults,
        sortKey: state.orderSortKey,
        sortAsc: state.orderSortAsc,
        render: renderOrderResults,
        selectAllId: "stch-order-select-all",
      };
    }
    return {
      results: state.results,
      selected: state.selectedResults,
      sortKey: state.sortKey,
      sortAsc: state.sortAsc,
      render: renderResults,
      selectAllId: "stch-result-select-all",
    };
  }

  export function sortArrow(key, source = "scan") {
    const sourceState = getResultSourceState(source);
    if (sourceState.sortKey !== key) return "";
    return sourceState.sortAsc ? " ▲" : " ▼";
  }

  export function renderHeader(list, options = {}) {
    const source = options.source || "scan";
    const sourceState = getResultSourceState(source);
    const cacheHeader = options.showCacheAge
      ? `<span class="stch-order-cache-age stch-sortable" data-sort="cached">天数<span class="stch-sort-arrow">${sortArrow("cached", source)}</span></span>`
      : "";
    const hdr = document.createElement("div");
    hdr.className = "stch-game-row stch-row-header";
    hdr.innerHTML = `
      <span class="stch-appid stch-sortable" data-sort="appid">游戏ID<span class="stch-sort-arrow">${sortArrow("appid", source)}</span></span>
      <span class="stch-name stch-sortable" data-sort="name">游戏名<span class="stch-sort-arrow">${sortArrow("name", source)}</span></span>
      <span class="stch-level stch-sortable" data-sort="level">等级<span class="stch-sort-arrow">${sortArrow("level", source)}</span></span>
      <span class="stch-cards stch-sortable" data-sort="cards">卡牌<span class="stch-sort-arrow">${sortArrow("cards", source)}</span></span>
      <span class="stch-cost stch-sortable" data-sort="cost">单套补全<span class="stch-sort-arrow">${sortArrow("cost", source)}</span></span>
      <span class="stch-full stch-sortable" data-sort="full">单套在售<span class="stch-sort-arrow">${sortArrow("full", source)}</span></span>
      <span class="stch-lv5 stch-sortable" data-sort="lv5">满级估算 <span class="stch-sort-arrow">${sortArrow("lv5", source)}</span><span style="cursor:help;color:#8f98a0;font-size:11px;" title="绿色:近期成交>1，参考性较强&#10;黄色:近期成交=1，参考性不强&#10;红色:近期成交=0，参考性较弱&#10;灰色:信息不全；缺价时显示 -">?</span></span>
      <span class="stch-drops stch-sortable" data-sort="drops">掉落<span class="stch-sort-arrow">${sortArrow("drops", source)}</span></span>
      ${cacheHeader}
      <span class="stch-buy">手动购买</span>
      <span class="stch-check"><span class="stch-check-hit"><input id="${sourceState.selectAllId}" class="stch-result-cb" type="checkbox" title="全选"></span></span>
    `;
    hdr.querySelectorAll(".stch-sortable").forEach(sp => {
      sp.addEventListener("click", () => {
        if (source === "order") sortAndRenderOrder(sp.dataset.sort);
        else sortAndRender(sp.dataset.sort);
      });
    });
    const selectAll = hdr.querySelector(`#${sourceState.selectAllId}`);
    const selectAllCell = selectAll.closest(".stch-check");
    const applySelectAll = checked => {
      if (checked) {
        sourceState.results.forEach(info => sourceState.selected.add(getResultKey(info)));
      } else {
        sourceState.selected.clear();
      }
      sourceState.render();
    };
    selectAll.addEventListener("click", e => {
      e.stopPropagation();
      applySelectAll(selectAll.checked);
    });
    selectAllCell.addEventListener("click", e => {
      e.stopPropagation();
      if (e.target === selectAll) return;
      selectAll.checked = !selectAll.checked;
      applySelectAll(selectAll.checked);
    });
    list.appendChild(hdr);
  }

  export function getSortedGameResults(results, sortKey, sortAsc) {
    const sorted = [...results];
    if (!sortKey) return sorted;
    return sorted.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case "appid": va = +a.appid; vb = +b.appid; break;
        case "name": va = a.gameName || ""; vb = b.gameName || ""; break;
        case "level": va = a.level; vb = b.level; break;
        case "cards": va = a.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0);
                      vb = b.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0); break;
        case "cost": va = a.hasIncompletePricing ? null : a.cheapestSetCostCents; vb = b.hasIncompletePricing ? null : b.cheapestSetCostCents; break;
        case "full": va = a.hasIncompletePricing ? null : a.fullSetCostCents; vb = b.hasIncompletePricing ? null : b.fullSetCostCents; break;
        case "lv5": va = a.hasIncompletePricing ? null : a.level5CostCents; vb = b.hasIncompletePricing ? null : b.level5CostCents; break;
        case "drops": va = a.dropsRemaining; vb = b.dropsRemaining; break;
        case "cached": va = a.cachedAt || 0; vb = b.cachedAt || 0; break;
        default: return 0;
      }
      if (typeof va === "string") {
        const cmp = va.localeCompare(vb, "zh");
        return sortAsc ? cmp : -cmp;
      }
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return sortAsc ? va - vb : vb - va;
    });
  }

  export function getSortedResults() {
    return getSortedGameResults(state.results, state.sortKey, state.sortAsc);
  }

  export function getSortedOrderResults() {
    return getSortedGameResults(state.orderResults, state.orderSortKey, state.orderSortAsc);
  }

  export function renderResults() {
    const list = document.getElementById("stch-list");
    if (!list) return;
    enableResultDragSelection(list);
    list.innerHTML = "";
    if (state.results.length === 0) {
      updateBulkActionState();
      updateResultColumns();
      return;
    }
    const fragment = document.createDocumentFragment();
    renderHeader(fragment);
    const sorted = getSortedResults();
    sorted.forEach(info => renderDataRow(fragment, info));
    list.appendChild(fragment);
    updateBulkActionState();
    updateResultColumns();
  }

  export function renderOrderResults() {
    const list = document.getElementById("stch-order-list");
    if (!list) return;
    enableResultDragSelection(list);
    pruneOrderCache(true);
    list.innerHTML = "";
    const fragment = document.createDocumentFragment();
    if (state.orderResults.length === 0) {
      const row = document.createElement("div");
      row.className = "stch-game-row";
      const text = createTextSpan("", "订购卡牌缓存为空。价格扫描结果会实时进入这里，也可以手动输入 AppID。");
      text.style.color = "#8f98a0";
      row.appendChild(text);
      fragment.appendChild(row);
      list.appendChild(fragment);
      setOrderSummaryVisibility(false);
      updateOrderActionState();
      updateOrderResultColumns();
      return;
    }
    renderHeader(fragment, { source: "order", showCacheAge: true });
    getSortedOrderResults().forEach(info => {
      renderDataRow(fragment, info, { source: "order", showCacheAge: true });
    });
    list.appendChild(fragment);
    updateOrderSummary({ prune: false });
    setOrderSummaryVisibility(true);
    updateOrderActionState();
    updateOrderResultColumns();
  }

  export function sortAndRender(key) {
    if (state.sortKey === key) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = key;
      state.sortAsc = true;
    }
    renderResults();
  }

  export function sortAndRenderOrder(key) {
    if (state.orderSortKey === key) {
      state.orderSortAsc = !state.orderSortAsc;
    } else {
      state.orderSortKey = key;
      state.orderSortAsc = key === "cached" ? false : true;
    }
    renderOrderResults();
  }

  export function renderDataRow(list, info, options = {}) {
    const source = options.source || "scan";
    const sourceState = getResultSourceState(source);
    const row = document.createElement("div");
    row.className = "stch-game-row";
    row.dataset.appid = info.appid;
    row.dataset.foil = info.isFoil ? 1 : 0;
    const targetLevel = getBadgeTargetLevel(info);
    const ownedCards = info.cards.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const minVol = info.minVolume || 0;
    const lv5Color = info.hasIncompletePricing || info.hasEstimated ? "color:#888" : minVol > 1 ? "color:#4caf50" : minVol === 1 ? "color:#c9a02c" : "";
    const lv5Title = info.hasIncompletePricing
      ? "价格请求不完整"
      : info.hasEstimated
      ? "信息不全，采用估计"
      : minVol > 1
        ? "近期成交>1，参考性较强"
        : minVol === 1
          ? "近期成交=1，参考性不强"
          : "近期成交=0，参考性较弱";
    row.appendChild(createTextSpan("stch-appid", `${info.appid}${info.isFoil ? "(箔)" : ""}`));
    row.appendChild(createTextSpan("stch-name", info.gameName || "(未知)"));
    row.appendChild(createTextSpan("stch-level", `Lv${info.level}/${targetLevel}`));
    row.appendChild(createTextSpan("stch-cards", `${ownedCards}/${info.totalInSet}`));
    const displayedCompletion = info.hasIncompletePricing ? "-" : formatMoney(info.cheapestSetCostCents);
    const displayedFull = info.hasIncompletePricing ? "-" : formatMoney(info.fullSetCostCents);
    const displayedLevel = info.hasIncompletePricing ? "-" : formatMoney(info.level5CostCents);
    row.appendChild(createTextSpan("stch-cost", displayedCompletion));
    row.appendChild(createTextSpan("stch-full", displayedFull));
    // 单套订购暂不显示：priceoverview 不含最高买价，不能据此计算固定的最高订购价之和。
    const lv5 = createTextSpan("stch-lv5", displayedLevel);
    lv5.style.cssText = lv5Color;
    lv5.title = lv5Title;
    row.appendChild(lv5);
    row.appendChild(createTextSpan("stch-drops", info.dropsRemaining));
    if (options.showCacheAge) {
      const age = createTextSpan("stch-order-cache-age", String(getOrderCacheAgeDays(info.cachedAt)));
      age.title = info.cachedAt ? new Date(info.cachedAt).toLocaleString() : "";
      row.appendChild(age);
    }

    const buyCell = document.createElement("span");
    buyCell.className = "stch-buy";
    const buyLink = document.createElement("a");
    buyLink.href = "javascript:void(0)";
    buyLink.className = "stch-buy-link";
    buyLink.dataset.appid = info.appid;
    buyLink.style.cssText = "text-decoration:underline;color:#66c0f4;cursor:pointer;";
    buyLink.textContent = "购买";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "stch-result-cb";
    checkbox.checked = sourceState.selected.has(getResultKey(info));
    checkbox.setAttribute("aria-label", `选择 ${info.gameName || info.appid}`);
    buyCell.appendChild(buyLink);
    row.appendChild(buyCell);
    const checkboxCell = document.createElement("span");
    checkboxCell.className = "stch-check";
    checkboxCell.appendChild(createCheckboxHit(checkbox));
    row.appendChild(checkboxCell);

    buyLink.addEventListener("click", (e) => {
      e.stopPropagation();
      openMultibuy(info);
    });
    const applyChecked = checked => {
      const key = getResultKey(info);
      if (checked) {
        sourceState.selected.add(key);
      } else {
        sourceState.selected.delete(key);
      }
      scheduleSelectionUpdate(source);
    };
    checkbox.addEventListener("click", e => e.stopPropagation());
    checkbox.addEventListener("change", e => {
      e.stopPropagation();
      applyChecked(checkbox.checked);
    });
    checkboxCell.addEventListener("click", e => {
      e.stopPropagation();
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      applyChecked(checkbox.checked);
    });
    row.addEventListener("click", (e) => {
      if (e.target.closest(".stch-buy-link, .stch-result-cb, .stch-check, .stch-check-hit")) return;
      const pUrl = getProfileUrl();
      if (pUrl) window.open(`${pUrl}/gamecards/${info.appid}/${getBadgeUrlSuffix(info)}`, "_blank");
    });
    row.style.cursor = "pointer";
    list.appendChild(row);
  }

  export function renderGameRow(info) {
    const list = document.getElementById("stch-list");
    if (list.children.length === 0) renderHeader(list);
    renderDataRow(list, info);
    const checkpoint = state.results.length % 10 === 0;
    upsertOrderResult(info, { persist: checkpoint });
    if (checkpoint) renderOrderResults();
    updateBulkActionState();
    updateResultColumns();
  }

  export function getRealtimePricingTotals(info) {
    const profile = getActiveOrderPricingProfile(
      state.cfg,
      state.automaticPricingDraft
    );
    const adjustmentCents = Math.round((Number(profile.adjustment) || 0) * 100);
    const minimumCents = getMarketMinimumPriceCents();
    if (!Number.isSafeInteger(minimumCents) || minimumCents <= 0) {
      return {
        completionCents: null,
        fullCents: null,
        levelCents: null,
      };
    }
    const currencyId = Number(state.currencyContext?.currencyId || state.cfg.currencyId) || 23;
    const getCacheKey = card => JSON.stringify([
      String(currencyId),
      String(card?.marketHashName || ""),
    ]);
    const getHighestBuy = card => {
      const cached = state.highestBuyPrices.get(getCacheKey(card));
      return Number.isFinite(cached?.priceCents) && cached.priceCents > 0
        ? cached.priceCents
        : null;
    };
    const resolveBasePriceMinor = card => {
      if (profile.priceSource === "median") return card?.medianCents;
      if (profile.priceSource === "highest") return getHighestBuy(card);
      return card?.lowestCents;
    };
    const resolveFinalPriceMinor = profile.automatic
      ? card => {
        const depth = state.marketOrderDepths.get(getCacheKey(card))?.depth;
        if (depth) {
          return calculateAutomaticBuyPrice(depth, {
            strategy: profile.priceSource,
            strategyRule: profile.strategyRule,
            adjustmentMinor: adjustmentCents,
            minimumPriceMinor: minimumCents,
          })?.finalPriceMinor ?? null;
        }
        const highestBuy = getHighestBuy(card);
        if (highestBuy == null) return null;
        const strategyOffset = Number(profile.strategyRule?.noWallOffsetMinor) || 0;
        return Math.max(minimumCents, highestBuy + strategyOffset + adjustmentCents);
      }
      : null;
    return calculateResultPricingTotals(info, {
      automatic: profile.automatic,
      priceSource: profile.priceSource,
      adjustmentMinor: adjustmentCents,
      minimumPriceMinor: minimumCents,
      resolveBasePriceMinor,
      resolveFinalPriceMinor,
    });
  }

  export function updateSummary() {
    const summary = document.getElementById("stch-summary");
    if (!summary) return;
    const count = state.results.length;
    const modeLabel = state.results.some(info => info.isFoil) ? "闪卡" : "普通卡";
    const thresholdCents = Math.round((Number(state.cfg.threshold) || 0) * 100);
    const totals = state.results.reduce((sum, result) => {
      const value = getRealtimePricingTotals(result);
      if (value.completionCents == null || value.fullCents == null || value.levelCents == null) {
        sum.incomplete = true;
        return sum;
      }
      sum.completion += value.completionCents;
      sum.full += value.fullCents;
      sum.level += value.levelCents;
      return sum;
    }, { completion: 0, full: 0, level: 0, incomplete: false });
    const totalText = value => totals.incomplete ? "-" : formatMoney(value);
    summary.innerHTML = `
      共 <b>${count}</b> 个${modeLabel} ≤ ${formatMoney(thresholdCents)} (单套卡牌价格上限)，补全总价 <b>${totalText(totals.completion)}</b>，全套总价 ${totalText(totals.full)}，满级总价 ${totalText(totals.level)}
    `;
  }

  export function setOrderSummaryVisibility(visible) {
    const row = document.getElementById("stch-order-summary-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  export function updateOrderSummary(options = {}) {
    const summary = document.getElementById("stch-order-summary");
    if (!summary) return;
    if (options.prune !== false) pruneOrderCache(true);
    const count = state.orderResults.length;
    const selectedCount = getSelectedOrderResults().length;
    const totals = state.orderResults.reduce((sum, result) => {
      const value = getRealtimePricingTotals(result);
      if (value.completionCents == null || value.fullCents == null || value.levelCents == null) {
        sum.incomplete = true;
        return sum;
      }
      sum.completion += value.completionCents;
      sum.full += value.fullCents;
      sum.level += value.levelCents;
      return sum;
    }, { completion: 0, full: 0, level: 0, incomplete: false });
    const totalText = value => totals.incomplete ? "-" : formatMoney(value);
    summary.innerHTML = `
      缓存 <b>${count}</b> 个 · 已选择 <b>${selectedCount}</b> 个 · 补全总价 <b>${totalText(totals.completion)}</b>，全套总价 ${totalText(totals.full)}，满级总价 ${totalText(totals.level)}
    `;
  }

  export function updateOrderResultColumns() {
    const showDrops = state.orderResults.some(info => Number(info.dropsRemaining) > 0);
    const list = document.getElementById("stch-order-list");
    list?.classList.toggle("stch-show-drops", showDrops);
    list?.classList.toggle("stch-show-completion", state.cfg.showScanCompletionColumn !== false);
    list?.classList.toggle("stch-show-sell-set", state.cfg.showScanSellSetColumn !== false);
  }
