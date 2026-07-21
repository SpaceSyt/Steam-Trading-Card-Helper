import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { parseCraftableGameCardsHtml, parseCraftCandidatesHtml } from "../parsers/gamecards.js";

import { getResultKey } from "../services/result-info.js";

import { formatInt } from "../utils/format.js";

import { getBadgeTargetLevel, getBadgeModeLabel, getGameCardsUrl } from "../utils/badge.js";

import { createTextSpan, createCheckboxHit } from "../utils/dom.js";
import { enableCheckboxDragSelection } from "../ui/checkbox-drag.js";

import { isSharedActionBusy, updateAllActionStates, updateCraftActionState } from "../ui/action-state.js";

import { craftStatus } from "../status-controllers.js";

import { getProfileUrl, getSessionId } from "../utils/steam.js";

const { log: craftLog, setStatus: setCraftStatus, setProgress: setCraftProgress, hideProgress: hideCraftProgress } = craftStatus;

export { updateCraftActionState };

  export function getCraftPlan() {
    return state.craftResults
      .filter(result => result.selected && result.maxCraftable > 0)
      .map(result => ({
        result,
        count: state.cfg.craftMode === "max"
          ? result.maxCraftable
          : Math.max(
            0,
            Math.min(result.maxCraftable, parseInt(result.craftCount, 10) || 0)
          ),
      }))
      .filter(item => item.count > 0);
  }

  export function updateCraftSummary() {
    const row = document.getElementById("stch-craft-summary-row");
    const summary = document.getElementById("stch-craft-summary");
    if (!row || !summary) return;

    if (state.craftResults.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }

    const plan = getCraftPlan();
    const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
    const totalAvailable = state.craftResults.reduce(
      (sum, result) => sum + result.maxCraftable,
      0
    );
    summary.innerHTML =
      `共 <b>${state.craftResults.length}</b> 个可合成徽章 · ` +
      `可合成 <b>${totalAvailable}</b> 次 · ` +
      `已选择 <b>${plan.length}</b> 个 / <b>${totalLevels}</b> 次`;
    row.style.display = "";
  }

  export function renderCraftResults() {
    const list = document.getElementById("stch-craft-list");
    if (!list) return;
    enableCheckboxDragSelection(list, {
      checkboxSelector: ".stch-result-cb",
      activationSelector: ".stch-result-cb, .stch-check-hit, .stch-check",
      rowSelector: ".stch-craft-row",
      excludeSelector: "#stch-craft-select-all",
    });
    list.innerHTML = "";

    if (state.craftResults.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-game-row";
      empty.textContent = state.craftScanning
        ? "正在读取可合成徽章..."
        : "尚未扫描可合成徽章";
      list.appendChild(empty);
      updateCraftSummary();
      updateCraftActionState();
      return;
    }

    const header = document.createElement("div");
    header.className = "stch-game-row stch-craft-row stch-row-header";
    header.innerHTML = `
      <span class="stch-appid">游戏ID</span>
      <span class="stch-name">游戏名</span>
      <span class="stch-level">当前</span>
      <span class="stch-craft-available">可合成</span>
      <span class="stch-craft-count">本次</span>
      <span class="stch-craft-target">目标</span>
      <span class="stch-craft-status">状态</span>
      <span class="stch-check"><span class="stch-check-hit"><input class="stch-result-cb" id="stch-craft-select-all" type="checkbox" title="全选"></span></span>
    `;
    list.appendChild(header);

    const selectAll = header.querySelector("#stch-craft-select-all");
    const selectedCount = state.craftResults.filter(result => result.selected).length;
    selectAll.checked = selectedCount === state.craftResults.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < state.craftResults.length;
    selectAll.disabled = state.craftScanning
      || state.craftActionRunning
      || state.surplusActionRunning
      || state.surplusScanning
      || state.grindScanning;
    const applyCraftSelectAll = checked => {
      state.craftResults.forEach(result => {
        if (result.maxCraftable <= 0) return;
        result.selected = checked;
        if (checked && result.craftCount <= 0) {
          result.craftCount = result.maxCraftable;
        }
      });
      renderCraftResults();
    };
    selectAll.addEventListener("change", event => {
      event.stopPropagation();
      applyCraftSelectAll(event.target.checked);
    });
    selectAll.closest(".stch-check").addEventListener("click", event => {
      event.stopPropagation();
      if (event.target === selectAll || selectAll.disabled) return;
      selectAll.checked = !selectAll.checked;
      applyCraftSelectAll(selectAll.checked);
    });

    state.craftResults.forEach(result => {
      const row = document.createElement("div");
      row.className = "stch-game-row stch-craft-row";
      row.dataset.key = getResultKey(result);

      const appid = createTextSpan("stch-appid", result.appid);
      const name = createTextSpan(
        "stch-name",
        `${result.gameName}${result.isFoil ? "（闪亮）" : ""}`
      );
      name.title = result.gameName;
      const level = createTextSpan("stch-level", `Lv${result.level}`);
      const available = createTextSpan(
        "stch-craft-available",
        `${result.maxCraftable} 次`
      );

      const countCell = document.createElement("span");
      countCell.className = "stch-craft-count";
      const countInput = document.createElement("input");
      countInput.className = "stch-input";
      countInput.type = "number";
      countInput.min = "0";
      countInput.max = String(result.maxCraftable);
      countInput.step = "1";
      const displayedCraftCount = state.cfg.craftMode === "max"
        ? result.maxCraftable
        : Math.max(0, Math.min(result.maxCraftable, result.craftCount || 0));
      countInput.value = String(displayedCraftCount);
      countInput.title = state.cfg.craftMode === "max"
        ? "一次提交当前可合成最大次数"
        : "输入本次要逐级合成的次数";
      countInput.disabled = state.craftScanning
        || state.craftActionRunning
        || state.surplusActionRunning
        || state.surplusScanning
        || state.grindScanning
        || state.cfg.craftMode === "max"
        || result.maxCraftable <= 0;
      countCell.appendChild(countInput);

      const target = createTextSpan(
        "stch-craft-target",
        `Lv${result.level + (parseInt(countInput.value, 10) || 0)}`
      );
      const status = createTextSpan(
        `stch-craft-status ${result.statusType || ""}`.trim(),
        result.status || "待合成"
      );
      const checkCell = document.createElement("span");
      checkCell.className = "stch-check";
      const checkbox = document.createElement("input");
      checkbox.className = "stch-result-cb";
      checkbox.type = "checkbox";
      checkbox.checked = !!result.selected;
      checkbox.title = "按住并上下拖动可连续选择或取消";
      checkbox.disabled = state.craftScanning
        || state.craftActionRunning
        || state.surplusActionRunning
        || state.surplusScanning
        || state.grindScanning
        || result.maxCraftable <= 0;
      checkCell.appendChild(createCheckboxHit(checkbox));

      const applyCraftChecked = checked => {
        result.selected = checked;
        if (result.selected && result.craftCount <= 0) {
          result.craftCount = result.maxCraftable;
          countInput.value = String(result.craftCount);
          target.textContent = `Lv${result.level + result.craftCount}`;
        }
        updateCraftSummary();
        updateCraftActionState();
      };
      checkbox.addEventListener("change", event => {
        event.stopPropagation();
        applyCraftChecked(checkbox.checked);
      });
      checkCell.addEventListener("click", event => {
        event.stopPropagation();
        if (event.target === checkbox || checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        applyCraftChecked(checkbox.checked);
      });

      countInput.addEventListener("input", () => {
        const value = Math.max(
          0,
          Math.min(result.maxCraftable, parseInt(countInput.value, 10) || 0)
        );
        result.craftCount = value;
        result.selected = value > 0;
        checkbox.checked = result.selected;
        target.textContent = `Lv${result.level + value}`;
        updateCraftSummary();
        updateCraftActionState();
      });
      countInput.addEventListener("change", () => {
        countInput.value = String(result.craftCount);
      });

      row.append(appid, name, level, available, countCell, target, status, checkCell);
      list.appendChild(row);
    });

    updateCraftSummary();
    updateCraftActionState();
  }

  export function setAllCraftCounts(mode) {
    if (
      state.craftScanning
      || state.craftActionRunning
      || state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.surplusActionRunning
      || state.surplusScanning
      || state.grindScanning
    ) {
      return;
    }
    if (mode === "one" && state.cfg.craftMode === "max") return;

    state.craftResults.forEach(result => {
      if (mode === "clear") {
        result.craftCount = 0;
        result.selected = false;
      } else if (result.maxCraftable > 0) {
        result.craftCount = mode === "one" ? 1 : result.maxCraftable;
        result.selected = true;
      }
    });
    renderCraftResults();
  }

  export async function startCraftScan() {
    if (isSharedActionBusy()) return;

    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      craftLog("未找到 Steam 个人资料地址", "err");
      return;
    }

    state.craftScanning = true;
    state.craftStopRequested = false;
    state.craftResults = [];
    const logBox = document.getElementById("stch-craft-log");
    if (logBox) logBox.innerHTML = "";
    renderCraftResults();
    updateAllActionStates();
    setCraftStatus("扫描可合成徽章");

    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      null,
      craftLog
    );
    state.craftQueue = queue;

    const maxPages = Math.max(
      1,
      parseInt(
        document.getElementById("stch-craft-max-pages")?.value,
        10
      ) || cfg.maxBadgePages
    );
    const candidates = [];
    const seen = new Set();
    const blacklist = new Set(
      (cfg.blacklist || "").split(",").map(value => value.trim()).filter(Boolean)
    );

    try {
      for (let page = 1; page <= maxPages; page++) {
        if (state.craftStopRequested) break;
        setCraftProgress(page - 1, maxPages, `读取徽章页 ${page}/${maxPages}`);
        const response = await queue.fetch(
          `${profileUrl}/badges/?sort=p&p=${page}`
        );
        const pageCandidates = parseCraftCandidatesHtml(response.text || "");

        for (const candidate of pageCandidates) {
          const key = getResultKey(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          if (blacklist.has(String(candidate.appid))) {
            craftLog(
              `[${candidate.appid}] ${candidate.gameName}: 位于游戏/AppID黑名单，跳过`,
              "info"
            );
            continue;
          }
          candidates.push(candidate);
        }

        craftLog(
          `徽章页 ${page}: 找到 ${pageCandidates.length} 个可合成入口`,
          "info"
        );
        const doc = new DOMParser().parseFromString(
          response.text || "",
          "text/html"
        );
        const nextLink = doc.querySelector(
          `a.pagebtn[href*="p=${page + 1}"]`
        );
        if (!nextLink) break;
      }

      if (state.craftStopRequested) {
        craftLog("已停止扫描", "warn");
        return;
      }
      if (candidates.length === 0) {
        craftLog("没有找到可立即合成的徽章", "warn");
        return;
      }

      craftLog(`找到 ${candidates.length} 个候选徽章，开始读取卡组数量`);
      for (let index = 0; index < candidates.length; index++) {
        if (state.craftStopRequested) break;
        const candidate = candidates[index];
        setCraftProgress(
          index,
          candidates.length,
          `读取卡组 ${index + 1}/${candidates.length} · ${candidate.gameName}`
        );
        setCraftStatus(`读取卡组: ${candidate.gameName}`);
        try {
          const response = await queue.fetch(
            getGameCardsUrl(profileUrl, candidate.appid, candidate, { language: "english" })
          );
          const result = parseCraftableGameCardsHtml(
            response.text || "",
            candidate
          );
          if (result.maxCraftable <= 0) {
            craftLog(
              `[${candidate.appid}] ${candidate.gameName}: 页面已不可合成，跳过`,
              "warn"
            );
            continue;
          }
          state.craftResults.push(result);
          craftLog(
            `[${result.appid}] ${result.gameName}: Lv${result.level}，可合成 ${result.maxCraftable} 次`,
            "ok"
          );
        } catch (error) {
          if (state.craftStopRequested) break;
          craftLog(
            `[${candidate.appid}] ${candidate.gameName}: 读取失败 ${error?.message || error?.status || error}`,
            "err"
          );
        }
      }

      state.craftResults.sort((left, right) =>
        left.gameName.localeCompare(right.gameName, "zh-CN")
      );
      renderCraftResults();
      if (state.craftStopRequested) {
        craftLog("已停止扫描", "warn");
      } else {
        const total = state.craftResults.reduce(
          (sum, result) => sum + result.maxCraftable,
          0
        );
        craftLog(
          `扫描完成：${state.craftResults.length} 个徽章，可合成 ${total} 次`,
          "ok"
        );
      }
    } catch (error) {
      if (!state.craftStopRequested) {
        craftLog(`扫描中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      state.craftQueue = null;
      state.craftScanning = false;
      state.craftStopRequested = false;
      hideCraftProgress();
      setCraftStatus(null);
      renderCraftResults();
      updateAllActionStates();
    }
  }

  export function showCraftConfirmation(plan, craftMode) {
    return new Promise(resolve => {
      const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
      const craftModeLabel = craftMode === "max"
        ? "一次升满"
        : "逐级升级";
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认批量合成徽章</h3>
          <div class="stch-order-summary">
            游戏 <b>${plan.length}</b> 个 · 合成 <b>${totalLevels}</b> 次 ·
            预计增加 <b>${totalLevels * 100}</b> XP ·
            模式 <b>${craftModeLabel}</b>
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note">
            ${craftMode === "max"
              ? "每个徽章会按所选次数提交一次合成请求。"
              : "每一级都会独立提交一次合成请求。"}
            若请求结果不确定，脚本会立即停止且不会自动重试，请重新扫描后再继续。
          </div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">开始合成</div>
          </div>
        </div>
      `;

      const list = backdrop.querySelector(".stch-order-list");
      plan.forEach(item => {
        const row = document.createElement("div");
        row.className = "stch-order-item stch-craft-dialog-item";
        row.appendChild(createTextSpan("", item.result.gameName));
        row.appendChild(createTextSpan("", `Lv${item.result.level}`));
        row.appendChild(createTextSpan("", `${item.count} 次`));
        row.appendChild(
          createTextSpan("", `Lv${item.result.level + item.count}`)
        );
        list.appendChild(row);
      });

      const finish = confirmed => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]')
        .addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]')
        .addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }

  export async function createBadgeCraftRequest(result, levels = 1) {
    const profileUrl = getProfileUrl();
    const sessionId = getSessionId();
    if (!profileUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");

    const requestedLevels = Math.max(1, parseInt(levels, 10) || 1);
    if (requestedLevels > result.maxCraftable) {
      throw new Error("合成次数超过 Steam 当前允许的最大值");
    }

    const body = new URLSearchParams({
      appid: String(result.appid),
      series: "1",
      border_color: result.isFoil ? "1" : "0",
      levels: String(requestedLevels),
      sessionid: sessionId,
    });

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await window.fetch(`${profileUrl}/ajaxcraftbadge/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (cause) {
      clearTimeout(timeoutId);
      const message = cause?.name === "AbortError"
        ? "请求超时"
        : `网络错误: ${cause?.message || cause}`;
      const error = new Error(message);
      error.uncertain = true;
      throw error;
    }

    let text;
    try {
      text = await response.text();
    } catch (cause) {
      const error = new Error(`响应读取失败: ${cause?.message || cause}`);
      error.uncertain = true;
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const error = new Error(`Steam 返回了无法识别的响应 (${response.status})`);
      error.status = response.status;
      error.uncertain = response.ok || response.status >= 500;
      throw error;
    }

    if (response.ok && data?.success === 1) return data;

    const error = new Error(
      data?.message || `合成失败 (${response.status || "unknown"})`
    );
    error.status = response.status;
    error.uncertain = response.status >= 500;
    throw error;
  }

  export async function submitCraftPlan() {
    if (isSharedActionBusy()) return;

    const plan = getCraftPlan();
    if (plan.length === 0) return;
    const craftMode = state.cfg.craftMode === "max" ? "max" : "step";
    const confirmed = await showCraftConfirmation(plan, craftMode);
    if (!confirmed) return;

    state.craftActionRunning = true;
    state.craftStopRequested = false;
    updateAllActionStates();
    renderCraftResults();

    const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
    let completedLevels = 0;
    let failedGames = 0;
    let uncertain = false;

    try {
      for (const item of plan) {
        if (state.craftStopRequested || uncertain) break;
        const result = item.result;
        let itemCompleted = 0;
        result.status = "合成中";
        result.statusType = "warn";
        renderCraftResults();

        while (itemCompleted < item.count) {
          if (state.craftStopRequested) break;
          const requestLevels = craftMode === "max"
            ? item.count - itemCompleted
            : 1;
          setCraftStatus(
            `合成 ${Math.min(totalLevels, completedLevels + requestLevels)}/${totalLevels}: ${result.gameName}`
          );
          try {
            const data = await createBadgeCraftRequest(result, requestLevels);
            completedLevels += requestLevels;
            itemCompleted += requestLevels;
            result.level += requestLevels;
            result.availableSets = Math.max(
              0,
              result.availableSets - requestLevels
            );
            result.maxCraftable = Math.max(
              0,
              result.maxCraftable - requestLevels
            );
            result.craftCount = Math.max(0, item.count - itemCompleted);

            const rewards = (data.rgDroppedItems || [])
              .map(reward => reward.title)
              .filter(Boolean);
            craftLog(
              `✓ ${result.gameName}: 已合成 ${requestLevels} 次，至 Lv${result.level}` +
              `${rewards.length ? `，获得 ${rewards.join("、")}` : ""}`,
              "ok"
            );
            setCraftProgress(
              completedLevels,
              totalLevels,
              `已合成 ${completedLevels}/${totalLevels} 次`
            );
          } catch (error) {
            failedGames++;
            result.status = error.uncertain ? "结果不确定" : "失败";
            result.statusType = "err";
            craftLog(
              `✗ ${result.gameName}: ${error?.message || error}`,
              "err"
            );
            if (error.uncertain) {
              uncertain = true;
              state.craftStopRequested = true;
              craftLog(
                "请求可能已经被 Steam 执行，已停止后续合成；请刷新或重新扫描确认实际等级",
                "warn"
              );
            } else if (error.status === 429) {
              state.craftStopRequested = true;
              craftLog(
                "Steam 返回 429，已停止后续合成；建议等待至少半小时或者更换 IP 后再继续",
                "warn"
              );
            }
            break;
          }

          if (
            completedLevels < totalLevels
            && !state.craftStopRequested
            && !uncertain
          ) {
            await new Promise(resolve =>
              setTimeout(resolve, Math.max(200, state.cfg.craftInterval))
            );
          }
        }

        result.selected = false;
        result.craftCount = 0;
        if (!result.statusType || result.statusType !== "err") {
          if (itemCompleted === item.count) {
            result.status = "已完成";
            result.statusType = "ok";
          } else if (itemCompleted > 0) {
            result.status = "部分完成";
            result.statusType = "warn";
          } else if (state.craftStopRequested) {
            result.status = "已停止";
            result.statusType = "warn";
          }
        }
        renderCraftResults();
      }

      if (state.craftStopRequested && !uncertain) {
        craftLog("已按请求停止后续合成", "warn");
      }
      craftLog(
        `批量合成结束：成功 ${completedLevels}/${totalLevels} 次，失败 ${failedGames} 个游戏`,
        failedGames || state.craftStopRequested ? "warn" : "ok"
      );
    } finally {
      state.craftActionRunning = false;
      state.craftStopRequested = false;
      hideCraftProgress();
      setCraftStatus(null);
      renderCraftResults();
      updateAllActionStates();
    }
  }

  export function requestCraftStop() {
    if (!state.craftScanning && !state.craftActionRunning) return;
    state.craftStopRequested = true;
    state.craftQueue?.stop();
    craftLog(
      state.craftActionRunning
        ? "已请求停止，将在当前合成请求结束后停止"
        : "已请求停止扫描",
      "warn"
    );
    updateCraftActionState();
  }
