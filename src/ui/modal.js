import { state } from "../state.js";

import { saveConfig, DEFAULT_CONFIG } from "../config.js";

import { SEASONAL_BADGE_NAME, SEASONAL_BADGE_MAX_LEVEL, ONBOARDING_SEEN_KEY } from "../constants.js";

import { formatCNY } from "../utils/format.js";

import { isPointsShopPage } from "../utils/steam.js";

import { startScan, requestStop, skipCurrentBadge, applyScanModeTheme, updateResultColumns } from "../features/scan.js";

import { recalculateSelectedResults, recalculateSelectedOrderResults } from "../features/recalculate.js";

import { submitSelectedBuyOrders, submitSelectedOrderBuyOrders, addManualOrderAppid, deleteExpiredOrderResults } from "../features/orders.js";

import { startCraftScan, requestCraftStop, setAllCraftCounts, submitCraftPlan, renderCraftResults, updateCraftActionState, updateCraftSummary } from "../features/craft.js";

import { startSeasonalPurchase, requestSeasonalStop, normalizeSeasonalInputs, updateSeasonalSummary, updateSeasonalActionState } from "../features/seasonal.js";

import { startSurplusScan, requestSurplusStop, renderSurplusResults, updateSurplusActionState, setAllVisibleSurplusSelection } from "../features/surplus.js";

import { startGrindScan, requestGrindStop, renderGrindResults, updateGrindActionState, setAllVisibleGrindSelection } from "../features/grind.js";

import { submitSelectedProcessingSell, submitSelectedProcessingGems } from "../features/item-actions.js";

import { renderBlacklist, updateBlRow, addToBlacklist, lookupGameName } from "../features/blacklist.js";

import { renderResults, renderOrderResults, updateOrderResultColumns } from "./render.js";

import { updateAllActionStates, updateBulkActionState } from "./action-state.js";

import { pruneOrderCache } from "../services/order-cache.js";

  let modalEl = null;

  export function getOuterHeight(element) {
    if (!element || getComputedStyle(element).display === "none") return 0;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
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

  export function buildModal() {
    const seasonalOnly = isPointsShopPage();
    const initialTab = seasonalOnly ? "seasonal" : "scan";
    const activeClass = tabName => initialTab === tabName ? "active" : "";
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
          ${seasonalOnly ? `
          <span class="stch-tab ${activeClass("seasonal")}" data-tab="seasonal">季节徽章</span>
          ` : `
          <span class="stch-tab ${activeClass("scan")}" data-tab="scan">卡牌价格扫描</span>
          <span class="stch-tab" data-tab="orders">订购卡牌</span>
          <span class="stch-tab" data-tab="craft">徽章合成</span>
          <span class="stch-tab" data-tab="blacklist">游戏/AppID黑名单</span>
          <span class="stch-tab" data-tab="surplus">多余物品处理</span>
          <span class="stch-tab stch-tab-right" data-tab="settings">设置</span>
          `}
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
              在售最低通常更快成交，平均价格用于参考，求购最高通常需要等待卖家成交。买价调整可正可负。
            </div>
            <div class="stch-onboarding-step">
              <b>4. 批量合成徽章</b>
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
            <label class="stch-primary-label">单套卡牌价格上限 ¥ <input id="stch-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.threshold}"></label>
            <label class="stch-primary-label" id="stch-buy-mode-label">购买卡牌逻辑 <select id="stch-buy-mode" class="stch-input" style="width:110px">
              <option value="complete1" ${state.cfg.buyMode === "complete1" ? "selected" : ""}>补全单套</option>
              <option value="complete5" ${state.cfg.buyMode === "complete5" ? "selected" : ""}>补至五级</option>
              <option value="buy1" ${state.cfg.buyMode === "buy1" ? "selected" : ""}>购买单套</option>
              <option value="buy5" ${state.cfg.buyMode === "buy5" ? "selected" : ""}>购买五套</option>
            </select></label>
            <label>最大徽章页数 <input id="stch-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <label>
              <input id="stch-include-drops" type="checkbox" ${state.cfg.includeDrops ? "checked" : ""}>
              包含有掉落卡牌的游戏
            </label>
            <label class="stch-foil-mode-label ${state.cfg.foilScanMode ? "active" : ""}" id="stch-foil-mode-label">
              <input id="stch-foil-scan-mode" type="checkbox" ${state.cfg.foilScanMode ? "checked" : ""}>
              闪卡模式
            </label>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">购买价格
              <span class="stch-help" title="在售最低：当前最低卖单价格，通常可立即成交&#10;平均价格：Steam 返回的 median_price，用作市场参考价&#10;求购最高：当前最高买单价格，通常需要等待卖家成交&#10;仅用于自动提交长期订购单；手动购买仍使用在售最低">?</span>
              <select id="stch-order-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.orderPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.orderPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.orderPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">买价调整 ¥ <input id="stch-price-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.priceAdjustment}" style="width:68px"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-scan-btn">开始扫描</div>
            <div class="stch-btn alt disabled" id="stch-stop-btn">停止</div>
            <div class="stch-btn alt disabled" id="stch-skip-btn" title="跳过当前徽章">跳过当前</div>
            <div class="stch-bulk-actions">
              <div class="stch-btn alt disabled" id="stch-recalculate-btn">重新计算</div>
              <div class="stch-btn disabled" id="stch-submit-orders-btn">提交订购单</div>
            </div>
          </div>
          <div class="stch-progress" id="stch-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-progress-text">0/0</div>
          </div>
          <div class="stch-summary" id="stch-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-summary"></span>
            <span class="stch-selected-count" id="stch-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-status"></div>
          <div class="stch-game-list" id="stch-list"></div>
          <div class="stch-log-resizer" data-log="stch-log" data-content="stch-list" title="上下拖动调整日志区域"></div>
          <div id="stch-log"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-orders">
          <div class="stch-toolbar">
            <label class="stch-primary-label">手动 AppID <input id="stch-order-appid" class="stch-input" type="text" style="width:100px" placeholder="4761370"></label>
            <label class="stch-foil-mode-label" id="stch-order-manual-foil-label">
              <input id="stch-order-manual-foil" type="checkbox">
              闪卡
            </label>
            <div class="stch-btn alt" id="stch-order-add-btn">读取并加入</div>
            <div class="stch-btn alt disabled" id="stch-order-recalculate-btn">重新计算</div>
            <div class="stch-btn disabled" id="stch-order-submit-orders-btn">提交订购单</div>
            <div class="stch-btn alt stch-btn-danger disabled stch-order-tools" id="stch-order-delete-btn">删除过期</div>
          </div>
          <div class="stch-summary" id="stch-order-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-order-summary"></span>
            <span class="stch-selected-count" id="stch-order-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-order-status" style="display:none"></div>
          <div class="stch-game-list stch-order-page-list" id="stch-order-list"></div>
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
            <span style="color:#8f98a0;font-size:12px;">扫描“进行中”页面里已经收集齐全、可立即合成的徽章</span>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-craft-scan-btn">扫描可合成徽章</div>
            <div class="stch-btn alt disabled" id="stch-craft-stop-btn">停止</div>
            <div class="stch-craft-actions">
              <div class="stch-btn alt disabled" id="stch-craft-one-btn">全部 1 次</div>
              <div class="stch-btn alt disabled" id="stch-craft-max-btn">全部最大</div>
              <div class="stch-btn alt disabled" id="stch-craft-clear-btn">全部清零</div>
              <div class="stch-btn disabled" id="stch-craft-submit-btn">确认合成</div>
            </div>
          </div>
          <div class="stch-progress" id="stch-craft-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-craft-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-craft-progress-text">0/0</div>
          </div>
          <div class="stch-summary" id="stch-craft-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-craft-summary"></span>
          </div>
          <div class="stch-status-text" id="stch-craft-status"></div>
          <div class="stch-game-list stch-craft-list" id="stch-craft-list"></div>
          <div class="stch-log-resizer" data-log="stch-craft-log" data-content="stch-craft-list" title="上下拖动调整日志区域"></div>
          <div id="stch-craft-log"></div>
        </div>
        <div class="stch-tab-content ${activeClass("seasonal")}" id="stch-tab-seasonal">
          <div class="stch-toolbar">
            <label class="stch-primary-label">目标等级 <input id="stch-seasonal-target" class="stch-input" type="number" min="1" max="${SEASONAL_BADGE_MAX_LEVEL}" step="1" value="${state.cfg.seasonalTargetLevel}" style="width:56px"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-seasonal-buy-btn">开始购买</div>
            <div class="stch-btn alt disabled" id="stch-seasonal-stop-btn">停止</div>
          </div>
          <div class="stch-progress" id="stch-seasonal-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-seasonal-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-seasonal-progress-text">0/0</div>
          </div>
          <div class="stch-seasonal-panel" id="stch-seasonal-summary">
            2026 夏季徽章
          </div>
          <div class="stch-status-text" id="stch-seasonal-status"></div>
          <div class="stch-log-resizer" data-log="stch-seasonal-log" title="上下拖动调整日志区域"></div>
          <div id="stch-seasonal-log"></div>
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
            <label>
              <input id="stch-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动游戏黑名单
            </label>
            <label class="stch-primary-label">价格上限 ¥ <input id="stch-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <span style="color:#8f98a0;font-size:12px;">扫描时超过此价格的游戏会自动加入游戏/AppID黑名单</span>
          </div>
          <div class="stch-bl-list" id="stch-bl-list"></div>
          <div class="stch-bl-list" id="stch-bl-list-fixed" style="max-height:100px;margin-top:8px;"></div>
          <div class="stch-bl-count" id="stch-bl-count"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-surplus">
          <div class="stch-toolbar stch-surplus-main-toolbar">
            <label class="stch-primary-label">处理类型
              <select id="stch-surplus-item-mode" class="stch-input" style="width:92px">
                <option value="card" ${state.cfg.surplusItemMode === "card" ? "selected" : ""}>卡牌</option>
                <option value="background" ${state.cfg.surplusItemMode === "background" ? "selected" : ""}>背景</option>
                <option value="emoticon" ${state.cfg.surplusItemMode === "emoticon" ? "selected" : ""}>表情</option>
              </select>
            </label>
            <label class="stch-card-only-control">
              <input id="stch-surplus-only-maxed" type="checkbox" ${state.cfg.surplusOnlyMaxed ? "checked" : ""}>
              只显示当前已满级徽章
            </label>
            <span class="stch-card-only-control" style="color:#8f98a0;font-size:12px;">默认计算升满后仍会剩余的卡牌</span>
          </div>
          <div class="stch-scan-actions stch-surplus-action-row">
            <label class="stch-primary-label">出售价格
              <span class="stch-help" title="在售最低：当前最低卖单价格&#10;平均价格：Steam 返回的 median_price&#10;求购最高：当前最高买单价格&#10;提交出售时会换算为 Steam 接口需要的卖家到手价">?</span>
              <select id="stch-surplus-sell-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.surplusSellPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.surplusSellPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.surplusSellPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">售价调整 ¥ <input id="stch-surplus-sell-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.surplusSellPriceAdjustment}" style="width:68px"></label>
            <div class="stch-surplus-action-spacer"></div>
            <div class="stch-btn alt disabled" id="stch-surplus-select-all-btn">全选</div>
            <span class="stch-selected-count stch-processing-selected-count" id="stch-surplus-selected-count">已选择 0 项</span>
            <div class="stch-surplus-action-buttons">
              <div class="stch-btn alt disabled" id="stch-surplus-sell-btn" title="按所选价格源提交 Steam 市场出售请求">出售</div>
              <div class="stch-btn stch-btn-danger disabled" id="stch-surplus-gem-btn" title="读取 Steam 当前宝石值后提交转化宝石请求">转化宝石</div>
            </div>
          </div>
          <div class="stch-surplus-mode-panel" id="stch-surplus-card-panel">
            <div class="stch-scan-actions">
              <div class="stch-btn" id="stch-surplus-scan-btn">开始检测</div>
              <div class="stch-btn alt disabled" id="stch-surplus-stop-btn">停止</div>
            </div>
            <div class="stch-progress" id="stch-surplus-progress-wrap" style="display:none">
              <div class="stch-progress-bar" id="stch-surplus-progress-bar" style="width:0"></div>
              <div class="stch-progress-text" id="stch-surplus-progress-text">0/0</div>
            </div>
            <div class="stch-summary" id="stch-surplus-summary-row" style="display:none">
              <span class="stch-summary-text" id="stch-surplus-summary"></span>
            </div>
            <div class="stch-status-text" id="stch-surplus-status"></div>
            <div class="stch-game-list stch-surplus-list" id="stch-surplus-list"></div>
            <div class="stch-log-resizer" data-log="stch-surplus-log" data-content="stch-surplus-list" title="上下拖动调整日志区域"></div>
            <div id="stch-surplus-log"></div>
          </div>
          <div class="stch-surplus-mode-panel" id="stch-surplus-grind-panel">
            <div class="stch-toolbar">
              <label>
                <input id="stch-grind-only-recommended" type="checkbox" ${state.cfg.grindOnlyRecommended ? "checked" : ""}>
                只显示建议分解
              </label>
              <span style="color:#8f98a0;font-size:12px;">扫描后可选择出售或转化宝石，提交前会显示确认窗口</span>
            </div>
            <div class="stch-scan-actions">
              <div class="stch-btn" id="stch-grind-scan-btn">扫描可分解物品</div>
              <div class="stch-btn alt disabled" id="stch-grind-stop-btn">停止</div>
            </div>
            <div class="stch-progress" id="stch-grind-progress-wrap" style="display:none">
              <div class="stch-progress-bar" id="stch-grind-progress-bar" style="width:0"></div>
              <div class="stch-progress-text" id="stch-grind-progress-text">0/0</div>
            </div>
            <div class="stch-summary" id="stch-grind-summary-row" style="display:none">
              <span class="stch-summary-text" id="stch-grind-summary"></span>
            </div>
            <div class="stch-status-text" id="stch-grind-status"></div>
            <div class="stch-game-list stch-grind-list" id="stch-grind-list"></div>
            <div class="stch-log-resizer" data-log="stch-grind-log" data-content="stch-grind-list" title="上下拖动调整日志区域"></div>
            <div id="stch-grind-log"></div>
          </div>
        </div>
        <div class="stch-tab-content" id="stch-tab-settings">
          <div style="color:#fff;font-weight:bold;font-size:16px;margin-bottom:4px;">卡牌价格扫描</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>priceoverview请求间隔 <input id="stch-req-interval" class="stch-input" type="number" min="100" step="10" value="${state.cfg.requestInterval}" style="width:70px"> ms</label>
            <label>gamecard请求间隔 <input id="stch-scan-interval" class="stch-input" type="number" min="0" step="100" value="${state.cfg.scanInterval}"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label>每 <input id="stch-batch-size" class="stch-input" type="number" min="5" step="1" value="${state.cfg.batchSize}" style="width:55px"> 次priceoverview请求后暂停</label>
            <label><input id="stch-batch-pause" class="stch-input" type="number" min="500" step="500" value="${state.cfg.batchPause}" style="width:75px"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label><input id="stch-early-price-prediction" type="checkbox" ${state.cfg.earlyPricePrediction ? "checked" : ""}> 价格预测提早跳过</label>
            <span style="color:#8f98a0;font-size:12px;">扫描部分卡牌后保守预测全套价格，超过上限时提前跳过</span>
          </div>
          <div class="stch-toolbar">
            <label>订购卡牌缓存 <input id="stch-order-cache-days" class="stch-input" type="number" min="0" step="1" value="${state.cfg.orderCacheDays}" style="width:55px"> 天</label>
            <label><input id="stch-skip-cached-orders" type="checkbox" ${state.cfg.skipCachedOrderResults ? "checked" : ""}> 扫描时跳过缓存内结果</label>
            <span style="color:#8f98a0;font-size:12px;">缓存超期会自动删除；天数显示与黑名单一致，0 为今天</span>
          </div>
          <div style="color:#8f98a0;font-size:12px;margin-top:4px;">默认值为作者测试稳定配置 (330ms / 53s)。如遇 429 可调高 100ms / 5s。gamecard 通常不需要调整，保持 0 即可。</div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">徽章合成</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>每次合成请求间隔 <input id="stch-craft-interval" class="stch-input" type="number" min="200" step="100" value="${state.cfg.craftInterval}" style="width:70px"> ms</label>
            <span style="color:#8f98a0;font-size:12px;">逐级升级按每一级等待；一次升满按每个徽章等待</span>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">使用说明</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <div class="stch-btn alt" id="stch-onboarding-open">重新查看使用说明</div>
          </div>
        </div>
      </div>
      <div class="stch-footer">
        <span class="stch-label">V2.0.0 · 默认货币：人民币(CNY)</span>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;
    initLogResizers(modal);

    modal.querySelector(".stch-close").addEventListener("click", closeModal);

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
      return ["card", "background", "emoticon"].includes(value) ? value : "card";
    };
    const applySurplusItemMode = () => {
      const mode = getSurplusItemMode();
      const cardPanel = document.getElementById("stch-surplus-card-panel");
      const grindPanel = document.getElementById("stch-surplus-grind-panel");
      cardPanel?.classList.toggle("active", mode === "card");
      grindPanel?.classList.toggle("active", mode !== "card");
      modal.querySelectorAll(".stch-card-only-control").forEach(element => {
        element.style.display = mode === "card" ? "" : "none";
      });
      const grindButton = document.getElementById("stch-grind-scan-btn");
      if (grindButton) {
        grindButton.textContent = mode === "emoticon"
          ? "扫描可分解表情"
          : "扫描可分解背景";
      }
      renderSurplusResults();
      renderGrindResults();
      updateSurplusActionState();
      updateGrindActionState();
    };
    const syncConfigFromInputs = changedId => {
      const previousSurplusItemMode = state.cfg.surplusItemMode || DEFAULT_CONFIG.surplusItemMode;
      state.cfg.threshold = readNumberInput(
        "stch-threshold",
        state.cfg.threshold ?? DEFAULT_CONFIG.threshold,
        { min: 0 }
      );
      state.cfg.scanInterval = readNumberInput(
        "stch-scan-interval",
        state.cfg.scanInterval ?? DEFAULT_CONFIG.scanInterval,
        { integer: true, min: 0 }
      );
      state.cfg.requestInterval = readNumberInput(
        "stch-req-interval",
        state.cfg.requestInterval ?? DEFAULT_CONFIG.requestInterval,
        { integer: true, min: 0 }
      );
      state.cfg.maxBadgePages = readNumberInput(
        "stch-max-pages",
        state.cfg.maxBadgePages ?? DEFAULT_CONFIG.maxBadgePages,
        { integer: true, min: 1 }
      );
      state.cfg.includeDrops = !!document.getElementById("stch-include-drops")?.checked;
      state.cfg.foilScanMode = !!document.getElementById("stch-foil-scan-mode")?.checked;
      state.cfg.batchSize = readNumberInput(
        "stch-batch-size",
        state.cfg.batchSize ?? DEFAULT_CONFIG.batchSize,
        { integer: true, min: 1 }
      );
      state.cfg.batchPause = readNumberInput(
        "stch-batch-pause",
        state.cfg.batchPause ?? DEFAULT_CONFIG.batchPause,
        { integer: true, min: 0 }
      );
      const buyModeEl = document.getElementById("stch-buy-mode");
      if (state.cfg.foilScanMode) {
        state.cfg.buyMode = buyModeEl?.dataset.normalValue || state.cfg.buyMode || DEFAULT_CONFIG.buyMode;
      } else {
        state.cfg.buyMode = buyModeEl?.dataset.normalValue || buyModeEl?.value || state.cfg.buyMode;
        if (buyModeEl) delete buyModeEl.dataset.normalValue;
      }
      state.cfg.orderPriceSource = document.getElementById("stch-order-price-source")?.value
        || state.cfg.orderPriceSource;
      state.cfg.priceAdjustment = readNumberInput(
        "stch-price-adjustment",
        state.cfg.priceAdjustment ?? DEFAULT_CONFIG.priceAdjustment
      );
      state.cfg.earlyPricePrediction = !!document.getElementById("stch-early-price-prediction")?.checked;
      state.cfg.orderCacheDays = readNumberInput(
        "stch-order-cache-days",
        state.cfg.orderCacheDays ?? DEFAULT_CONFIG.orderCacheDays,
        { integer: true, min: 0 }
      );
      state.cfg.skipCachedOrderResults = !!document.getElementById("stch-skip-cached-orders")?.checked;
      state.cfg.surplusOnlyMaxed = !!document.getElementById("stch-surplus-only-maxed")?.checked;
      state.cfg.surplusItemMode = getSurplusItemMode();
      state.cfg.surplusSellPriceSource = document.getElementById("stch-surplus-sell-price-source")?.value
        || state.cfg.surplusSellPriceSource
        || DEFAULT_CONFIG.surplusSellPriceSource;
      state.cfg.surplusSellPriceAdjustment = readNumberInput(
        "stch-surplus-sell-adjustment",
        state.cfg.surplusSellPriceAdjustment ?? DEFAULT_CONFIG.surplusSellPriceAdjustment
      );
      state.cfg.grindOnlyRecommended = !!document.getElementById("stch-grind-only-recommended")?.checked;
      const includeSurplusCards = document.getElementById("stch-grind-include-surplus-cards");
      if (includeSurplusCards) {
        state.cfg.grindIncludeSurplusCards = !!includeSurplusCards.checked;
      }
      state.cfg.craftInterval = readNumberInput(
        "stch-craft-interval",
        state.cfg.craftInterval ?? DEFAULT_CONFIG.craftInterval,
        { integer: true, min: 200 }
      );
      state.cfg.craftMode = document.getElementById("stch-craft-mode")?.value || state.cfg.craftMode;
      state.cfg.seasonalTargetLevel = readNumberInput(
        "stch-seasonal-target",
        state.cfg.seasonalTargetLevel ?? DEFAULT_CONFIG.seasonalTargetLevel,
        { integer: true, min: 1, max: SEASONAL_BADGE_MAX_LEVEL }
      );
      saveConfig(state.cfg);
      const craftMaxPages = document.getElementById("stch-craft-max-pages");
      if (craftMaxPages) craftMaxPages.value = String(state.cfg.maxBadgePages);
      updateResultColumns();
      applyScanModeTheme();
      if (changedId === "stch-order-cache-days") {
        pruneOrderCache(true);
        renderOrderResults();
      }
      if (changedId === "stch-craft-mode") renderCraftResults();
      if (changedId === "stch-surplus-only-maxed") renderSurplusResults();
      if (changedId === "stch-surplus-item-mode") {
        if (state.cfg.surplusItemMode !== previousSurplusItemMode) {
          state.grindResults = [];
          state.selectedGrindResults = new Set();
          state.grindGemPrice = null;
        }
        applySurplusItemMode();
      }
      if (changedId?.startsWith("stch-grind-")) renderGrindResults();
      if (changedId?.startsWith("stch-seasonal-")) {
        normalizeSeasonalInputs();
        updateSeasonalSummary();
      }
    };
    const cfgIds = ["stch-threshold", "stch-scan-interval",
      "stch-req-interval", "stch-max-pages", "stch-include-drops",
      "stch-foil-scan-mode",
      "stch-batch-size", "stch-batch-pause", "stch-buy-mode",
      "stch-order-price-source", "stch-price-adjustment",
      "stch-early-price-prediction", "stch-order-cache-days",
      "stch-skip-cached-orders", "stch-craft-interval",
      "stch-craft-mode", "stch-seasonal-target", "stch-surplus-item-mode",
      "stch-surplus-only-maxed", "stch-surplus-sell-price-source",
      "stch-surplus-sell-adjustment", "stch-grind-only-recommended",
      "stch-grind-include-surplus-cards"];
    cfgIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => syncConfigFromInputs(id));
      el.addEventListener("change", () => syncConfigFromInputs(id));
    });

    const activateTab = tabName => {
      modal.querySelectorAll(".stch-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
      modal.querySelectorAll(".stch-tab-content").forEach(content => {
        content.classList.toggle("active", content.id === `stch-tab-${tabName}`);
      });
      if (tabName === "blacklist") renderBlacklist();
      if (tabName === "orders") renderOrderResults();
      if (tabName === "surplus") applySurplusItemMode();
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

    // Tab switching
    modal.querySelectorAll(".stch-tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.tab);
      });
    });

    document.getElementById("stch-onboarding-close").addEventListener("click", closeOnboarding);
    document.getElementById("stch-onboarding-open").addEventListener("click", showOnboarding);
    document.getElementById("stch-scan-btn").addEventListener("click", startScan);
    document.getElementById("stch-stop-btn").addEventListener("click", requestStop);
    document.getElementById("stch-skip-btn").addEventListener("click", skipCurrentBadge);
    document.getElementById("stch-recalculate-btn").addEventListener("click", recalculateSelectedResults);
    document.getElementById("stch-submit-orders-btn").addEventListener("click", submitSelectedBuyOrders);
    document.getElementById("stch-order-add-btn").addEventListener("click", addManualOrderAppid);
    document.getElementById("stch-order-recalculate-btn").addEventListener("click", recalculateSelectedOrderResults);
    document.getElementById("stch-order-submit-orders-btn").addEventListener("click", submitSelectedOrderBuyOrders);
    document.getElementById("stch-order-delete-btn").addEventListener("click", deleteExpiredOrderResults);
    document.getElementById("stch-craft-scan-btn").addEventListener("click", startCraftScan);
    document.getElementById("stch-craft-stop-btn").addEventListener("click", requestCraftStop);
    document.getElementById("stch-craft-one-btn").addEventListener("click", () => setAllCraftCounts("one"));
    document.getElementById("stch-craft-max-btn").addEventListener("click", () => setAllCraftCounts("max"));
    document.getElementById("stch-craft-clear-btn").addEventListener("click", () => setAllCraftCounts("clear"));
    document.getElementById("stch-craft-submit-btn").addEventListener("click", submitCraftPlan);
    document.getElementById("stch-seasonal-buy-btn").addEventListener("click", startSeasonalPurchase);
    document.getElementById("stch-seasonal-stop-btn").addEventListener("click", requestSeasonalStop);
    document.getElementById("stch-surplus-scan-btn").addEventListener("click", startSurplusScan);
    document.getElementById("stch-surplus-stop-btn").addEventListener("click", requestSurplusStop);
    document.getElementById("stch-grind-scan-btn").addEventListener("click", startGrindScan);
    document.getElementById("stch-grind-stop-btn").addEventListener("click", requestGrindStop);
    document.getElementById("stch-surplus-select-all-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const mode = getSurplusItemMode();
      const list = document.getElementById(mode === "card" ? "stch-surplus-list" : "stch-grind-list");
      const tiles = list ? [...list.querySelectorAll(".stch-inv-tile")] : [];
      const allSelected = tiles.length > 0 && tiles.every(tile => tile.classList.contains("selected"));
      if (mode === "card") setAllVisibleSurplusSelection(!allSelected);
      else setAllVisibleGrindSelection(!allSelected);
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-sell-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingSell();
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-gem-btn").addEventListener("click", event => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingGems();
      updateAllActionStates();
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

    // Auto blacklist threshold
    const syncAutoBlacklistThreshold = () => {
      state.cfg.autoBlackThreshold = parseFloat(document.getElementById("stch-auto-bl-threshold").value) || 0;
      saveConfig(state.cfg);
    };
    document.getElementById("stch-auto-bl-threshold").addEventListener("input", syncAutoBlacklistThreshold);
    document.getElementById("stch-auto-bl-threshold").addEventListener("change", syncAutoBlacklistThreshold);
    document.getElementById("stch-auto-bl-enabled").addEventListener("change", () => {
      state.cfg.autoBlackEnabled = document.getElementById("stch-auto-bl-enabled").checked;
      saveConfig(state.cfg);
    });

    applyScanModeTheme();

    if (!isPointsShopPage() && !GM_getValue(ONBOARDING_SEEN_KEY, false)) {
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
      addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 0);
      document.getElementById("stch-bl-result").textContent = `${state.blLookupName} 已加入游戏黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      state.blLookupAppid = "";
      state.blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-add-fixed").addEventListener("click", () => {
      if (!state.blLookupAppid || !state.blLookupName) return;
      addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 1);
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
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try { n = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) { n = {}; }
      try { s = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) { s = {}; }
      try { d = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) { d = {}; }
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => {
        const appid = cb.dataset.appid;
        const idx = bl.indexOf(appid);
        if (idx >= 0) bl.splice(idx, 1);
        delete n[appid]; delete s[appid]; delete d[appid]; delete f[appid];
      });
      state.cfg.blacklist = bl.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
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
      let f = {};
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => { f[cb.dataset.appid] = 1; });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
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
      let f = {};
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => { f[cb.dataset.appid] = 0; });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-cleanup").addEventListener("click", () => {
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try { n = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) { n = {}; }
      try { s = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) { s = {}; }
      try { d = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) { d = {}; }
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      const now = Date.now();
      const expired = bl.filter(a => !f[a] && d[a] && (now - d[a] > 7 * 86400000));
      if (expired.length === 0) {
        document.getElementById("stch-bl-result").textContent = "没有可清理的过期项";
        return;
      }
      if (!confirm(`将清理 ${expired.length} 项过期（>7天）游戏黑名单，确定？`)) return;
      const keep = bl.filter(a => !expired.includes(a));
      expired.forEach(a => { delete n[a]; delete s[a]; delete d[a]; delete f[a]; });
      state.cfg.blacklist = keep.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      document.getElementById("stch-bl-result").textContent = `已清理 ${expired.length} 项`;
      renderBlacklist();
    });

    renderBlacklist();
    normalizeSeasonalInputs();
    updateSeasonalActionState();
    updateSeasonalSummary();
    applySurplusItemMode();
    updateSurplusActionState();
    renderSurplusResults();
    updateGrindActionState();
    renderGrindResults();
    pruneOrderCache(true);
    renderOrderResults();
  }

  export function closeModal() {
    const backdrop = document.getElementById("stch-backdrop");
    if (backdrop) backdrop.style.display = "none";
    if (modalEl) modalEl.style.display = "none";
  }
