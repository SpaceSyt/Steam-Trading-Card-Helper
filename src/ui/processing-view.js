import { state } from "../state.js";

export function syncProcessingView() {
  const root = document.getElementById("stch-processing-list");
  const empty = document.getElementById("stch-processing-empty");
  if (root && empty) {
    const hasResults = !!root.querySelector(".stch-inv-tile");
    empty.style.display = hasResults ? "none" : "";
    if (!hasResults) {
      empty.textContent = state.surplusScanning || state.grindScanning
        ? "正在检测物品..."
        : state.surplusResults.length || state.grindResults.length
          ? "当前筛选下没有物品"
          : "尚未检测到物品";
    }
  }

  const summaryRow = document.getElementById("stch-surplus-summary-row");
  if (summaryRow) {
    const hasSummary = ["stch-surplus-summary", "stch-grind-summary"]
      .some(id => document.getElementById(id)?.textContent);
    summaryRow.style.display = hasSummary ? "" : "none";
  }
}
