import { state } from "../state.js";

import { getSelectedResults, getSelectedOrderResults } from "../services/result-info.js";

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
    document.getElementById("stch-surplus-sell-btn")?.classList.toggle(
      "disabled",
      disabled || isPriceOverviewGroupBusy()
    );
    document.getElementById("stch-surplus-gem-btn")?.classList.toggle("disabled", disabled);
    ["stch-surplus-sell-price-source", "stch-surplus-sell-adjustment"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = isSharedActionBusy();
    });
  }

  export function updateCraftActionState() {
    const craftBusy = state.craftScanning || state.craftActionRunning;
    const otherBusy = state.activeOrdersCancelling || state.surplusActionRunning;
    const probeBlocked = isIndependentProbeBlocked(craftBusy);
    const hasResults = state.craftResults.length > 0;
    const hasPlan = state.craftResults.some(r => r.selected && r.maxCraftable > 0 && (state.cfg.craftMode === "max" ? r.maxCraftable : (parseInt(r.craftCount,10)||0)) > 0);

    document.getElementById("stch-craft-scan-btn")?.classList.toggle(
      "disabled",
      probeBlocked
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

  function updateSurplusDetectionControls() {
    const detectionBusy = state.surplusScanning || state.grindScanning;
    const probeBlocked = isPriceOverviewProbeBlocked(detectionBusy);
    document.getElementById("stch-surplus-scan-btn")?.classList.toggle(
      "disabled",
      probeBlocked
    );
    document.getElementById("stch-surplus-stop-btn")?.classList.toggle(
      "disabled",
      !detectionBusy
    );
    ["stch-surplus-only-tradable", "stch-surplus-only-recommended", "stch-grind-reserve-copies", "stch-grind-include-points-shop", "stch-surplus-item-mode"].forEach(id => {
      const element = document.getElementById(id);
      if (element) element.disabled = probeBlocked;
    });
  }

  export function updateSurplusActionState() {
    updateSurplusDetectionControls();
    updateSurplusProcessingActionState();
  }

  export function isSharedActionBusy() {
    return state.scanning
      || state.recalculationRunning
      || state.orderSubmissionRunning
      || state.orderActionRunning
      || state.activeOrdersLoading
      || state.activeOrderPriceQueryRunning
      || state.activeOrdersCancelling
      || state.historyRefreshing
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusActionRunning
      || state.surplusScanning
      || state.grindScanning;
  }

  export function isWriteActionBusy() {
    return state.activeOrdersCancelling
      || state.surplusActionRunning;
  }

  export function isPriceOverviewGroupBusy() {
    return state.scanning
      || state.orderActionRunning
      || state.historyRefreshing
      || state.surplusScanning
      || state.grindScanning
      || state.activeOrderPriceQueryRunning
      || state.recalculationRunning
      || state.sidebarPriceRefreshing;
  }

  export function isPriceOverviewProbeBlocked(ownBusy = false) {
    return Boolean(ownBusy) || isPriceOverviewGroupBusy() || isWriteActionBusy();
  }

  export function isIndependentProbeBlocked(ownBusy = false) {
    return Boolean(ownBusy) || isWriteActionBusy();
  }

  export function updateBulkActionState() {
    const selectedCount = getSelectedResults().length;
    const countEl = document.getElementById("stch-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;

    const recalculateDisabled = selectedCount === 0 || isPriceOverviewGroupBusy();
    const submitDisabled = selectedCount === 0 || state.orderSubmissionRunning;
    document.getElementById("stch-recalculate-btn")?.classList.toggle("disabled", recalculateDisabled);
    document.getElementById("stch-submit-orders-btn")?.classList.toggle("disabled", submitDisabled);
    document.getElementById("stch-scan-btn")?.classList.toggle(
      "disabled",
      isPriceOverviewProbeBlocked(state.scanning)
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

    const recalculateDisabled = selectedCount === 0 || isPriceOverviewGroupBusy();
    const submitDisabled = selectedCount === 0 || state.orderSubmissionRunning;
    document.getElementById("stch-order-recalculate-btn")?.classList.toggle("disabled", recalculateDisabled);
    document.getElementById("stch-order-submit-orders-btn")?.classList.toggle("disabled", submitDisabled);
    document.getElementById("stch-order-add-btn")?.classList.toggle(
      "disabled",
      isPriceOverviewProbeBlocked(state.orderActionRunning)
    );

    const selectAll = document.getElementById("stch-order-select-all");
    if (selectAll) {
      selectAll.checked = state.orderResults.length > 0 && selectedCount === state.orderResults.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.orderResults.length;
    }
  }

  export function updateActiveOrdersActionState() {
    const busy = isSharedActionBusy();
    const activeOrderBusy = state.activeOrdersLoading || state.activeOrderPriceQueryRunning;
    const refreshBlocked = isIndependentProbeBlocked(activeOrderBusy);
    const priceQueryBlocked = isPriceOverviewProbeBlocked(activeOrderBusy);
    const selectedGroups = state.activeBuyOrderGroups.filter(group => (
      state.selectedActiveBuyOrderGroups.has(group.key)
    ));
    const count = document.getElementById("stch-active-orders-selected-count");
    if (count) count.textContent = `已选 ${selectedGroups.length} 项`;

    const refresh = document.getElementById("stch-active-orders-refresh");
    refresh?.classList.toggle("disabled", refreshBlocked);
    if (refresh) refresh.disabled = refreshBlocked;
    const cancel = document.getElementById("stch-active-orders-cancel-selected");
    cancel?.classList.toggle("disabled", busy || selectedGroups.length === 0);
    if (cancel) cancel.disabled = busy || selectedGroups.length === 0;
    const query = document.getElementById("stch-active-orders-query-prices");
    query?.classList.toggle("disabled", priceQueryBlocked || selectedGroups.length === 0);
    if (query) query.disabled = priceQueryBlocked || selectedGroups.length === 0;
  }

  export function updateAllActionStates() {
    updateBulkActionState();
    updateCraftActionState();
    updateSurplusActionState();
    updateActiveOrdersActionState();
    const historyRefresh = document.getElementById("stch-history-refresh");
    const historyRefreshDisabled = isPriceOverviewProbeBlocked(state.historyRefreshing);
    historyRefresh?.classList.toggle("disabled", historyRefreshDisabled);
    const sidebarRefresh = document.getElementById("stch-sidebar-refresh");
    if (sidebarRefresh) sidebarRefresh.disabled = isPriceOverviewGroupBusy();
    const settingsReset = document.getElementById("stch-settings-reset");
    settingsReset?.classList.toggle(
      "disabled",
      isSharedActionBusy() || state.sidebarPriceRefreshing
    );
    if (historyRefresh) historyRefresh.disabled = historyRefreshDisabled;
  }
