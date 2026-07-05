import { state } from "../state.js";

import { saveConfig, DEFAULT_CONFIG } from "../config.js";

import { SEASONAL_BADGE_NAME, SEASONAL_BADGE_DEFID, SEASONAL_BADGE_MAX_LEVEL, SEASONAL_BADGE_DEFAULT_COST, SEASONAL_POINTS_SHOP_URL } from "../constants.js";

import { clampNumber, escapeHtml, formatInt, decodeHtmlEntities } from "../utils/format.js";

import { requestExternalText, buildHttpError, appendQuery } from "../request/http.js";

import { createTextSpan } from "../utils/dom.js";

import { updateAllActionStates, updateSeasonalActionState } from "../ui/action-state.js";

import { seasonalStatus } from "../status-controllers.js";

const { log: seasonalLog, setStatus: setSeasonalStatus, setProgress: setSeasonalProgress, hideProgress: hideSeasonalProgress } = seasonalStatus;

export { updateSeasonalActionState };

  function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }

  export function normalizeSeasonalInputs() {
    const targetEl = document.getElementById("stch-seasonal-target");
    if (targetEl) {
      state.cfg.seasonalTargetLevel = clampNumber(
        targetEl.value,
        1,
        SEASONAL_BADGE_MAX_LEVEL,
        DEFAULT_CONFIG.seasonalTargetLevel
      );
      targetEl.min = "1";
      targetEl.value = String(state.cfg.seasonalTargetLevel);
    }
    saveConfig(state.cfg);
  }

  export function getSeasonalPlan() {
    normalizeSeasonalInputs();
    const targetLevel = state.cfg.seasonalTargetLevel;
    return {
      targetLevel,
      levels: Math.max(0, targetLevel),
      interval: Math.max(0, state.cfg.seasonalInterval),
    };
  }

  export function updateSeasonalSummary() {
    const summary = document.getElementById("stch-seasonal-summary");
    if (!summary) return;
    const plan = getSeasonalPlan();
    const pointCost = SEASONAL_BADGE_DEFAULT_COST;
    const totalCost = pointCost * plan.levels;

    summary.innerHTML = `
      <div><b>${SEASONAL_BADGE_NAME}</b> · 每级约 <b>${pointCost.toLocaleString()}</b> 点</div>
      <div>将尝试 Lv<b>1</b> 到 Lv<b>${plan.targetLevel}</b> · 最多 <b>${plan.levels}</b> 次 · 最多 <b>${totalCost.toLocaleString()}</b> 点</div>
    `;
    updateSeasonalActionState();
  }

  export function parseJsonDataAttribute(html, attrName) {
    const match = String(html || "").match(new RegExp(`${attrName}="([^"]*)"`, "i"));
    if (!match) return null;
    try {
      return JSON.parse(decodeHtmlEntities(match[1]));
    } catch (_) {
      return null;
    }
  }

  export async function loadSeasonalStoreContext() {
    const response = await requestExternalText({ url: SEASONAL_POINTS_SHOP_URL });
    if (response.status === 429) {
      throw buildHttpError(429);
    }
    if (response.status < 200 || response.status >= 300) {
      throw buildHttpError(response.status, `读取点数商店失败 (${response.status})`);
    }

    const config = parseJsonDataAttribute(response.text, "data-config") || {};
    const loyaltyStore = parseJsonDataAttribute(response.text, "data-loyaltystore") || {};
    const token = loyaltyStore.webapi_token
      || config.webapi_token
      || response.text.match(/"webapi_token"\s*:\s*"([^"]+)"/)?.[1]
      || response.text.match(/g_wapit\s*=\s*"([^"]+)"/)?.[1];
    if (!token) {
      throw new Error("未从点数商店读取到 webapi token，请确认已登录 Steam 商店");
    }

    return {
      token,
    };
  }

  export async function requestSteamWebApi(methodName, token, payload) {
    const endpoint = `https://api.steampowered.com/ILoyaltyRewardsService/${methodName}/v1`;
    const body = new FormData();
    body.append("input_json", JSON.stringify(payload));
    const response = await requestExternalText({
      method: "POST",
      url: appendQuery(endpoint, { access_token: token }),
      data: body,
      timeout: 20000,
    });

    if (response.status === 429) {
      throw buildHttpError(429);
    }
    if (response.status < 200 || response.status >= 300) {
      const error = buildHttpError(response.status, `Steam API 请求失败 (${response.status})`);
      error.uncertain = response.status >= 500;
      throw error;
    }

    let data = null;
    try {
      data = response.text ? JSON.parse(response.text) : {};
    } catch (_) {
      const error = new Error("Steam API 返回了无法识别的响应");
      error.uncertain = true;
      throw error;
    }

    const payloadError = data?.response?.error
      || data?.response?.message
      || data?.error
      || data?.message;
    const success = data?.response?.success ?? data?.success;
    const eresult = Number(data?.response?.eresult || data?.eresult || 1);
    if (
      payloadError
      || success === false
      || success === 0
      || (Number.isFinite(eresult) && eresult > 1)
    ) {
      const error = new Error(
        payloadError || `Steam API 返回失败${Number.isFinite(eresult) ? ` (EResult ${eresult})` : ""}`
      );
      error.uncertain = false;
      throw error;
    }
    return data;
  }

  export async function getSeasonalBadgeInfo() {
    const context = await loadSeasonalStoreContext();
    return {
      token: context.token,
      defid: SEASONAL_BADGE_DEFID,
      name: SEASONAL_BADGE_NAME,
      pointCost: SEASONAL_BADGE_DEFAULT_COST,
    };
  }

  export function showSeasonalConfirmation(info, plan) {
    return new Promise(resolve => {
      const totalCost = (info.pointCost || SEASONAL_BADGE_DEFAULT_COST) * plan.levels;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认购买 ${escapeHtml(info.name)}</h3>
          <div class="stch-order-summary">
            将从 Lv<b>1</b> 试到 Lv<b>${plan.targetLevel}</b><br>
            最多提交 <b>${plan.levels}</b> 次 · 最多消耗 <b>${totalCost.toLocaleString()}</b> 点
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note">
            提交后会消耗 Steam 点数，脚本无法撤销。若请求超时、429 或结果不确定，脚本会停止，不会自动重复提交。
          </div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">开始购买</div>
          </div>
        </div>
      `;

      const list = backdrop.querySelector(".stch-order-list");
      const row = document.createElement("div");
      row.className = "stch-order-item";
      row.appendChild(createTextSpan("", info.name));
      row.appendChild(createTextSpan("", `Lv1-Lv${plan.targetLevel}`));
      row.appendChild(createTextSpan("", `${totalCost.toLocaleString()} 点`));
      list.appendChild(row);

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

  export async function redeemSeasonalBadgeLevels(info, levels) {
    const requestedLevels = Math.max(
      1,
      Math.min(SEASONAL_BADGE_MAX_LEVEL, parseInt(levels, 10) || 1)
    );
    const data = await requestSteamWebApi(
      "RedeemPointsForBadgeLevel",
      info.token,
      {
        defid: Number(info.defid),
        num_levels: requestedLevels,
      }
    );
    return data;
  }

  export async function startSeasonalPurchase() {
    if (
      state.seasonalActionRunning
      || state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.craftScanning
      || state.craftActionRunning
      || state.surplusScanning
      || state.grindScanning
    ) {
      return;
    }

    const plan = getSeasonalPlan();
    if (plan.levels <= 0) {
      seasonalLog("目标等级至少为 1", "warn");
      updateSeasonalSummary();
      return;
    }

    state.seasonalActionRunning = true;
    state.seasonalStopRequested = false;
    updateAllActionStates();
    setSeasonalStatus("读取 Steam 点数商店");

    let completed = 0;
    let skipped = 0;
    let failed = false;
    let cancelled = false;
    try {
      const info = await getSeasonalBadgeInfo();
      updateSeasonalSummary();
      const confirmed = await showSeasonalConfirmation(info, plan);
      if (!confirmed) {
        cancelled = true;
        return;
      }

      setSeasonalProgress(0, plan.levels, `准备购买 0/${plan.levels} 级`);
      seasonalLog(
        `${info.name}: 开始从 Lv1 试到 Lv${plan.targetLevel}`,
        "info"
      );

      for (let level = 1; level <= plan.targetLevel; level++) {
        if (state.seasonalStopRequested) break;
        setSeasonalStatus(`尝试 ${info.name} Lv${level}/${plan.targetLevel}`);
        try {
          await redeemSeasonalBadgeLevels(info, level);
          completed++;
          setSeasonalProgress(level, plan.levels, `已尝试 ${level}/${plan.levels} 级`);
          seasonalLog(
            `✓ ${info.name}: Lv${level} 提交成功`,
            "ok"
          );
        } catch (error) {
          if (error?.status === 429 || error?.uncertain) throw error;
          skipped++;
          setSeasonalProgress(level, plan.levels, `已尝试 ${level}/${plan.levels} 级`);
          seasonalLog(`Lv${level} 跳过: ${error?.message || error}`, "warn");
        }
        if (level < plan.targetLevel && !state.seasonalStopRequested) {
          await sleepMs(plan.interval);
        }
      }
    } catch (error) {
      failed = true;
      if (error?.status === 429) {
        seasonalLog(
          "Steam 返回 429，已停止购买；建议等待至少半小时或者更换 IP 后再继续",
          "warn"
        );
      } else if (error?.uncertain) {
        seasonalLog(
          `请求结果不确定: ${error?.message || error}。请刷新点数商店确认实际等级后再继续`,
          "warn"
        );
      } else {
        seasonalLog(`购买失败: ${error?.message || error}`, "err");
      }
    } finally {
      if (state.seasonalStopRequested && !failed) {
        seasonalLog("已按请求停止后续购买", "warn");
      }
      if (!cancelled) {
        seasonalLog(
          `季节徽章购买结束：成功 ${completed}，跳过 ${skipped}`,
          failed || state.seasonalStopRequested ? "warn" : "ok"
        );
      }
      state.seasonalActionRunning = false;
      state.seasonalStopRequested = false;
      setSeasonalStatus(null);
      hideSeasonalProgress();
      updateSeasonalSummary();
      updateAllActionStates();
    }
  }

  export function requestSeasonalStop() {
    if (!state.seasonalActionRunning) return;
    state.seasonalStopRequested = true;
    seasonalLog("已请求停止，将在当前请求结束后停止", "warn");
    updateSeasonalActionState();
  }
