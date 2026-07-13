import { state } from "../state.js";

import { getSelectedResults, getSelectedOrderResults } from "../services/result-info.js";

import { getExpiredOrderCacheCount } from "../services/order-cache.js";

  function getSurplusProcessingMode() {
    const value = document.getElementById("stch-surplus-item-mode")?.value
      || state.cfg.surplusItemMode
      || "card";
    return ["card", "background", "emoticon"].includes(value) ? value : "card";
  }

  function updateSurplusProcessingActionState() {
    const mode = getSurplusProcessingMode();
    const selectedCount = mode === "card"
      ? (state.selectedSurplusResults?.size || 0)
      : (state.selectedGrindResults?.size || 0);
    const selectedLabel = document.getElementById("stch-surplus-selected-count");
    if (selectedLabel) selectedLabel.textContent = `选择 ${selectedCount} 项`;

    const list = document.getElementById(mode === "card" ? "stch-surplus-list" : "stch-grind-list");
    const visibleTiles = list ? [...list.querySelectorAll(".stch-inv-tile")] : [];
    const selectedVisibleCount = visibleTiles.filter(tile => tile.classList.contains("selected")).length;
    const allVisibleSelected = visibleTiles.length > 0 && selectedVisibleCount === visibleTiles.length;
    const selectAll = document.getElementById("stch-surplus-select-all-btn");
    if (selectAll) {
      selectAll.textContent = allVisibleSelected ? "取消全选" : "全选";
      selectAll.classList.toggle("disabled", visibleTiles.length === 0 || isSharedActionBusy());
    }

    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-surplus-sell-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-surplus-gem-btn")?.classList.toggle("disabled", disabled);
    ["stch-surplus-sell-price-source", "stch-surplus-sell-adjustment"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isSharedActionBusy();
    });
  }

  export function updateCraftActionState() {
    const craftBusy = state.craftScanning || state.craftActionRunning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.historyRefreshing
      || state.surplusActionRunning
      || state.surplusScanning
      || state.grindScanning;
    const hasResults = state.craftResults.length > 0;
    const hasPlan = state.craftResults.some(r => r.selected && r.maxCraftable > 0 && (state.cfg.craftMode === "max" ? r.maxCraftable : (parseInt(r.craftCount,10)||0)) > 0);

    document.getElementById("stch-craft-scan-btn")?.classList.toggle(
      "disabled",
      craftBusy || otherBusy
    );
    document.getElementById("stch-craft-stop-btn")?.classList.toggle(
      "disabled",
      !craftBusy
    );
    ["stch-craft-one-btn", "stch-craft-max-btn", "stch-craft-clear-btn"]
      .forEach(id => {
        const modeDisabled = id === "stch-craft-one-btn"
          && state.cfg.craftMode === "max";
        document.getElementById(id)?.classList.toggle(
          "disabled",
          !hasResults || craftBusy || otherBusy || modeDisabled
        );
      });
    document.getElementById("stch-craft-submit-btn")?.classList.toggle(
      "disabled",
      !hasPlan || craftBusy || otherBusy
    );
    const craftMode = document.getElementById("stch-craft-mode");
    const craftMaxPages = document.getElementById("stch-craft-max-pages");
    if (craftMode) craftMode.disabled = craftBusy || otherBusy;
    if (craftMaxPages) craftMaxPages.disabled = craftBusy || otherBusy;
  }

  export function updateSurplusActionState() {
    const surplusBusy = state.surplusScanning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.historyRefreshing
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusActionRunning
      || state.grindScanning;
    document.getElementById("stch-surplus-scan-btn")?.classList.toggle(
      "disabled",
      surplusBusy || otherBusy
    );
    document.getElementById("stch-surplus-stop-btn")?.classList.toggle(
      "disabled",
      !surplusBusy
    );
    const onlyMaxed = document.getElementById("stch-surplus-only-maxed");
    if (onlyMaxed) onlyMaxed.disabled = surplusBusy || otherBusy;
    const compareGems = document.getElementById("stch-surplus-compare-gems");
    if (compareGems) compareGems.disabled = surplusBusy || otherBusy;
    const onlyTradable = document.getElementById("stch-surplus-only-tradable");
    if (onlyTradable) onlyTradable.disabled = surplusBusy || otherBusy;
    const itemMode = document.getElementById("stch-surplus-item-mode");
    if (itemMode) itemMode.disabled = surplusBusy || otherBusy;
    updateSurplusProcessingActionState();
  }

  export function updateGrindActionState() {
    const grindBusy = state.grindScanning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.historyRefreshing
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusActionRunning
      || state.surplusScanning;
    document.getElementById("stch-grind-scan-btn")?.classList.toggle(
      "disabled",
      grindBusy || otherBusy
    );
    document.getElementById("stch-grind-stop-btn")?.classList.toggle(
      "disabled",
      !grindBusy
    );
    ["stch-grind-only-recommended", "stch-grind-include-surplus-cards", "stch-grind-reserve-copies", "stch-grind-include-points-shop", "stch-surplus-item-mode"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = grindBusy || otherBusy;
    });
    updateSurplusProcessingActionState();
  }

  export function isSharedActionBusy() {
    return state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.historyRefreshing
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusActionRunning
      || state.surplusScanning
      || state.grindScanning;
  }

  export function updateBulkActionState() {
    const selectedCount = getSelectedResults().length;
    const countEl = document.getElementById("stch-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;

    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-recalculate-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-submit-orders-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-scan-btn")?.classList.toggle(
      "disabled",
      isSharedActionBusy()
    );

    const selectAll = document.getElementById("stch-result-select-all");
    if (selectAll) {
      selectAll.checked = state.results.length > 0 && selectedCount === state.results.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.results.length;
    }
    updateOrderActionState();
  }

  export function updateOrderActionState() {
    const selectedCount = getSelectedOrderResults().length;
    const countEl = document.getElementById("stch-order-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;

    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-order-recalculate-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-order-submit-orders-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-order-delete-btn")?.classList.toggle(
      "disabled",
      getExpiredOrderCacheCount() === 0 || isSharedActionBusy()
    );
    document.getElementById("stch-order-add-btn")?.classList.toggle("disabled", isSharedActionBusy());

    const selectAll = document.getElementById("stch-order-select-all");
    if (selectAll) {
      selectAll.checked = state.orderResults.length > 0 && selectedCount === state.orderResults.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.orderResults.length;
    }
  }

  export function updateAllActionStates() {
    updateBulkActionState();
    updateCraftActionState();
    updateSurplusActionState();
    updateGrindActionState();
    const settingsBusy = isSharedActionBusy();
    ["stch-settings-clear-cache", "stch-settings-reset"].forEach(id => {
      document.getElementById(id)?.classList.toggle("disabled", settingsBusy);
    });
    const historyRefresh = document.getElementById("stch-history-refresh");
    const historyRefreshDisabled = settingsBusy && !state.historyRefreshing;
    historyRefresh?.classList.toggle("disabled", historyRefreshDisabled);
    if (historyRefresh) historyRefresh.disabled = historyRefreshDisabled;
  }
