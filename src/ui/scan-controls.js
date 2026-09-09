import { state } from "../state.js";
import { DEFAULT_CONFIG } from "../config.js";

export function setScanPhase(phase) {
  const btn = document.getElementById("stch-scan-btn");
  if (!btn) return;
  btn.textContent = "开始扫描";
  switch (phase) {
    case "phase1": btn.textContent = "扫描中: 徽章列表"; break;
    case "phase2": btn.textContent = "扫描中: 卡牌详情+查价"; break;
    case "phase3": btn.textContent = "扫描完成"; break;
    case "scanning": btn.textContent = "扫描中..."; break;
    case "done": btn.textContent = "扫描完成"; break;
  }
}

export function applyScanModeTheme() {
  const enabled = !!state.cfg.foilScanMode;
  document.getElementById("stch-tab-scan")?.classList.toggle("stch-foil-mode", enabled);
  const foilLabel = document.getElementById("stch-foil-mode-label");
  const foilInput = document.getElementById("stch-foil-scan-mode");
  const buyMode = document.getElementById("stch-buy-mode");
  const buyModeLabel = document.getElementById("stch-buy-mode-label");
  foilLabel?.classList.toggle("active", enabled);
  foilLabel?.classList.toggle("disabled", state.scanning);
  if (foilInput) foilInput.disabled = !!state.scanning;
  if (buyMode) {
    if (enabled) {
      if (!buyMode.dataset.normalValue && buyMode.value !== "complete1") {
        buyMode.dataset.normalValue = buyMode.value;
      }
      buyMode.value = "complete1";
      buyMode.disabled = true;
    } else {
      buyMode.disabled = false;
      buyMode.value = buyMode.dataset.normalValue || state.cfg.buyMode || DEFAULT_CONFIG.buyMode;
      delete buyMode.dataset.normalValue;
    }
  }
  buyModeLabel?.classList.toggle("stch-control-disabled", enabled);
}

