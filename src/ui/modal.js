import { priceControlsHtml, bindPricingControls } from "./pricing-controls.js";
import { state } from "../state.js";

import {
  AUTOMATIC_PRICE_STRATEGY_CONFIG,
  SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG,
  saveConfig,
  DEFAULT_CONFIG,
} from "../config.js";

import { ONBOARDING_SEEN_KEY, TAB_DEFINITIONS } from "../constants.js";

import {
  createCurrencyContext,
  getActiveCurrencyContext,
  setActiveCurrencyContext,
} from "../services/currency.js";

import { startScan, requestStop, skipCurrentBadge, applyScanModeTheme, updateResultColumns } from "../features/scan.js";

import { recalculateSelectedResults, recalculateSelectedOrderResults } from "../features/recalculate.js";

import { activatePriceHistoryTab, initPriceHistoryUi, resetPriceHistoryRuntime, stopPriceHistoryRefresh } from "../features/price-history.js";

import {
  submitSelectedBuyOrders,
  submitSelectedOrderBuyOrders,
  addManualOrderAppid,
} from "../features/orders.js";

import {
  activateActiveBuyOrdersTab,
  initActiveBuyOrdersUi,
  refreshActiveBuyOrders,
  resetActiveBuyOrdersRuntime,
} from "../features/active-orders.js";

import { startCraftScan, requestCraftStop, setAllCraftCounts, submitCraftPlan, renderCraftResults } from "../features/craft.js";

import { startSurplusScan, requestSurplusStop, renderSurplusResults, setAllVisibleSurplusSelection } from "../features/surplus.js";

import { startGrindScan, requestGrindStop, renderGrindResults, setAllVisibleGrindSelection } from "../features/grind.js";

import { submitSelectedProcessingSell, submitSelectedProcessingGems } from "../features/item-actions.js";
import {
  activateItemCollectionTab,
  collectSelectedProcessingItems,
  removeSelectedCollectionItems,
  renderItemCollection,
  setAllItemCollectionSelection,
} from "../features/item-collection.js";

import {
  addToBlacklist,
  findExpiredBlacklistEntries,
  lookupGameName,
  removeBlacklistEntries,
  renderBlacklist,
  setBlacklistEntriesFixed,
  updateBlRow,
} from "../features/blacklist.js";

import { renderResults, renderOrderResults, updateSummary, updateOrderSummary, updateOrderResultColumns } from "./render.js";

import { isSharedActionBusy, updateAllActionStates, updateSurplusActionState } from "./action-state.js";

import { clearOrderCache, loadOrderCache, pruneOrderCache, readRawOrderCache } from "../services/order-cache.js";

import { refreshSidebarData, setSidebarEnabled } from "../sidebar/sidebar.js";
import { applyTabColors, applyTabOrder, enableTabDragReordering } from "./tab-drag.js";
import { normalizeHexColor, normalizeTabColors } from "../services/tab-preferences.js";
import {
  normalizeProcessingMode,
  processingModeIncludesCards,
  processingModeIncludesDecorations,
} from "../services/processing-mode.js";
import {
  createDataBackup,
  getDataBackupFileName,
  parseDataBackup,
  restoreDataBackup,
  serializeDataBackup,
} from "../services/data-backup.js";

  let modalEl = null;

  function getCurrencySourceLabel(context) {
    if (context?.source === "walletInfo") return "Steam 钱包识别";
    if (context?.source === "application_config") return "Steam 页面钱包识别";
    if (context?.source === "page") return "市场页面识别";
    if (context?.isFallback || context?.source === "configured") return "用户设置回退";
    return "未识别";
  }

  function getCurrencyDisplayStatus(context = getActiveCurrencyContext()) {
    if (!context?.currencyId) return "未识别币种";
    return `${context.code} (${context.symbol}) · ${getCurrencySourceLabel(context)}`
      + `${context.verified ? "" : " · 格式/费用规则未验证"}`;
  }

  const AUTOMATIC_STRATEGY_SETTING_ROWS = [AUTOMATIC_PRICE_STRATEGY_CONFIG, SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG].map(config => Object.entries(config).map(([id, fields]) => ({
    id, label: { conservative: "保守", balanced: "平衡", aggressive: "抢单", instant: "速售", follow: "跟价" }[id], ...fields,
  })));

  function resetCurrencyBoundState() {
    state.results = [];
    state.selectedResults = new Set();
    state.orderResults = loadOrderCache();
    state.selectedOrderResults = new Set();
    state.pendingOrderQuantities = new Map();
    state.highestBuyPrices = new Map();
    state.marketOrderDepths = new Map();
    resetActiveBuyOrdersRuntime();
    resetPriceHistoryRuntime();
    state.surplusResults = [];
    state.selectedSurplusResults = new Set();
    state.surplusGemPrice = null;
    state.grindResults = [];
    state.selectedGrindResults = new Set();
    state.grindGemPrice = null;
  }

  function applyConfiguredCurrency(currencyId) {
    const previous = getActiveCurrencyContext();
    if (previous && !previous.isFallback && previous.source !== "unresolved") {
      state.currencyContext = previous;
      return false;
    }
    const next = setActiveCurrencyContext(createCurrencyContext(currencyId, {
      source: "configured",
      isFallback: true,
    }));
    state.currencyContext = next;
    if (previous?.currencyId !== next?.currencyId) {
      resetCurrencyBoundState();
      return true;
    }
    return false;
  }

  export function getOuterHeight(element) {
    if (!element) return 0;
    const style = getComputedStyle(element);
    if (style.display === "none") return 0;
    const rect = element.getBoundingClientRect();
    return rect.height
      + (parseFloat(style.marginTop) || 0)
      + (parseFloat(style.marginBottom) || 0);
  }

  export function initLogResizers(root) {
    root.querySelectorAll(".stch-log-resizer").forEach(resizer => {
      const logPane = document.getElementById(resizer.dataset.log);
      if (!logPane || resizer.dataset.ready === "1") return;
      resizer.dataset.ready = "1";

      const contentPane = resizer.dataset.content
        ? document.getElementById(resizer.dataset.content)
        : null;

      resizer.addEventListener("pointerdown", event => {
        if (event.button !== 0) return;
        event.preventDefault();

        const tab = resizer.closest(".stch-tab-content") || root;
        const tabHeight = tab.getBoundingClientRect().height || window.innerHeight;
        const startY = event.clientY;
        const startLogHeight = logPane.getBoundingClientRect().height || 160;
        const minLogHeight = 82;
        const minContentHeight = contentPane ? 82 : 42;
        const reservedHeight = [...tab.children].reduce((sum, child) => {
          if (child === logPane || child === resizer || child === contentPane) return sum;
          return sum + getOuterHeight(child);
        }, 0);
        const maxLogHeight = Math.max(
          minLogHeight,
          tabHeight - reservedHeight - getOuterHeight(resizer) - minContentHeight - 12
        );

        if (contentPane) {
          contentPane.style.flex = "1 1 0";
          contentPane.style.maxHeight = "none";
          contentPane.style.minHeight = `${minContentHeight}px`;
        }
        logPane.style.minHeight = `${minLogHeight}px`;

        const onMove = moveEvent => {
          const delta = moveEvent.clientY - startY;
          const nextHeight = Math.max(
            minLogHeight,
            Math.min(maxLogHeight, startLogHeight - delta)
          );
          logPane.style.flex = `0 0 ${nextHeight}px`;
          logPane.style.height = `${nextHeight}px`;
        };
        const onUp = () => {
          resizer.classList.remove("dragging");
          document.body.classList.remove("stch-log-resizing");
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
        };

        resizer.classList.add("dragging");
        document.body.classList.add("stch-log-resizing");
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
      });
    });
  }

  export function openModal() {
    if (modalEl) {
      modalEl.style.display = "";
      const backdrop = document.getElementById("stch-backdrop");
      if (backdrop) backdrop.style.display = "block";
      return;
    }
    buildModal();
  }

  export function buildModal(options = {}) {
    const initialTab = options.initialTab || "scan";
    const activeClass = tabName => initialTab === tabName ? "active" : "";
    const currencyContext = getActiveCurrencyContext();
    const currencySymbol = currencyContext?.symbol || "¤";
    const currencyStatus = getCurrencyDisplayStatus(currencyContext);
    const progressHtml = prefix => `<div class="stch-progress" id="${prefix}progress-wrap" style="display:none"><div class="stch-progress-bar" id="${prefix}progress-bar" style="width:0"></div><div class="stch-progress-text" id="${prefix}progress-text">0/0</div></div>`;
    const automaticStrategySettingsHtml = (sell = false) => AUTOMATIC_STRATEGY_SETTING_ROWS[Number(sell)].map(rule => `
      <div class="stch-auto-strategy-row">
        <span class="stch-auto-strategy-name">${rule.label}</span>
        ${rule.anchorKey ? `<label>${sell ? "" : "有订单墙时"}
          <select id="stch-${sell ? "sell-" : ""}auto-${rule.id}-wall-anchor" class="stch-input stch-auto-wall-anchor">
            ${(sell ? [["bottom", "出售墙底"], ["previous", "出售墙中"]] : [["top", "订单墙顶"], ["bottom", "订单墙底"]]).map(([value, label]) => `<option value="${value}" ${state.cfg[rule.anchorKey] === value ? "selected" : ""}>${label}</option>`).join("")}
          </select></label>` : ""}
        ${sell ? "" : `<label>${rule.anchorKey ? "偏移" : "有订单墙时"} ${currencySymbol}
          <input id="stch-auto-${rule.id}-wall-offset" class="stch-input stch-auto-offset" type="number" step="0.01" value="${state.cfg[rule.wallOffsetKey]}">
        </label>`}
        <label>${sell ? "偏移" : "无订单墙时"} ${currencySymbol}
          <input id="stch-${sell ? "sell-" : ""}auto-${rule.id}-no-wall-offset" class="stch-input stch-auto-offset" type="number" step="0.01" value="${state.cfg[rule.noWallOffsetKey]}">
        </label>
      </div>
    `).join("");
    const tabColorSettingsHtml = TAB_DEFINITIONS.map(({ id, label }) => `
      <label class="stch-tab-color-field">
        <span>${label}</span>
        <input class="stch-input stch-tab-color-input" data-tab-color="${id}"
          type="text" maxlength="7" spellcheck="false" placeholder="#66C0F4"
          value="${state.cfg.tabColors?.[id] || ""}">
      </label>
    `).join("");
    const backdrop = document.createElement("div");
    backdrop.id = "stch-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.id = "stch-modal";
    modal.addEventListener("click", e => e.stopPropagation());
    modal.innerHTML = `
      <div class="stch-header">
        <h2>Steam 卡牌助手</h2>
        <span class="stch-close" title="关闭">✕</span>
      </div>
      <div class="stch-body">
        <div class="stch-tabs">
          <span class="stch-tab ${activeClass("scan")}" data-tab="scan">价格扫描</span>
          <span class="stch-tab" data-tab="orders">订购卡牌</span>
          <span class="stch-tab ${activeClass("active-orders")}" data-tab="active-orders">订购单</span>
          <span class="stch-tab ${activeClass("history")}" data-tab="history">价格走势</span>
          <span class="stch-tab" data-tab="craft">徽章合成</span>
          <span class="stch-tab" data-tab="blacklist">黑名单</span>
          <span class="stch-tab" data-tab="surplus">多余物品</span>
          <span class="stch-tab" data-tab="collection">物品收藏</span>
          <span class="stch-tab stch-tab-right ${activeClass("settings")}" data-tab="settings">设置</span>
        </div>
        <div class="stch-tab-content ${activeClass("scan")}" id="stch-tab-scan">
          <div class="stch-onboarding" id="stch-onboarding" style="display:none">
            <h3>欢迎使用 Steam 卡牌助手</h3>
            <p class="stch-onboarding-intro">扫描未完成的徽章，比较卡牌成本，更快地完成购买和徽章合成。</p>
            <div class="stch-onboarding-step">
              <b>1. 设置并扫描</b>
              设置单套价格上限和购买逻辑后开始扫描。价格预测会在明显超出上限时提前跳过，减少请求和等待。
            </div>
            <div class="stch-onboarding-step">
              <b>2. 选择购买方式</b>
              “手动购买”会打开 Steam multibuy 并自动填写数量和价格；勾选结果后也可以批量提交长期订购单。
            </div>
            <div class="stch-onboarding-step">
              <b>3. 理解购买价格</b>
              手动价格可选在售最低、平均价格或求购最高；智能定价可按订单墙选择保守、平衡或抢单。买价调整可正可负。
            </div>
            <div class="stch-onboarding-step">
              <b>4. 管理已下订购单</b>
              “已下订购单”页显示 Steam 返回的当前剩余量。最低售价只在选择后手动查询并保留 10 分钟，智能价差只使用本次会话已有订单簿缓存。
            </div>
            <div class="stch-onboarding-step">
              <b>5. 批量合成徽章</b>
              在“徽章合成”页扫描已经收集齐全的卡组，可逐级升级或一次提交当前可合成最大次数。
            </div>
            <div class="stch-onboarding-note">
              市场价格和满级成本均可能变化。提交购买、订购单或合成前，请检查数量和目标等级。
            </div>
            <div class="stch-onboarding-actions">
              <div class="stch-btn" id="stch-onboarding-close">关闭</div>
            </div>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">单套卡牌价格上限 ${currencySymbol} <input id="stch-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.threshold}"></label>
            <label class="stch-primary-label" id="stch-buy-mode-label">购买卡牌逻辑 <select id="stch-buy-mode" class="stch-input" style="width:110px">
              <option value="complete1" ${state.cfg.buyMode === "complete1" ? "selected" : ""}>补全单套</option>
              <option value="complete5" ${state.cfg.buyMode === "complete5" ? "selected" : ""}>补至五级</option>
              <option value="buy1" ${state.cfg.buyMode === "buy1" ? "selected" : ""}>购买单套</option>
              <option value="buy5" ${state.cfg.buyMode === "buy5" ? "selected" : ""}>购买五套</option>
            </select></label>
            <label>最大徽章页数 <input id="stch-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <label class="stch-foil-mode-label ${state.cfg.foilScanMode ? "active" : ""}" id="stch-foil-mode-label">
              <input id="stch-foil-scan-mode" type="checkbox" ${state.cfg.foilScanMode ? "checked" : ""}>
              闪卡模式
            </label>
            <label>
              <input id="stch-include-drops" type="checkbox" ${state.cfg.includeDrops ? "checked" : ""}>
              包含掉落
            </label>
          </div>
          <div class="stch-toolbar">${priceControlsHtml("stch-order-", "stch-")}</div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-scan-btn">开始扫描</div>
            <div class="stch-btn alt disabled" id="stch-stop-btn">停止</div>
            <div class="stch-btn alt disabled" id="stch-skip-btn">跳过当前</div>
            <div class="stch-bulk-actions">
              <div class="stch-btn alt disabled" id="stch-recalculate-btn">重新计算</div>
              <div class="stch-btn disabled" id="stch-submit-orders-btn">提交订购单</div>
            </div>
          </div>
          ${progressHtml("stch-")}
          <div class="stch-summary" id="stch-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-summary"></span>
            <span class="stch-selected-count" id="stch-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-status"></div>
          <div class="stch-game-list" id="stch-list"></div>
          <div class="stch-log-resizer" data-log="stch-log" data-content="stch-list"></div>
          <div id="stch-log"></div>
        </div>
        <div class="stch-tab-content ${activeClass("history")}" id="stch-tab-history">
          <div class="stch-toolbar stch-history-toolbar">
            <label class="stch-primary-label">来源
              <select id="stch-history-source" class="stch-input stch-history-source">
                <option value="scan">扫描结果</option>
                <option value="order">订购缓存</option>
                <option value="manual">手动输入</option>
              </select>
            </label>
            <label id="stch-history-card-label" class="stch-primary-label">卡牌
              <select id="stch-history-card" class="stch-input stch-history-card"></select>
            </label>
            <label id="stch-history-manual-label" class="stch-primary-label stch-history-hidden">market_hash_name
              <input id="stch-history-manual" class="stch-input stch-history-manual" type="text" placeholder="753-Sack of Gems">
            </label>
            <button type="button" class="stch-btn alt" id="stch-history-add">添加</button>
            <div class="stch-history-toolbar-spacer"></div>
            <span class="stch-history-count" id="stch-history-count">已保存 0 项</span>
            <button type="button" class="stch-btn alt" id="stch-history-refresh">刷新全部价格</button>
          </div>
          <div class="stch-toolbar stch-history-range" aria-label="价格走势时间范围">
            <span class="stch-label">范围</span>
            <button type="button" class="stch-btn alt" data-history-range="24h">24 小时</button>
            <button type="button" class="stch-btn alt" data-history-range="7d">7 天</button>
            <button type="button" class="stch-btn alt" data-history-range="30d">30 天</button>
            <button type="button" class="stch-btn alt" data-history-range="all">全部</button>
          </div>
          <div class="stch-status-text" id="stch-history-status" style="display:none"></div>
          <div class="stch-history-list" id="stch-history-list"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-orders">
          <div class="stch-toolbar">
            <label class="stch-primary-label">手动 AppID <input id="stch-order-appid" class="stch-input" type="text" style="width:100px" placeholder="4761370"></label>
            <label class="stch-foil-mode-label" id="stch-order-manual-foil-label">
              <input id="stch-order-manual-foil" type="checkbox">
              闪卡模式
            </label>
            <div class="stch-btn alt" id="stch-order-add-btn">加入</div>
            <div class="stch-btn alt disabled" id="stch-order-recalculate-btn">重新计算</div>
            <div class="stch-btn disabled" id="stch-order-submit-orders-btn">提交订购单</div>
          </div>
          <div class="stch-toolbar">${priceControlsHtml("stch-order-page-", "stch-order-page-")}</div>
          <div class="stch-summary" id="stch-order-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-order-summary"></span>
          </div>
          <div class="stch-status-text" id="stch-order-status" style="display:none"></div>
          <div class="stch-game-list stch-order-page-list" id="stch-order-list"></div>
        </div>
        <div class="stch-tab-content ${activeClass("active-orders")}" id="stch-tab-active-orders">
          <div class="stch-toolbar stch-active-orders-toolbar">
            <label class="stch-primary-label">游戏
              <select id="stch-active-orders-game" class="stch-input">
                <option value="all">全部游戏</option>
              </select>
            </label>
            <button type="button" class="stch-btn alt" id="stch-active-orders-refresh">刷新</button>
            <button type="button" class="stch-btn alt disabled" id="stch-active-orders-query-prices">查价</button>
            <button type="button" class="stch-btn alt stch-btn-danger disabled" id="stch-active-orders-cancel-selected">撤销选中</button>
          </div>
          <div class="stch-summary stch-active-orders-summary-row">
            <span class="stch-summary-text" id="stch-active-orders-summary">尚未读取订购单</span>
            <span class="stch-selected-count" id="stch-active-orders-selected-count">已选 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-active-orders-status" style="display:none"></div>
          <div class="stch-active-orders-list" id="stch-active-orders-list"></div>
          <div class="stch-active-orders-log" id="stch-active-orders-log" style="display:none"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-craft">
          <div class="stch-toolbar">
            <label class="stch-primary-label">合成模式
              <select id="stch-craft-mode" class="stch-input" style="width:100px">
                <option value="step" ${state.cfg.craftMode === "step" ? "selected" : ""}>逐级升级</option>
                <option value="max" ${state.cfg.craftMode === "max" ? "selected" : ""}>一次升满</option>
              </select>
            </label>
            <label>最大徽章页数 <input id="stch-craft-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-craft-scan-btn">扫描</div>
            <div class="stch-btn alt disabled" id="stch-craft-stop-btn">停止</div>
            <div class="stch-craft-actions">
              <div class="stch-btn alt disabled" id="stch-craft-one-btn">全部 1 次</div>
              <div class="stch-btn alt disabled" id="stch-craft-max-btn">全部最大</div>
              <div class="stch-btn alt disabled" id="stch-craft-clear-btn">全部清零</div>
              <div class="stch-btn disabled" id="stch-craft-submit-btn">确认合成</div>
            </div>
          </div>
          ${progressHtml("stch-craft-")}
          <div class="stch-summary" id="stch-craft-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-craft-summary"></span>
          </div>
          <div class="stch-status-text" id="stch-craft-status"></div>
          <div class="stch-game-list stch-craft-list" id="stch-craft-list"></div>
          <div class="stch-log-resizer" data-log="stch-craft-log" data-content="stch-craft-list"></div>
          <div id="stch-craft-log"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-blacklist">
          <div class="stch-bl-form">
            <label>输入游戏 AppID <input id="stch-bl-appid" class="stch-input" type="text" style="width:100px" placeholder="例如: 1144400"></label>
            <div class="stch-btn alt" id="stch-bl-lookup">查询游戏</div>
            <div class="stch-btn" id="stch-bl-add" style="display:none;">加入游戏黑名单</div>
            <div class="stch-btn" id="stch-bl-add-fixed" style="display:none;">加入固定游戏黑名单</div>
            <div class="stch-btn alt stch-btn-danger disabled" id="stch-bl-del-sel" style="display:none;">删除选中项</div>
            <div class="stch-btn alt disabled" id="stch-bl-fix-sel" style="display:none;">加入固定游戏黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-unfix-sel" style="display:none;">移除固定游戏黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-cleanup">一键清理过期</div>
            <span class="stch-bl-result" id="stch-bl-result"></span>
          </div>
          <div class="stch-bl-form">
            <label class="stch-primary-label">价格上限 ${currencySymbol} <input id="stch-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <label>数据 <input id="stch-blacklist-expiry-days" class="stch-input" type="number" min="1" step="1" value="${state.cfg.blacklistExpiryDays}" style="width:55px"> 天后过期</label>
            <label>
              <input id="stch-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动游戏黑名单
            </label>
          </div>
          <div class="stch-bl-list" id="stch-bl-list"></div>
          <div class="stch-bl-list" id="stch-bl-list-fixed" style="max-height:100px;margin-top:8px;"></div>
          <div class="stch-bl-count" id="stch-bl-count"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-surplus">
          <div class="stch-toolbar stch-surplus-main-toolbar">
            <label class="stch-primary-label">处理类型
              <select id="stch-surplus-item-mode" class="stch-input" style="width:172px">
                <option value="all" ${state.cfg.surplusItemMode === "all" ? "selected" : ""}>全部（卡牌、背景和表情）</option>
                <option value="card" ${state.cfg.surplusItemMode === "card" ? "selected" : ""}>卡牌</option>
                <option value="decoration" ${state.cfg.surplusItemMode === "decoration" ? "selected" : ""}>装饰（背景和表情）</option>
                <option value="background" ${state.cfg.surplusItemMode === "background" ? "selected" : ""}>背景</option>
                <option value="emoticon" ${state.cfg.surplusItemMode === "emoticon" ? "selected" : ""}>表情</option>
              </select>
            </label>
            <label>
              <input id="stch-surplus-only-tradable" type="checkbox" ${state.cfg.surplusOnlyTradable ? "checked" : ""}>
              只显示可交易
            </label>
            <label>
              <input id="stch-surplus-only-recommended" type="checkbox" ${state.cfg.surplusOnlyRecommended ? "checked" : ""}>
              只显示建议分解
            </label>
            ${priceControlsHtml("stch-surplus-sell-", "stch-surplus-sell-", true)}
            <label><input id="stch-surplus-include-foil" type="checkbox" ${state.cfg.surplusIncludeFoil ? "checked" : ""}> 包含闪卡</label>
          </div>
          <div class="stch-scan-actions stch-surplus-action-row">
            <div class="stch-btn" id="stch-surplus-scan-btn">开始检测</div>
            <div class="stch-btn alt disabled" id="stch-surplus-stop-btn">停止</div>
            <div class="stch-surplus-action-spacer"></div>
            <div class="stch-btn alt disabled" id="stch-surplus-select-all-btn">全选</div>
            <div class="stch-surplus-action-buttons">
              <div class="stch-btn alt disabled" id="stch-surplus-collect-btn">收藏选中</div>
              <div class="stch-btn alt disabled" id="stch-surplus-sell-btn">出售</div>
              <div class="stch-btn stch-btn-danger disabled" id="stch-surplus-gem-btn">转化宝石</div>
            </div>
          </div>
          <div class="stch-surplus-mode-panel" id="stch-surplus-processing-panel">
            ${progressHtml("stch-surplus-")}
            <div class="stch-summary" id="stch-surplus-summary-row" style="display:none">
              <span class="stch-summary-text stch-processing-summary" id="stch-surplus-summary"></span>
              <span class="stch-summary-text stch-processing-summary" id="stch-grind-summary"></span>
            </div>
            <div class="stch-status-text" id="stch-surplus-status"></div>
            <div class="stch-game-list stch-surplus-list stch-inventory-grid" id="stch-processing-list">
              <div class="stch-processing-results" id="stch-surplus-list"></div>
              <div class="stch-processing-results" id="stch-grind-list"></div>
              <div class="stch-inventory-empty" id="stch-processing-empty">尚未检测到物品</div>
            </div>
            <div class="stch-log-resizer" data-log="stch-surplus-log" data-content="stch-processing-list"></div>
            <div id="stch-surplus-log"></div>
          </div>
        </div>
        <div class="stch-tab-content" id="stch-tab-collection">
          <div class="stch-scan-actions stch-collection-actions">
            <span class="stch-summary-text" id="stch-collection-summary">已收藏 0 项 · 已选择 0 项</span>
            <div class="stch-surplus-action-spacer"></div>
            <div class="stch-btn alt disabled" id="stch-collection-select-all">全选</div>
            <div class="stch-btn alt stch-btn-danger disabled" id="stch-collection-remove">移除选中</div>
          </div>
          <div class="stch-status-text" id="stch-collection-status" style="display:none"></div>
          <div class="stch-game-list stch-collection-list" id="stch-collection-list"></div>
        </div>
        <div class="stch-tab-content ${activeClass("settings")} ${state.cfg.showAdvancedSettings ? "stch-show-advanced" : ""}" id="stch-tab-settings">
          <div class="stch-settings-layout">
            <div class="stch-settings-nav">
              <button class="stch-settings-nav-item active" type="button" data-settings-page="general">常规</button>
              <button class="stch-settings-nav-item" type="button" data-settings-page="personalization">个性化</button>
            </div>
            <div class="stch-settings-main">
              <div class="stch-settings-panel active" data-settings-panel="general">
                <div style="color:#fff;font-weight:bold;font-size:16px;margin-bottom:4px;">全局设定</div>
                <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
                <div class="stch-toolbar">
            <label>无法自动识别币种时使用
              <select id="stch-currency-fallback" class="stch-input" style="width:138px">
                <option value="23" ${Number(state.cfg.currencyId) === 23 ? "selected" : ""}>人民币 CNY (¥)</option>
                <option value="1" ${Number(state.cfg.currencyId) === 1 ? "selected" : ""}>美元 USD ($)</option>
                <option value="29" ${Number(state.cfg.currencyId) === 29 ? "selected" : ""}>港币 HKD (HK$)</option>
              </select>
            </label>
            <span class="stch-settings-hint">当前使用：${currencyStatus}</span>
          </div>
          <div class="stch-toolbar">
            <label><input id="stch-parallel-order-pricing" type="checkbox" ${state.cfg.parallelOrderPricingEnabled ? "checked" : ""}> HTML 类请求并发</label>
            <label>并发数 <input id="stch-parallel-order-pricing-concurrency" class="stch-input" type="number" min="1" max="20" step="1" value="${state.cfg.parallelOrderPricingConcurrency}" style="width:55px"></label>
          </div>
          <div class="stch-toolbar">
            <label><input id="stch-parallel-other-requests" type="checkbox" ${state.cfg.parallelOtherRequestsEnabled ? "checked" : ""}> 其他请求并发</label>
            <label>并发数 <input id="stch-parallel-other-requests-concurrency" class="stch-input" type="number" min="1" max="20" step="1" value="${state.cfg.parallelOtherRequestsConcurrency}" style="width:55px"></label>
          </div>
          <div class="stch-toolbar stch-advanced-setting">
            <label>priceoverview请求间隔 <input id="stch-req-interval" class="stch-input" type="number" min="100" step="10" value="${state.cfg.requestInterval}" style="width:70px"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label class="stch-advanced-setting">
              <input id="stch-show-no-result-logs" type="checkbox" ${state.cfg.showNoResultLogs ? "checked" : ""}>
              显示无结果日志
            </label>
            <label>
              <input id="stch-sidebar-disabled" type="checkbox" ${state.cfg.sidebarDisabled ? "checked" : ""}>
              关闭侧边栏
            </label>
          </div>
          <div class="stch-advanced-setting" style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">购买价格</div>
          <div class="stch-advanced-setting" style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-auto-strategy-settings stch-advanced-setting">
            ${automaticStrategySettingsHtml()}
            <div class="stch-auto-strategy-hint">* 订单墙是靠近有效最高买价、订单数量相对前面邻近价位显著增加的连续区域；墙顶是该区域最高价，墙底是最低价。</div>
          </div>
          <div class="stch-advanced-setting" style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">出售价格</div>
          <div class="stch-advanced-setting" style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-auto-strategy-settings stch-advanced-setting">
            ${automaticStrategySettingsHtml(true)}
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">卡牌价格扫描</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>订购卡牌缓存 <input id="stch-order-cache-days" class="stch-input" type="number" min="0" step="1" value="${state.cfg.orderCacheDays}" style="width:55px"> 天</label>
            <label><input id="stch-early-price-prediction" type="checkbox" ${state.cfg.earlyPricePrediction ? "checked" : ""}> 价格预测提早跳过</label>
            <label title="扫描缺价、Steam 无买单或下单查价失败时，使用当前币种的市场最低价">
              <input id="stch-minimum-price-fallback" type="checkbox" ${state.cfg.minimumPriceFallback ? "checked" : ""}>
              无价格时使用市场最低价
            </label>
            <label><input id="stch-skip-cached-orders" type="checkbox" ${state.cfg.skipCachedOrderResults ? "checked" : ""}> 扫描时跳过缓存内结果</label>
          </div>
          <div class="stch-toolbar stch-advanced-setting">
            <label><input id="stch-show-scan-completion-column" type="checkbox" ${state.cfg.showScanCompletionColumn ? "checked" : ""}> 单套补全显示</label>
            <label><input id="stch-show-scan-sell-set-column" type="checkbox" ${state.cfg.showScanSellSetColumn ? "checked" : ""}> 单套在售显示</label>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">游戏/AppID 黑名单</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">价格上限 ${currencySymbol} <input id="stch-settings-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <label>数据 <input id="stch-settings-blacklist-expiry-days" class="stch-input" type="number" min="1" step="1" value="${state.cfg.blacklistExpiryDays}" style="width:55px"> 天后过期</label>
            <label>
              <input id="stch-settings-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动游戏黑名单
            </label>
            <label><input id="stch-settings-early-prediction-auto-blacklist" type="checkbox" ${state.cfg.earlyPredictionAutoBlacklist ? "checked" : ""}> 预测跳过时加入自动黑名单</label>
          </div>
          <div class="stch-advanced-setting" style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">徽章合成</div>
          <div class="stch-advanced-setting" style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar stch-advanced-setting">
            <label>每次合成请求间隔 <input id="stch-craft-interval" class="stch-input" type="number" min="200" step="100" value="${state.cfg.craftInterval}" style="width:70px"> ms</label>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">多余物品处理</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label><input id="stch-surplus-keep-max-level-cards" type="checkbox" ${state.cfg.surplusKeepMaxLevelCards ? "checked" : ""}> 保留满级卡牌</label>
            <label>默认保留 <input id="stch-grind-reserve-copies" class="stch-input" type="number" min="0" step="1" value="${state.cfg.grindReserveCopies}" style="width:55px"> 份背景/表情</label>
            <label title="优先保留不可交易且不可上架的背景/表情副本">
              <input id="stch-grind-include-points-shop" type="checkbox" ${state.cfg.grindIncludePointsShopItems ? "checked" : ""}>
              优先保留点数商店对应物品
            </label>
          </div>
              </div>
              <div class="stch-settings-panel" data-settings-panel="personalization">
                <div class="stch-settings-section-title">Tab 标签颜色</div>
                <div class="stch-settings-section-rule"></div>
                <div class="stch-tab-color-settings">${tabColorSettingsHtml}</div>
                <div class="stch-tab-color-help">留空恢复默认</div>
                <div class="stch-footer-status" id="stch-personalization-status"></div>
              </div>
            </div>
          </div>
          <div class="stch-settings-page-actions">
            <label class="stch-advanced-toggle"><input id="stch-show-advanced-settings" type="checkbox" ${state.cfg.showAdvancedSettings ? "checked" : ""}> 显示高级</label>
            <span class="stch-footer-status" id="stch-settings-action-status"></span>
            <div class="stch-btn alt" id="stch-onboarding-open">使用说明</div>
            <div class="stch-btn alt" id="stch-settings-export-data">导出文件</div>
            <div class="stch-btn alt" id="stch-settings-import-data">导入数据</div>
            <input id="stch-settings-import-file" type="file" accept="application/json,.json" hidden>
            <div class="stch-btn alt" id="stch-settings-clear-cache">清除缓存</div>
            <div class="stch-btn stch-btn-danger" id="stch-settings-reset">恢复默认设定</div>
          </div>
        </div>
      </div>
      <div class="stch-footer">
        <span class="stch-label">V2.6.2</span>
      </div>
    `;
    document.body.appendChild(modal);
    const tabsContainer = modal.querySelector(".stch-tabs");
    state.cfg.tabOrder = applyTabOrder(tabsContainer, state.cfg.tabOrder);
    state.cfg.tabColors = applyTabColors(tabsContainer, state.cfg.tabColors);
    enableTabDragReordering(tabsContainer, order => {
      state.cfg.tabOrder = order;
      saveConfig(state.cfg);
    });
    modalEl = modal;
    initLogResizers(modal);

    modal.querySelector(".stch-close").addEventListener("click", closeModal);

    const activateSettingsPage = pageName => {
      modal.querySelectorAll("[data-settings-page]").forEach(button => {
        button.classList.toggle("active", button.dataset.settingsPage === pageName);
      });
      modal.querySelectorAll("[data-settings-panel]").forEach(panel => {
        panel.classList.toggle("active", panel.dataset.settingsPanel === pageName);
      });
    };
    modal.querySelectorAll("[data-settings-page]").forEach(button => {
      button.addEventListener("click", () => activateSettingsPage(button.dataset.settingsPage));
    });

    const personalizationStatus = document.getElementById("stch-personalization-status");
    const syncTabColorInput = (input, persist) => {
      const id = input.dataset.tabColor;
      const raw = input.value.trim();
      const color = normalizeHexColor(raw);
      const valid = raw === "" || !!color;
      input.classList.toggle("invalid", !valid);
      if (!valid) {
        if (personalizationStatus) personalizationStatus.textContent = "请输入六位 HEX 色值";
        return;
      }
      const next = { ...(state.cfg.tabColors || {}) };
      if (color) next[id] = color;
      else delete next[id];
      state.cfg.tabColors = normalizeTabColors(next);
      applyTabColors(tabsContainer, state.cfg.tabColors);
      if (personalizationStatus) personalizationStatus.textContent = "";
      if (persist) {
        input.value = color;
        saveConfig(state.cfg);
        if (personalizationStatus) {
          personalizationStatus.textContent = color ? "颜色已保存" : "已恢复默认颜色";
        }
      }
    };
    modal.querySelectorAll(".stch-tab-color-input[data-tab-color]").forEach(input => {
      input.addEventListener("input", () => syncTabColorInput(input, false));
      input.addEventListener("blur", () => syncTabColorInput(input, true));
      input.addEventListener("keydown", event => {
        if (event.key === "Enter") input.blur();
      });
    });

    const readNumberInput = (id, fallback, options = {}) => {
      const raw = document.getElementById(id)?.value;
      let value = options.integer ? parseInt(raw, 10) : parseFloat(raw);
      if (!Number.isFinite(value)) return fallback;
      if (options.integer) value = Math.floor(value);
      if (Number.isFinite(options.min)) value = Math.max(options.min, value);
      if (Number.isFinite(options.max)) value = Math.min(options.max, value);
      return value;
    };
    const getSurplusItemMode = () => {
      const value = document.getElementById("stch-surplus-item-mode")?.value
        || state.cfg.surplusItemMode
        || DEFAULT_CONFIG.surplusItemMode;
      return normalizeProcessingMode(value);
    };
    const applySurplusItemMode = () => {
      renderSurplusResults();
      renderGrindResults();
      updateSurplusActionState();
    };
    const configInputs = new Map([
      ["threshold","threshold",{"min":0}],
      ["req-interval","requestInterval",{"integer":true,"min":0}],
      ["max-pages","maxBadgePages",{"integer":true,"min":1}],
      ["include-drops","includeDrops"],
      ["foil-scan-mode","foilScanMode"],
      ["show-scan-completion-column","showScanCompletionColumn"],
      ["show-scan-sell-set-column","showScanSellSetColumn"],
      ["show-no-result-logs","showNoResultLogs"],
      ["show-advanced-settings","showAdvancedSettings"],
      ["sidebar-disabled","sidebarDisabled"],
      ["parallel-order-pricing","parallelOrderPricingEnabled"],
      ["parallel-order-pricing-concurrency","parallelOrderPricingConcurrency",{"integer":true,"min":1,"max":20}],
      ["parallel-other-requests","parallelOtherRequestsEnabled"],
      ["parallel-other-requests-concurrency","parallelOtherRequestsConcurrency",{"integer":true,"min":1,"max":20}],
      ["buy-mode","buyMode"],
      ["early-price-prediction","earlyPricePrediction"],
      ["minimum-price-fallback","minimumPriceFallback"],
      ["settings-early-prediction-auto-blacklist","earlyPredictionAutoBlacklist"],
      ["order-cache-days","orderCacheDays",{"integer":true,"min":0}],
      ["skip-cached-orders","skipCachedOrderResults"],
      ["surplus-only-tradable","surplusOnlyTradable"],
      ["surplus-only-recommended","surplusOnlyRecommended"],
      ["surplus-item-mode","surplusItemMode"],
      ["surplus-include-foil","surplusIncludeFoil"],
      ["surplus-keep-max-level-cards","surplusKeepMaxLevelCards"],
      ["grind-reserve-copies","grindReserveCopies",{"integer":true,"min":0}],
      ["grind-include-points-shop","grindIncludePointsShopItems"],
      ["craft-interval","craftInterval",{"integer":true,"min":200}],
      ["craft-mode","craftMode"],
      ...AUTOMATIC_STRATEGY_SETTING_ROWS.flatMap((rows, side) => rows.flatMap(rule => [
        ...(rule.anchorKey ? [[`${side ? "sell-" : ""}auto-${rule.id}-wall-anchor`, rule.anchorKey]] : []),
        ...(side ? [] : [[`auto-${rule.id}-wall-offset`, rule.wallOffsetKey, {}]]),
        [`${side ? "sell-" : ""}auto-${rule.id}-no-wall-offset`, rule.noWallOffsetKey, {}],
      ])),
    ].map(([id, ...rule]) => [`stch-${id}`, rule]));
    const syncConfigFromInputs = changedId => {
      const [key, numberOptions] = configInputs.get(changedId);
      const input = document.getElementById(changedId);
      const previousSurplusItemMode = state.cfg.surplusItemMode;
      const value = input.type === "checkbox" ? input.checked
        : numberOptions ? readNumberInput(changedId, state.cfg[key] ?? DEFAULT_CONFIG[key], numberOptions)
        : input.value || state.cfg[key];
      if (value === state.cfg[key]) return;
      state.cfg[key] = value;
      if (key === "buyMode" || key === "foilScanMode") {
        const buyModeEl = document.getElementById("stch-buy-mode");
        state.cfg.buyMode = buyModeEl?.dataset.normalValue
          || (state.cfg.foilScanMode ? state.cfg.buyMode : buyModeEl?.value)
          || DEFAULT_CONFIG.buyMode;
        if (!state.cfg.foilScanMode && buyModeEl) delete buyModeEl.dataset.normalValue;
      }
      saveConfig(state.cfg);
      if (key === "maxBadgePages") {
        document.getElementById("stch-craft-max-pages").value = String(state.cfg.maxBadgePages);
      }
      if (key === "showScanCompletionColumn" || key === "showScanSellSetColumn" || key === "includeDrops") {
        updateResultColumns();
        updateOrderResultColumns();
      }
      if (key === "foilScanMode" || key === "buyMode") applyScanModeTheme();
      if (changedId === "stch-order-cache-days") {
        pruneOrderCache(true);
        renderOrderResults();
      }
      if (changedId === "stch-buy-mode") renderOrderResults();
      if (changedId === "stch-craft-mode") renderCraftResults();
      if (changedId === "stch-sidebar-disabled") {
        setSidebarEnabled(!state.cfg.sidebarDisabled);
      }
      if (changedId === "stch-show-advanced-settings") {
        document.getElementById("stch-tab-settings")?.classList.toggle(
          "stch-show-advanced",
          state.cfg.showAdvancedSettings
        );
      }
      if (["stch-surplus-only-tradable", "stch-surplus-only-recommended"].includes(changedId)) {
        renderSurplusResults();
        renderGrindResults();
      }
      if (changedId === "stch-surplus-item-mode") {
        if (state.cfg.surplusItemMode !== previousSurplusItemMode) {
          state.surplusResults = [];
          state.selectedSurplusResults = new Set();
          state.surplusGemPrice = null;
          state.grindResults = [];
          state.selectedGrindResults = new Set();
          state.grindGemPrice = null;
        }
        applySurplusItemMode();
      }
      if (["stch-surplus-include-foil", "stch-surplus-keep-max-level-cards"].includes(changedId)) {
        state.surplusResults = [];
        state.selectedSurplusResults = new Set();
        state.surplusGemPrice = null;
        renderSurplusResults();
      }
      if (["stch-grind-reserve-copies", "stch-grind-include-points-shop"].includes(changedId)) {
        state.grindResults = [];
        state.selectedGrindResults = new Set();
        state.grindGemPrice = null;
      }
      if (changedId?.startsWith("stch-grind-")) renderGrindResults();
      if (changedId?.startsWith("stch-auto-") && changedId !== "stch-auto-pricing") {
        updateSummary();
        updateOrderSummary();
      }
    };
    for (const id of configInputs.keys()) {
      const input = document.getElementById(id);
      input?.addEventListener(input.type === "number" ? "input" : "change", () => syncConfigFromInputs(id));
    }

    bindPricingControls(() => {
      renderResults();
      renderOrderResults();
      updateSummary();
      updateOrderSummary();
    });

    const activateTab = tabName => {
      if (tabName !== "history") stopPriceHistoryRefresh({ silent: true });
      modal.querySelectorAll(".stch-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
      modal.querySelectorAll(".stch-tab-content").forEach(content => {
        content.classList.toggle("active", content.id === `stch-tab-${tabName}`);
      });
      if (tabName === "blacklist") renderBlacklist();
      if (tabName === "orders") {
        renderOrderResults();
        if (!state.activeOrdersLoadedAt && !state.activeOrdersLoading) {
          void refreshActiveBuyOrders().then(renderOrderResults);
        }
      }
      if (tabName === "active-orders") activateActiveBuyOrdersTab();
      if (tabName === "history") activatePriceHistoryTab();
      if (tabName === "surplus") applySurplusItemMode();
      if (tabName === "collection") activateItemCollectionTab();
    };
    const showOnboarding = () => {
      GM_setValue(ONBOARDING_SEEN_KEY, true);
      activateTab("scan");
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "flex";
    };
    const closeOnboarding = () => {
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "none";
    };
    let settingsStatusTimer = null;
    const setSettingsActionStatus = text => {
      const status = document.getElementById("stch-settings-action-status");
      if (!status) return;
      status.textContent = text;
      if (settingsStatusTimer) clearTimeout(settingsStatusTimer);
      settingsStatusTimer = text
        ? setTimeout(() => { status.textContent = ""; }, 3500)
        : null;
    };
    const createBackupText = () => serializeDataBackup(
      createDataBackup((key, fallback) => GM_getValue(key, fallback))
    );
    const exportBackupFile = async event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      try {
        const text = createBackupText();
        const fileName = getDataBackupFileName();
        const picker = window.showSaveFilePicker;
        if (typeof picker === "function") {
          try {
            const handle = await picker.call(window, {
              suggestedName: fileName,
              types: [{
                description: "Steam 卡牌助手备份",
                accept: { "application/json": [".json"] },
              }],
            });
            const writable = await handle.createWritable();
            await writable.write(text);
            await writable.close();
            setSettingsActionStatus("已导出");
            return;
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            console.warn("[STCH] File picker unavailable; falling back to download:", error);
          }
        }

        const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setSettingsActionStatus("已导出");
      } catch (error) {
        if (error?.name === "AbortError") {
          setSettingsActionStatus("已取消导出");
          return;
        }
        setSettingsActionStatus(`导出失败：${error?.message || error}`);
      }
    };
    const importBackupData = async event => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (isSharedActionBusy() || state.sidebarPriceRefreshing) {
        setSettingsActionStatus("请先停止当前操作，再导入数据");
        return;
      }
      try {
        const backup = parseDataBackup(await file.text());
        const count = Object.keys(backup.storage).length;
        if (!confirm(`将覆盖本机 ${count} 项设置与缓存，确定导入？`)) return;
        const result = restoreDataBackup(backup, {
          getValue: (key, fallback) => GM_getValue(key, fallback),
          setValue: (key, value) => GM_setValue(key, value),
        });
        setSettingsActionStatus(`已导入 ${result.restored} 项数据，请刷新页面`);
      } catch (error) {
        setSettingsActionStatus(`导入失败：${error?.message || error}`);
      }
    };
    document.getElementById("stch-currency-fallback")?.addEventListener("change", event => {
      const input = event.currentTarget;
      const previousConfiguredId = Number(state.cfg.currencyId || DEFAULT_CONFIG.currencyId);
      if (isSharedActionBusy()) {
        input.value = String(previousConfiguredId);
        setSettingsActionStatus("请先停止当前操作，再修改回退币种");
        return;
      }

      const currencyId = Number(input.value);
      if (![1, 23, 29].includes(currencyId)) {
        input.value = String(previousConfiguredId);
        setSettingsActionStatus("不支持的回退币种");
        return;
      }

      state.cfg.currencyId = currencyId;
      saveConfig(state.cfg);
      const activeChanged = applyConfiguredCurrency(currencyId);
      if (!activeChanged) {
        setSettingsActionStatus(
          `回退币种已保存；当前仍使用 ${getCurrencyDisplayStatus()}`
        );
        return;
      }

      modal.remove();
      document.getElementById("stch-backdrop")?.remove();
      modalEl = null;
      buildModal({ initialTab: "settings", suppressOnboarding: true });
      const status = document.getElementById("stch-settings-action-status");
      if (status) status.textContent = `已切换到 ${getCurrencyDisplayStatus()}，请重新查价`;
      if (document.getElementById("stch-sidebar")) {
        void refreshSidebarData().catch(error => {
          console.warn("[STCH] Sidebar refresh after currency change failed:", error);
        });
      }
    });
    const clearCachedOrders = event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const cachedCount = readRawOrderCache().length;
      if (cachedCount === 0) {
        clearOrderCache();
        renderOrderResults();
        updateAllActionStates();
        setSettingsActionStatus("订购缓存为空");
        return;
      }
      if (!confirm(`将移除 ${cachedCount} 项订购卡牌缓存，确定？`)) return;
      clearOrderCache();
      renderOrderResults();
      updateAllActionStates();
      setSettingsActionStatus(`已移除 ${cachedCount} 项缓存`);
    };
    const restoreDefaultSettings = event => {
      if (
        event.currentTarget.classList.contains("disabled")
        || isSharedActionBusy()
        || state.sidebarPriceRefreshing
      ) {
        setSettingsActionStatus("请先停止当前操作，再恢复默认设置");
        updateAllActionStates();
        return;
      }
      if (!confirm("将恢复所有设置项为默认值。游戏/AppID黑名单和订购缓存会保留，确定？")) return;
      const preservedKeys = [
        "blacklist",
        "blacklistNames",
        "blacklistSources",
        "blacklistDates",
        "blacklistFixed",
        "blacklistPriceData",
      ];
      const preserved = Object.fromEntries(
        preservedKeys.map(key => [key, state.cfg[key] ?? DEFAULT_CONFIG[key]])
      );
      state.cfg = { ...DEFAULT_CONFIG, ...preserved };
      saveConfig(state.cfg);
      applyConfiguredCurrency(state.cfg.currencyId);

      modal.remove();
      document.getElementById("stch-backdrop")?.remove();
      modalEl = null;
      buildModal({ initialTab: "settings", suppressOnboarding: true });
      const status = document.getElementById("stch-settings-action-status");
      if (status) status.textContent = "已恢复默认设定";
    };

    // Tab switching
    modal.querySelectorAll(".stch-tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.tab);
      });
    });

    document.getElementById("stch-onboarding-close").addEventListener("click", closeOnboarding);
    document.getElementById("stch-onboarding-open")?.addEventListener("click", showOnboarding);
    document.getElementById("stch-settings-import-data")?.addEventListener("click", () => {
      document.getElementById("stch-settings-import-file")?.click();
    });
    document.getElementById("stch-settings-export-data")?.addEventListener("click", exportBackupFile);
    document.getElementById("stch-settings-import-file")?.addEventListener("change", importBackupData);
    document.getElementById("stch-settings-clear-cache")?.addEventListener("click", clearCachedOrders);
    document.getElementById("stch-settings-reset")?.addEventListener("click", restoreDefaultSettings);
    document.getElementById("stch-scan-btn").addEventListener("click", startScan);
    document.getElementById("stch-stop-btn").addEventListener("click", requestStop);
    document.getElementById("stch-skip-btn").addEventListener("click", skipCurrentBadge);
    document.getElementById("stch-recalculate-btn").addEventListener("click", recalculateSelectedResults);
    document.getElementById("stch-submit-orders-btn").addEventListener("click", submitSelectedBuyOrders);
    document.getElementById("stch-order-add-btn").addEventListener("click", addManualOrderAppid);
    document.getElementById("stch-order-recalculate-btn").addEventListener("click", recalculateSelectedOrderResults);
    document.getElementById("stch-order-submit-orders-btn").addEventListener("click", async () => {
      await submitSelectedOrderBuyOrders();
      renderOrderResults();
    });
    initActiveBuyOrdersUi();
    document.getElementById("stch-craft-scan-btn").addEventListener("click", startCraftScan);
    document.getElementById("stch-craft-stop-btn").addEventListener("click", requestCraftStop);
    document.getElementById("stch-craft-one-btn").addEventListener("click", () => setAllCraftCounts("one"));
    document.getElementById("stch-craft-max-btn").addEventListener("click", () => setAllCraftCounts("max"));
    document.getElementById("stch-craft-clear-btn").addEventListener("click", () => setAllCraftCounts("clear"));
    document.getElementById("stch-craft-submit-btn").addEventListener("click", submitCraftPlan);
    let processingBatchStopped = false;
    document.getElementById("stch-surplus-scan-btn").addEventListener("click", async event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const mode = getSurplusItemMode();
      processingBatchStopped = false;
      if (processingModeIncludesCards(mode) && processingModeIncludesDecorations(mode)) {
        state.grindResults = [];
        state.selectedGrindResults = new Set();
        state.grindGemPrice = null;
        renderGrindResults();
      }
      const inventorySnapshot = processingModeIncludesCards(mode) && processingModeIncludesDecorations(mode)
        ? {} : undefined;
      if (processingModeIncludesCards(mode)) await startSurplusScan({ inventorySnapshot });
      if (!processingBatchStopped && processingModeIncludesDecorations(mode)) {
        await startGrindScan({ inventorySnapshot, preserveLog: processingModeIncludesCards(mode) });
      }
    });
    document.getElementById("stch-surplus-stop-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      processingBatchStopped = true;
      if (state.surplusScanning) requestSurplusStop();
      else if (state.grindScanning) requestGrindStop();
    });
    document.getElementById("stch-surplus-select-all-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const mode = getSurplusItemMode();
      const list = document.getElementById("stch-processing-list");
      const tiles = list ? [...list.querySelectorAll(".stch-inv-tile")] : [];
      const allSelected = tiles.length > 0 && tiles.every(tile => tile.classList.contains("selected"));
      if (processingModeIncludesCards(mode)) setAllVisibleSurplusSelection(!allSelected);
      if (processingModeIncludesDecorations(mode)) setAllVisibleGrindSelection(!allSelected);
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-sell-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingSell();
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-collect-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      collectSelectedProcessingItems();
    });
    document.getElementById("stch-surplus-gem-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingGems();
      updateAllActionStates();
    });
    document.getElementById("stch-collection-select-all").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const total = state.itemCollectionItems?.length || 0;
      const selected = state.selectedItemCollection?.size || 0;
      setAllItemCollectionSelection(!(total > 0 && selected === total));
    });
    document.getElementById("stch-collection-remove").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      removeSelectedCollectionItems();
    });
    const syncCraftMaxPages = event => {
      state.cfg.maxBadgePages = Math.max(
        1,
        parseInt(event.target.value, 10) || DEFAULT_CONFIG.maxBadgePages
      );
      const scanMaxPages = document.getElementById("stch-max-pages");
      if (scanMaxPages) scanMaxPages.value = String(state.cfg.maxBadgePages);
      saveConfig(state.cfg);
    };
    const craftMaxPagesInput = document.getElementById("stch-craft-max-pages");
    craftMaxPagesInput.addEventListener("input", syncCraftMaxPages);
    craftMaxPagesInput.addEventListener("change", syncCraftMaxPages);

    // Keep the blacklist tab and settings copy on the same persisted values.
    const autoBlacklistEnabledIds = [
      "stch-auto-bl-enabled",
      "stch-settings-auto-bl-enabled",
    ];
    const autoBlacklistThresholdIds = [
      "stch-auto-bl-threshold",
      "stch-settings-auto-bl-threshold",
    ];
    const blacklistExpiryDaysIds = [
      "stch-blacklist-expiry-days",
      "stch-settings-blacklist-expiry-days",
    ];
    const renderAutoBlacklistControls = (exceptId = "") => {
      autoBlacklistEnabledIds.forEach(id => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.checked = !!state.cfg.autoBlackEnabled;
      });
      autoBlacklistThresholdIds.forEach(id => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.value = String(state.cfg.autoBlackThreshold ?? 0);
      });
      blacklistExpiryDaysIds.forEach(id => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.value = String(state.cfg.blacklistExpiryDays);
      });
      const cleanupButton = document.getElementById("stch-bl-cleanup");
      if (cleanupButton) {
        cleanupButton.title = `清理超过 ${state.cfg.blacklistExpiryDays} 天的普通黑名单；固定黑名单不会清理`;
      }
    };
    autoBlacklistEnabledIds.forEach(id => {
      document.getElementById(id)?.addEventListener("change", event => {
        state.cfg.autoBlackEnabled = !!event.currentTarget.checked;
        renderAutoBlacklistControls();
        saveConfig(state.cfg);
      });
    });

    initPriceHistoryUi();
    const syncAutoBlacklistThreshold = (event, normalizeSource = false) => {
      const parsed = parseFloat(event.currentTarget.value);
      state.cfg.autoBlackThreshold = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      renderAutoBlacklistControls(normalizeSource ? "" : event.currentTarget.id);
      saveConfig(state.cfg);
    };
    autoBlacklistThresholdIds.forEach(id => {
      const input = document.getElementById(id);
      input?.addEventListener("input", event => syncAutoBlacklistThreshold(event, false));
      input?.addEventListener("change", event => syncAutoBlacklistThreshold(event, true));
    });
    const syncBlacklistExpiryDays = (event, normalizeSource = false) => {
      const parsed = parseInt(event.currentTarget.value, 10);
      state.cfg.blacklistExpiryDays = Number.isFinite(parsed)
        ? Math.max(1, parsed)
        : DEFAULT_CONFIG.blacklistExpiryDays;
      renderAutoBlacklistControls(normalizeSource ? "" : event.currentTarget.id);
      saveConfig(state.cfg);
    };
    blacklistExpiryDaysIds.forEach(id => {
      const input = document.getElementById(id);
      input?.addEventListener("input", event => syncBlacklistExpiryDays(event, false));
      input?.addEventListener("change", event => syncBlacklistExpiryDays(event, true));
    });
    renderAutoBlacklistControls();

    applyScanModeTheme();

    if (!options.suppressOnboarding && !GM_getValue(ONBOARDING_SEEN_KEY, false)) {
      showOnboarding();
    }

    // Game/AppID blacklist tab
    // Source: 0 = 手动 (manual query+add), 1 = 自动 (auto threshold during scan)
    // Fixed:  0 = 普通游戏黑名单,       1 = 固定游戏黑名单 (permanent, ignored by cleanup)
    // Days:   computed from stored Date.now() timestamp, 0 = today

    document.getElementById("stch-bl-lookup").addEventListener("click", () => {
      const appid = document.getElementById("stch-bl-appid").value.trim();
      if (!appid || !/^\d+$/.test(appid)) {
        document.getElementById("stch-bl-result").textContent = "请输入有效的 AppID";
        return;
      }
      document.getElementById("stch-bl-result").textContent = "查询中...";
      lookupGameName(appid).then(name => {
        state.blLookupAppid = appid;
        state.blLookupName = name;
        document.getElementById("stch-bl-result").textContent = name ? `${appid} — ${name}` : "未找到该游戏";
        updateBlRow();
      });
    });

    document.getElementById("stch-bl-add").addEventListener("click", () => {
      if (!state.blLookupAppid || !state.blLookupName) return;
      const result = addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 0);
      if (!result.ok) return;
      document.getElementById("stch-bl-result").textContent = `${state.blLookupName} 已加入游戏黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      state.blLookupAppid = "";
      state.blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-add-fixed").addEventListener("click", () => {
      if (!state.blLookupAppid || !state.blLookupName) return;
      const result = addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 1);
      if (!result.ok) return;
      document.getElementById("stch-bl-result").textContent = `${state.blLookupName} 已加入固定游戏黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      state.blLookupAppid = "";
      state.blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-del-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      const result = removeBlacklistEntries(allCbs.map(cb => cb.dataset.appid));
      if (!result.ok) return;
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-fix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      const result = setBlacklistEntriesFixed(allCbs.map(cb => cb.dataset.appid), true);
      if (!result.ok) return;
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-unfix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      const result = setBlacklistEntriesFixed(allCbs.map(cb => cb.dataset.appid), false);
      if (!result.ok) return;
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-cleanup").addEventListener("click", () => {
      const expiryDays = Math.max(
        1,
        Number(state.cfg.blacklistExpiryDays) || DEFAULT_CONFIG.blacklistExpiryDays
      );
      const preview = findExpiredBlacklistEntries(expiryDays);
      if (!preview.ok) {
        renderBlacklist();
        return;
      }
      const expired = preview.appids;
      if (expired.length === 0) {
        document.getElementById("stch-bl-result").textContent = "没有可清理的过期项";
        return;
      }
      if (!confirm(`将清理 ${expired.length} 项过期（>${expiryDays}天）游戏黑名单，确定？`)) return;
      const result = removeBlacklistEntries(expired);
      if (!result.ok) return;
      document.getElementById("stch-bl-result").textContent = `已清理 ${expired.length} 项`;
      renderBlacklist();
    });

    renderBlacklist();
    applySurplusItemMode();
    renderItemCollection();
    pruneOrderCache(true);
    renderOrderResults();
    renderResults();
    updateAllActionStates();
  }

  export function closeModal() {
    stopPriceHistoryRefresh({ silent: true });
    const backdrop = document.getElementById("stch-backdrop");
    if (backdrop) backdrop.style.display = "none";
    if (modalEl) modalEl.style.display = "none";
  }
