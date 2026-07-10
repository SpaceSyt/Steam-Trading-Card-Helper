import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { refreshResultInfo, getResultKey, getSelectedResults, getSelectedOrderResults } from "../services/result-info.js";

import { upsertOrderResult, removeOrderResultByKey, getCachedOrderResult, saveOrderCache, normalizeOrderResult } from "../services/order-cache.js";

import { getBadgeTargetLevel } from "../utils/badge.js";

import { formatCNY } from "../utils/format.js";

import { renderResults, renderOrderResults, updateSummary } from "../ui/render.js";

import { updateAllActionStates, isSharedActionBusy } from "../ui/action-state.js";

import { scanStatus, orderStatus, orderLog } from "../status-controllers.js";

const { setStatus, log } = scanStatus;

const { setStatus: setOrderStatus } = orderStatus;

  export async function recalculateResultSelection(source = "scan") {
    const isOrder = source === "order";
    const selected = isOrder ? getSelectedOrderResults() : getSelectedResults();
    if (selected.length === 0 || isSharedActionBusy()) return;

    const statusFn = isOrder ? setOrderStatus : setStatus;
    const logFn = isOrder ? orderLog : log;
    const selectedSet = isOrder ? state.selectedOrderResults : state.selectedResults;
    const targetResults = isOrder ? state.orderResults : state.results;

    state.bulkActionRunning = true;
    updateAllActionStates();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      statusFn,
      logFn,
      cfg.scanInterval
    );

    let refreshed = 0;
    let removed = 0;
    let failed = 0;
    try {
      for (let index = 0; index < selected.length; index++) {
        const existing = selected[index];
        const key = getResultKey(existing);
        statusFn(`重新计算 ${index + 1}/${selected.length}: ${existing.gameName}`);
        try {
          const next = await refreshResultInfo(existing, queue);
          const resultIndex = targetResults.findIndex(info => getResultKey(info) === key);
          if (next.level >= getBadgeTargetLevel(next)) {
            if (resultIndex >= 0) targetResults.splice(resultIndex, 1);
            selectedSet.delete(key);
            if (!isOrder) removeOrderResultByKey(key, { render: false });
            removed++;
            logFn(`[${existing.appid}] ${existing.gameName}: 已满级，从结果中移除`, "info");
          } else if (resultIndex >= 0) {
            if (isOrder) {
              targetResults[resultIndex] = normalizeOrderResult(next, Date.now());
            } else {
              targetResults[resultIndex] = next;
              upsertOrderResult(next, { render: false });
            }
            refreshed++;
            logFn(
              `[${existing.appid}] ${existing.gameName}: 重算完成，` +
              `补全 ¥${next.cheapestSetCNY} | 满级 ¥${next.level5CNY}`,
              "ok"
            );
          }
        } catch (error) {
          failed++;
          logFn(
            `[${existing.appid}] ${existing.gameName}: 重算失败 ${error?.message || error}`,
            "err"
          );
        }
      }
    } finally {
      queue.stop();
      state.bulkActionRunning = false;
      statusFn(null);
      if (isOrder) {
        saveOrderCache();
        renderOrderResults();
      } else {
        renderResults();
        updateSummary();
        renderOrderResults();
      }
      updateAllActionStates();
      logFn(
        `选中项重算结束: 成功 ${refreshed}, 移除 ${removed}, 失败 ${failed}`,
        failed ? "warn" : "ok"
      );
    }
  }

  export async function recalculateSelectedResults() {
    return recalculateResultSelection("scan");
  }

  export async function recalculateSelectedOrderResults() {
    return recalculateResultSelection("order");
  }
