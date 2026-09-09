import { state } from "../state.js";
import { AUTOMATIC_PRICE_STRATEGY_CONFIG, SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG, DEFAULT_CONFIG, saveConfig } from "../config.js";
import { createCurrencyContext, getActiveCurrencyContext, setActiveCurrencyContext } from "../services/currency.js";
import { clearOrderCache, loadOrderCache, pruneOrderCache, readRawOrderCache } from "../services/order-cache.js";
import { createDataBackup, getDataBackupFileName, parseDataBackup, restoreDataBackup, serializeDataBackup } from "../services/data-backup.js";
import { normalizeHexColor, normalizeTabColors } from "../services/tab-preferences.js";
import { resetActiveBuyOrdersRuntime } from "../features/active-orders.js";
import { resetPriceHistoryRuntime } from "../features/price-history.js";
import { renderCraftResults } from "../features/craft.js";
import { renderSurplusResults } from "../features/surplus.js";
import { renderGrindResults } from "../features/grind.js";
import { refreshSidebarData, setSidebarEnabled } from "../sidebar/sidebar.js";
import { applyTabColors } from "./tab-drag.js";
import { applyScanModeTheme } from "./scan-controls.js";
import { renderOrderResults, updateResultColumns, updateOrderResultColumns, updateSummary, updateOrderSummary } from "./render.js";
import { isSharedActionBusy, updateAllActionStates } from "./action-state.js";

function getCurrencySourceLabel(context) {
  if (context?.source === "walletInfo") return "Steam 钱包识别";
  if (context?.source === "application_config") return "Steam 页面钱包识别";
  if (context?.source === "page") return "市场页面识别";
  if (context?.isFallback || context?.source === "configured") return "用户设置回退";
  return "未识别";
}

export function getCurrencyDisplayStatus(context = getActiveCurrencyContext()) {
  if (!context?.currencyId) return "未识别币种";
  return `${context.code} (${context.symbol}) · ${getCurrencySourceLabel(context)}`
    + `${context.verified ? "" : " · 格式/费用规则未验证"}`;
}

export const AUTOMATIC_STRATEGY_SETTING_ROWS = [AUTOMATIC_PRICE_STRATEGY_CONFIG, SELL_AUTOMATIC_PRICE_STRATEGY_CONFIG].map(config => Object.entries(config).map(([id, fields]) => ({
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

export function bindSettingsControls(modal, { applySurplusItemMode, rebuildModal }) {
  const tabsContainer = modal.querySelector(".stch-tabs");
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

    rebuildModal();
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

    rebuildModal();
    const status = document.getElementById("stch-settings-action-status");
    if (status) status.textContent = "已恢复默认设定";
  };

  document.getElementById("stch-settings-import-data")?.addEventListener("click", () => {
    document.getElementById("stch-settings-import-file")?.click();
  });
  document.getElementById("stch-settings-export-data")?.addEventListener("click", exportBackupFile);
  document.getElementById("stch-settings-import-file")?.addEventListener("change", importBackupData);
  document.getElementById("stch-settings-clear-cache")?.addEventListener("click", clearCachedOrders);
  document.getElementById("stch-settings-reset")?.addEventListener("click", restoreDefaultSettings);
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

}
