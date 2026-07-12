import { createStatusController } from "./status.js";

export const scanStatus = createStatusController({ tag: "STCH", logId: "stch-log", statusId: "stch-status", progressWrapId: "stch-progress-wrap", progressBarId: "stch-progress-bar", progressTextId: "stch-progress-text" });
export const orderStatus = createStatusController({ tag: "STCH Order", statusId: "stch-order-status" });
export const craftStatus = createStatusController({ tag: "STCH Craft", logId: "stch-craft-log", statusId: "stch-craft-status", progressWrapId: "stch-craft-progress-wrap", progressBarId: "stch-craft-progress-bar", progressTextId: "stch-craft-progress-text" });
export const surplusStatus = createStatusController({ tag: "STCH Surplus", logId: "stch-surplus-log", statusId: "stch-surplus-status", progressWrapId: "stch-surplus-progress-wrap", progressBarId: "stch-surplus-progress-bar", progressTextId: "stch-surplus-progress-text" });
export const grindStatus = createStatusController({ tag: "STCH Grind", logId: "stch-grind-log", statusId: "stch-grind-status", progressWrapId: "stch-grind-progress-wrap", progressBarId: "stch-grind-progress-bar", progressTextId: "stch-grind-progress-text" });

export function orderLog(msg, type = "") {
  console.log("[STCH][Order]", msg);
  if (["ok", "warn", "err"].includes(type)) {
    orderStatus.setStatus(msg.replace(/^\s*[✓✗]\s*/, ""), false);
  }
}
