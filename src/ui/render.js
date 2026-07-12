import { state } from "../state.js";

import { createTextSpan, createCheckboxHit } from "../utils/dom.js";

import { getProfileUrl, getMarketMinimumPriceCents } from "../utils/steam.js";

import { formatMoney } from "../utils/format.js";

import { getBadgeTargetLevel, getBadgeUrlSuffix } from "../utils/badge.js";

import { getResultKey, getSelectedResults, getSelectedOrderResults } from "../services/result-info.js";

import { pruneOrderCache, upsertOrderResult, getOrderCacheAgeDays } from "../services/order-cache.js";

import { openMultibuy } from "../features/multibuy.js";

import { updateBulkActionState, updateOrderActionState } from "./action-state.js";

import { updateResultColumns } from "../features/scan.js";

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
      <span class="stch-full stch-sortable" data-sort="full">单套最低<span class="stch-sort-arrow">${sortArrow("full", source)}</span></span>
      <span class="stch-lv5 stch-sortable" data-sort="lv5">满级估算 <span class="stch-sort-arrow">${sortArrow("lv5", source)}</span><span style="cursor:help;color:#8f98a0;font-size:11px;" title="绿色:近期成交>1，参考性较强&#10;灰色:近期成交=1，参考性不强&#10;红色:近期成交=0，参考性较弱&#10;黄色:Steam返回信息不全，采用 median_price 或公式估算，结果可能偏低">?</span></span>
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
        case "cost": va = a.cheapestSetCostCents; vb = b.cheapestSetCostCents; break;
        case "full": va = a.fullSetCostCents; vb = b.fullSetCostCents; break;
        case "lv5": va = a.level5CostCents; vb = b.level5CostCents; break;
        case "drops": va = a.dropsRemaining; vb = b.dropsRemaining; break;
        case "cached": va = a.cachedAt || 0; vb = b.cachedAt || 0; break;
        default: return 0;
      }
      if (typeof va === "string") {
        const cmp = va.localeCompare(vb, "zh");
        return sortAsc ? cmp : -cmp;
      }
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
    const lv5Color = info.hasEstimated ? "color:#c9a02c" : minVol > 1 ? "color:#4caf50" : minVol === 1 ? "color:#888" : "";
    const estimateNotes = [];
    if (info.hasFormulaEstimate) {
      estimateNotes.push(
        `Steam返回信息不全：${info.formulaEstimatedCards}张卡牌无价格，` +
        `使用已知卡牌几何均价 ${formatMoney(info.formulaEstimateUnitCents)} 估算`
      );
    }
    if (info.hasMedianFallback) {
      estimateNotes.push("部分卡牌无最低出售价格，使用 median_price 估算");
    }
    const unestimatedCards =
      Math.max(0, (info.noPriceDataCount || 0) - (info.formulaEstimatedCards || 0)) +
      (info.failedPriceCount || 0);
    if (unestimatedCards > 0) {
      estimateNotes.push(`${unestimatedCards}张卡牌未计入估算`);
    }
    const lv5Title = estimateNotes.length > 0
      ? `${estimateNotes.join("\n")}，结果可能偏低`
      : minVol > 1
        ? "近期成交>1，参考性较强"
        : minVol === 1
          ? "近期成交=1，参考性不强"
          : "近期成交=0，参考性较弱";
    row.appendChild(createTextSpan("stch-appid", `${info.appid}${info.isFoil ? "(箔)" : ""}`));
    row.appendChild(createTextSpan("stch-name", info.gameName || "(未知)"));
    row.appendChild(createTextSpan("stch-level", `Lv${info.level}/${targetLevel}`));
    row.appendChild(createTextSpan("stch-cards", `${ownedCards}/${info.totalInSet}`));
    row.appendChild(createTextSpan("stch-cost", formatMoney(info.cheapestSetCostCents)));
    row.appendChild(createTextSpan("stch-full", formatMoney(info.fullSetCostCents)));
    const lv5 = createTextSpan("stch-lv5", formatMoney(info.level5CostCents));
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
    checkbox.title = "选择此游戏进行重新计算或提交订购单";
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
      if (source === "order") {
        updateOrderSummary();
        updateOrderActionState();
      } else {
        updateBulkActionState();
      }
    };
    checkbox.addEventListener("click", e => {
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
    upsertOrderResult(info);
    renderOrderResults();
    updateBulkActionState();
    updateResultColumns();
  }

  export function getAdjustedCompletionCostCents(info) {
    const originalTotal = Math.max(0, Number(info?.cheapestSetCostCents) || 0);
    const adjustmentCents = Math.round((Number(state.cfg.priceAdjustment) || 0) * 100);
    if (adjustmentCents === 0) return originalTotal;

    const minimumCents = getMarketMinimumPriceCents();
    let knownOriginalTotal = 0;
    let knownAdjustedTotal = 0;
    for (const card of Array.isArray(info?.cards) ? info.cards : []) {
      const quantity = Math.max(0, 1 - (Number(card.owned) || 0));
      const basePriceCents = Number(card.lowestCents);
      if (quantity <= 0 || !Number.isFinite(basePriceCents) || basePriceCents <= 0) continue;
      knownOriginalTotal += basePriceCents * quantity;
      knownAdjustedTotal += Math.max(minimumCents, basePriceCents + adjustmentCents) * quantity;
    }
    return Math.max(0, originalTotal - knownOriginalTotal) + knownAdjustedTotal;
  }

  export function updateSummary() {
    const summary = document.getElementById("stch-summary");
    if (!summary) return;
    const count = state.results.length;
    const modeLabel = state.results.some(info => info.isFoil) ? "闪卡" : "普通卡";
    const thresholdCents = Math.round((Number(state.cfg.threshold) || 0) * 100);
    const totalCents = state.results.reduce((s, r) => s + getAdjustedCompletionCostCents(r), 0);
    const fullCents = state.results.reduce((s, r) => s + (Number(r.fullSetCostCents) || 0), 0);
    const lv5Cents = state.results.reduce((s, r) => s + (Number(r.level5CostCents) || 0), 0);
    summary.innerHTML = `
      共 <b>${count}</b> 个${modeLabel} ≤ ${formatMoney(thresholdCents)} (单套卡牌价格上限)，补全总价 <b>${formatMoney(totalCents)}</b>，全套总价 ${formatMoney(fullCents)}，满级总价 ${formatMoney(lv5Cents)}
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
    const totalCents = state.orderResults.reduce((s, r) => s + getAdjustedCompletionCostCents(r), 0);
    const fullCents = state.orderResults.reduce((s, r) => s + (Number(r.fullSetCostCents) || 0), 0);
    const lv5Cents = state.orderResults.reduce((s, r) => s + (Number(r.level5CostCents) || 0), 0);
    summary.innerHTML = `
      缓存 <b>${count}</b> 个 · 已选择 <b>${selectedCount}</b> 个 · 补全总价 <b>${formatMoney(totalCents)}</b>，全套总价 ${formatMoney(fullCents)}，满级总价 ${formatMoney(lv5Cents)}
    `;
  }

  export function updateOrderResultColumns() {
    const showDrops = state.orderResults.some(info => Number(info.dropsRemaining) > 0);
    document.getElementById("stch-order-list")?.classList.toggle("stch-show-drops", showDrops);
  }
