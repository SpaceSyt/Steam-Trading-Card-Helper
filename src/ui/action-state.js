import { state } from "../state.js";

import { getSelectedResults, getSelectedOrderResults } from "../services/result-info.js";

import { getExpiredOrderCacheCount } from "../services/order-cache.js";

import { clampNumber } from "../utils/format.js";

import { SEASONAL_BADGE_MAX_LEVEL } from "../constants.js";

  export function updateSeasonalActionState() {
    const seasonalBusy = state.seasonalActionRunning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusScanning
      || state.grindScanning;
    const plan = (() => {
      const targetLevel = clampNumber(
        document.getElementById("stch-seasonal-target")?.value,
        1,
        SEASONAL_BADGE_MAX_LEVEL,
        state.cfg.seasonalTargetLevel
      );
      return { levels: Math.max(0, targetLevel) };
    })();

    document.getElementById("stch-seasonal-buy-btn")?.classList.toggle(
      "disabled",
      seasonalBusy || otherBusy || plan.levels <= 0
    );
    document.getElementById("stch-seasonal-stop-btn")?.classList.toggle(
      "disabled",
      !seasonalBusy
    );
    [
      "stch-seasonal-target",
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = seasonalBusy || otherBusy;
    });
  }

  export function updateCraftActionState() {
    const craftBusy = state.craftScanning || state.craftActionRunning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.seasonalActionRunning
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
      || state.craftScanning
      || state.craftActionRunning
      || state.seasonalActionRunning
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
  }

  export function updateGrindActionState() {
    const grindBusy = state.grindScanning;
    const otherBusy = state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.craftScanning
      || state.craftActionRunning
      || state.seasonalActionRunning
      || state.surplusScanning;
    document.getElementById("stch-grind-scan-btn")?.classList.toggle(
      "disabled",
      grindBusy || otherBusy
    );
    document.getElementById("stch-grind-stop-btn")?.classList.toggle(
      "disabled",
      !grindBusy
    );
    ["stch-grind-only-recommended", "stch-grind-include-surplus-cards"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = grindBusy || otherBusy;
    });
  }

  export function isSharedActionBusy() {
    return state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.craftScanning
      || state.craftActionRunning
      || state.seasonalActionRunning
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
    updateSeasonalActionState();
    updateSurplusActionState();
    updateGrindActionState();
  }
