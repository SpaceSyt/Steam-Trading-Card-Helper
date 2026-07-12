// ==UserScript==
// @name         Steam Rate Limit Probe
// @namespace    https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @version      3.0.0
// @description  Probe Steam request limits across selectable endpoints and request transports
// @match        *://steamcommunity.com/id/*/badges*
// @match        *://steamcommunity.com/profiles/*/badges*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      steamcommunity.com
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const $J = unsafeWindow.jQuery || unsafeWindow.$ || null;
  const DEFAULTS = Object.freeze({
    target: "priceoverview",
    transport: "fetch",
    scheduleMode: "fixed",
    interval: 330,
    batchSize: 20,
    batchPause: 53000,
    useBatchPause: true,
    maxRequests: 100,
    maxBadgePages: 1,
    autoTune: false,
    minInterval: 100,
    tuneStep: 25,
    backoffStep: 100,
    autoDownload: false,
  });

  const TARGET_LABELS = Object.freeze({
    priceoverview: "市场价格 API",
    listing: "市场挂牌页",
    pricehistory: "市场价格历史",
    marketsearch: "市场搜索 API",
    gamecards: "游戏卡牌页",
    badges: "徽章列表页",
    inventory: "社区库存 API",
    mixed: "混合轮询",
  });

  const TRANSPORT_LABELS = Object.freeze({
    fetch: "fetch",
    xhr: "XMLHttpRequest",
    jquery: "jQuery.ajax",
    gm: "GM_xmlhttpRequest",
  });

  const SCHEDULE_LABELS = Object.freeze({
    fixed: "固定启动间隔",
    serial: "串行等待响应",
  });

  const state = {
    running: false,
    phase: "idle",
    scanStep: "",
    stopReason: "",

    target: DEFAULTS.target,
    transport: DEFAULTS.transport,
    scheduleMode: DEFAULTS.scheduleMode,
    currentInterval: DEFAULTS.interval,
    batchSize: DEFAULTS.batchSize,
    batchPause: DEFAULTS.batchPause,
    useBatchPause: DEFAULTS.useBatchPause,
    maxRequests: DEFAULTS.maxRequests,
    maxBadgePages: DEFAULTS.maxBadgePages,
    autoTune: DEFAULTS.autoTune,
    minInterval: DEFAULTS.minInterval,
    tuneStep: DEFAULTS.tuneStep,
    backoffStep: DEFAULTS.backoffStep,
    autoDownload: DEFAULTS.autoDownload,
    cleanBatches: 0,
    bestInterval: null,

    totalRequests: 0,
    dispatchedRequests: 0,
    totalSuccess: 0,
    total429: 0,
    totalOther: 0,
    batchNum: 0,
    probeStartTime: null,
    latencyTotal: 0,
    currentSuccessStreak: 0,
    maxSuccessStreak: 0,
    first429At: null,
    lastStatus: "—",
    byTarget: {},
    inFlight: 0,
    maxInFlight: 0,
    reportText: "",

    badges: [],
    cardPool: [],
    badgeIndex: 0,
    cardIndex: 0,
    mixedIndex: 0,
    steamId: "",
  };

  let modalEl = null;

  GM_addStyle(`
    #rlp-entry {
      display: inline-block; padding: 6px 12px; margin-left: 10px;
      background: rgba(225, 160, 40, 0.9); color: #fff;
      border-radius: 3px; cursor: pointer; font-size: 13px;
    }
    #rlp-entry:hover { background: rgba(245, 180, 60, 1); }
    #rlp-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.64);
      z-index: 10000; display: none;
    }
    #rlp-modal {
      position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
      width: 960px; max-width: 95vw; height: 90vh;
      background: #1b2838; color: #c6d4df;
      z-index: 10001; border-radius: 4px; overflow: hidden;
      display: flex; flex-direction: column;
      font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px;
      box-shadow: 0 0 30px rgba(0,0,0,0.65);
    }
    #rlp-modal .rlp-header {
      padding: 10px 16px; border-bottom: 1px solid #45556b;
      display: flex; align-items: center; background: #171a21;
    }
    #rlp-modal .rlp-header h2 { margin: 0; font-size: 18px; flex: 1; color: #fff; }
    #rlp-modal .rlp-close { cursor: pointer; font-size: 22px; color: #8f98a0; }
    #rlp-modal .rlp-close:hover { color: #fff; }
    #rlp-modal .rlp-body {
      flex: 1; overflow-y: auto; padding: 12px 16px;
      display: flex; flex-direction: column; min-height: 0;
    }
    #rlp-modal .rlp-footer {
      padding: 8px 16px; background: #171a21;
      border-top: 1px solid #45556b; font-size: 12px; color: #8f98a0;
    }
    .rlp-input {
      background: #0e1621; color: #fff; border: 1px solid #45556b;
      padding: 5px 8px; border-radius: 2px; font-size: 14px;
    }
    .rlp-input:focus { border-color: #66c0f4; outline: none; }
    .rlp-input:disabled { color: #687682; background: #111a25; cursor: not-allowed; }
    .rlp-btn {
      padding: 7px 14px; border: 0;
      background: linear-gradient(to bottom, #75b022 5%, #588a1b 95%);
      color: #fff; border-radius: 2px; cursor: pointer; font-size: 14px;
    }
    .rlp-btn:hover { background: linear-gradient(to bottom, #8ed629 5%, #6aa621 95%); }
    .rlp-btn.alt { background: linear-gradient(to bottom, #67c1f5 5%, #417a9b 95%); }
    .rlp-btn.alt:hover { background: linear-gradient(to bottom, #8ed8ff 5%, #5297b7 95%); }
    .rlp-btn.stop { background: linear-gradient(to bottom, #c04040 5%, #8b2020 95%); }
    .rlp-btn.stop:hover { background: linear-gradient(to bottom, #e05050 5%, #a03030 95%); }
    .rlp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .rlp-row {
      display: flex; gap: 12px; align-items: center;
      margin-bottom: 8px; flex-wrap: wrap;
    }
    .rlp-row label {
      display: flex; align-items: center; gap: 5px;
      color: #8f98a0; font-size: 13px;
    }
    .rlp-row label.rlp-primary { color: #fff; font-weight: bold; }
    .rlp-row-note { color: #8f98a0; font-size: 11px; line-height: 1.5; }
    .rlp-section {
      color: #fff; font-weight: bold; font-size: 14px;
      margin: 10px 0 8px; padding-bottom: 5px;
      border-bottom: 1px solid #45556b;
    }
    .rlp-stats {
      display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px 18px; margin: 4px 0 8px; padding: 10px;
      background: rgba(0,0,0,0.25); border: 1px solid #2a3f5a;
      border-radius: 3px;
    }
    .rlp-stat { display: flex; justify-content: space-between; gap: 10px; font-size: 13px; }
    .rlp-stat .rlp-val { color: #fff; font-weight: bold; text-align: right; overflow-wrap: anywhere; }
    .rlp-stat .rlp-val.good { color: #75b022; }
    .rlp-stat .rlp-val.warn { color: #ffc902; }
    .rlp-stat .rlp-val.bad { color: #d85050; }
    .rlp-progress {
      height: 18px; background: #0e1621; border-radius: 2px;
      overflow: hidden; margin: 4px 0; position: relative; display: none;
    }
    .rlp-progress-bar {
      height: 100%; background: linear-gradient(to right, #e1a028, #f5b43c);
      transition: width 0.2s;
    }
    .rlp-progress-text {
      position: absolute; inset: 0; text-align: center;
      font-size: 12px; line-height: 18px; color: #fff;
    }
    .rlp-status { color: #8db7d7; font-size: 13px; padding: 4px 0; min-height: 20px; }
    #rlp-log {
      flex: 1; min-height: 120px; overflow-y: auto;
      background: #0e1621; border-radius: 3px; padding: 8px;
      font-family: "Courier New", monospace; font-size: 12px;
      line-height: 1.5; color: #b0c3d9; white-space: pre-wrap;
      word-break: break-word;
    }
    #rlp-log .ok { color: #75b022; }
    #rlp-log .warn { color: #ffc902; }
    #rlp-log .err { color: #d85050; }
    #rlp-log .info { color: #67c1f5; }
    .rlp-report-actions {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-bottom: 6px;
    }
    .rlp-report-actions label {
      display: flex; align-items: center; gap: 5px;
      color: #8f98a0; font-size: 12px;
    }
    #rlp-result-output {
      width: 100%; min-height: 140px; resize: vertical;
      box-sizing: border-box; padding: 8px;
      background: #0e1621; color: #b0c3d9; border: 1px solid #2a3f5a;
      border-radius: 2px; font-family: "Courier New", monospace;
      font-size: 12px; line-height: 1.45;
    }
    @media (max-width: 760px) {
      .rlp-stats { grid-template-columns: 1fr 1fr; }
    }
  `);

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, Math.max(0, ms)));
  }

  async function sleepInterruptible(ms, label) {
    const endAt = Date.now() + Math.max(0, ms);
    let lastSeconds = null;
    while (state.running && Date.now() < endAt) {
      const remaining = Math.max(0, endAt - Date.now());
      const seconds = Math.max(1, Math.ceil(remaining / 1000));
      if (seconds !== lastSeconds) {
        lastSeconds = seconds;
        setStatus(`${label} (${seconds}s)`);
      }
      await sleep(Math.min(250, remaining));
    }
    if (state.running) setStatus("");
  }

  function formatDuration(ms) {
    if (!Number.isFinite(ms)) return "—";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m${Math.round((ms % 60000) / 1000)}s`;
  }

  function formatElapsed(ms) {
    if (!ms) return "—";
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remain = seconds % 60;
    return hours > 0 ? `${hours}h${minutes}m${remain}s` : `${minutes}m${remain}s`;
  }

  function getProfileUrl() {
    const direct = String(unsafeWindow.g_strProfileURL || "").replace(/\/$/, "");
    if (direct) return direct;
    const match = location.href.match(/^(https?:\/\/steamcommunity\.com\/(?:id|profiles)\/[^/]+)/i);
    return match ? match[1] : "";
  }

  function getSteamId() {
    const candidates = [
      unsafeWindow.g_steamID,
      unsafeWindow.g_steamID64,
      document.documentElement.innerHTML.match(/"steamid"\s*:\s*"(\d{17})"/i)?.[1],
      document.documentElement.innerHTML.match(/g_steamID\s*=\s*"(\d{17})"/i)?.[1],
    ];
    return String(candidates.find(value => /^\d{17}$/.test(String(value || ""))) || "");
  }

  function log(message, className = "") {
    const box = document.getElementById("rlp-log");
    if (!box) {
      console.log("[RLP]", message);
      return;
    }
    const line = document.createElement("div");
    line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    if (className) line.className = className;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 800) box.firstChild.remove();
  }

  function setStatus(text) {
    const element = document.getElementById("rlp-status");
    if (element) element.textContent = text || "";
  }

  function setProgress(done, total, text) {
    const wrap = document.getElementById("rlp-progress-wrap");
    const bar = document.getElementById("rlp-progress-bar");
    const label = document.getElementById("rlp-progress-text");
    if (!wrap || !bar || !label) return;
    wrap.style.display = "";
    bar.style.width = total > 0 ? `${Math.min(100, (done / total) * 100)}%` : "0%";
    label.textContent = text || `${done}/${total}`;
  }

  function hideProgress() {
    const wrap = document.getElementById("rlp-progress-wrap");
    if (wrap) wrap.style.display = "none";
  }

  function updateStats() {
    const stats = document.getElementById("rlp-stats");
    if (!stats) return;
    const elapsedMs = state.probeStartTime ? Date.now() - state.probeStartTime : 0;
    const requestRate = elapsedMs > 0
      ? (state.totalRequests / (elapsedMs / 1000)).toFixed(2)
      : "—";
    const averageLatency = state.totalRequests > 0
      ? Math.round(state.latencyTotal / state.totalRequests)
      : 0;
    const limitText = state.maxRequests === 0 ? "无限" : state.maxRequests;
    const first429 = state.first429At == null ? "未触发" : `#${state.first429At}`;
    const bestInterval = state.bestInterval == null ? "—" : `${state.bestInterval}ms`;

    stats.innerHTML = `
      <div class="rlp-stat"><span>状态</span><span class="rlp-val ${state.running ? "good" : ""}">${state.running ? "运行中" : "已停止"}</span></div>
      <div class="rlp-stat"><span>阶段</span><span class="rlp-val">${state.scanStep || state.phase}</span></div>
      <div class="rlp-stat"><span>停止原因</span><span class="rlp-val">${state.stopReason || "—"}</span></div>
      <div class="rlp-stat"><span>探测目标</span><span class="rlp-val">${TARGET_LABELS[state.target]}</span></div>
      <div class="rlp-stat"><span>请求通道</span><span class="rlp-val">${TRANSPORT_LABELS[state.transport]}</span></div>
      <div class="rlp-stat"><span>调度模式</span><span class="rlp-val">${SCHEDULE_LABELS[state.scheduleMode]}</span></div>
      <div class="rlp-stat"><span>运行时间</span><span class="rlp-val">${formatElapsed(elapsedMs)}</span></div>
      <div class="rlp-stat"><span>完成/发出/上限</span><span class="rlp-val">${state.totalRequests}/${state.dispatchedRequests}/${limitText}</span></div>
      <div class="rlp-stat"><span>当前/峰值并发</span><span class="rlp-val">${state.inFlight}/${state.maxInFlight}</span></div>
      <div class="rlp-stat"><span>批次暂停</span><span class="rlp-val">${state.useBatchPause ? formatDuration(state.batchPause) : "关闭"}</span></div>
      <div class="rlp-stat"><span>成功(2xx)</span><span class="rlp-val good">${state.totalSuccess}</span></div>
      <div class="rlp-stat"><span>限流(429)</span><span class="rlp-val ${state.total429 ? "bad" : "good"}">${state.total429}</span></div>
      <div class="rlp-stat"><span>其他状态</span><span class="rlp-val ${state.totalOther ? "warn" : ""}">${state.totalOther}</span></div>
      <div class="rlp-stat"><span>首次 429</span><span class="rlp-val ${state.first429At ? "bad" : "good"}">${first429}</span></div>
      <div class="rlp-stat"><span>当前连续成功</span><span class="rlp-val">${state.currentSuccessStreak}</span></div>
      <div class="rlp-stat"><span>最大连续成功</span><span class="rlp-val good">${state.maxSuccessStreak}</span></div>
      <div class="rlp-stat"><span>当前间隔</span><span class="rlp-val">${state.currentInterval}ms</span></div>
      <div class="rlp-stat"><span>最佳完整批次</span><span class="rlp-val">${bestInterval}</span></div>
      <div class="rlp-stat"><span>批次</span><span class="rlp-val">#${state.batchNum}</span></div>
      <div class="rlp-stat"><span>请求速率</span><span class="rlp-val">${requestRate}/s</span></div>
      <div class="rlp-stat"><span>平均延迟</span><span class="rlp-val">${averageLatency ? `${averageLatency}ms` : "—"}</span></div>
    `;

    const intervalInput = document.getElementById("rlp-interval");
    const pauseInput = document.getElementById("rlp-batch-pause");
    if (intervalInput) intervalInput.value = String(state.currentInterval);
    if (pauseInput) pauseInput.value = String(Math.round(state.batchPause / 1000));
  }

  function setControlsRunning(running) {
    document.querySelectorAll(".rlp-config-control").forEach(control => {
      control.disabled = running;
    });
    const start = document.getElementById("rlp-start");
    const stop = document.getElementById("rlp-stop");
    const reset = document.getElementById("rlp-reset");
    if (start) start.disabled = running;
    if (stop) stop.disabled = !running;
    if (reset) reset.disabled = running;
    if (!running) {
      syncAutoTuneControls();
      syncBatchPauseControls();
    }
  }

  function syncAutoTuneControls() {
    const enabled = !!document.getElementById("rlp-auto-tune")?.checked;
    ["rlp-min-interval", "rlp-tune-step", "rlp-backoff-step"].forEach(id => {
      const control = document.getElementById(id);
      if (control) control.disabled = state.running || !enabled;
    });
  }

  function syncBatchPauseControls() {
    const enabled = !!document.getElementById("rlp-use-batch-pause")?.checked;
    const pause = document.getElementById("rlp-batch-pause");
    if (pause) pause.disabled = state.running || !enabled;
  }

  async function scanBadgePages() {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("无法获取 Profile URL");
    const badges = [];
    const seen = new Set();
    state.scanStep = "收集徽章";

    for (let page = 1; page <= state.maxBadgePages && state.running; page++) {
      setProgress(page - 1, state.maxBadgePages, `徽章页 ${page}/${state.maxBadgePages}`);
      const response = await fetch(`${profileUrl}/badges/?sort=p&p=${page}`, { credentials: "include" });
      if (!response.ok) throw new Error(`徽章页 HTTP ${response.status}`);
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const rows = [...doc.querySelectorAll(".badge_row")];
      if (rows.length === 0) break;

      for (const row of rows) {
        const link = row.querySelector(".badge_row_overlay, a[href*='/gamecards/']");
        const href = link?.getAttribute("href") || "";
        const match = href.match(/\/gamecards\/(\d+)/);
        if (!match || seen.has(match[1])) continue;
        seen.add(match[1]);
        const title = row.querySelector(".badge_title")?.textContent || "";
        badges.push({
          appid: match[1],
          gameName: title.replace(/(?:查看详情|View details|徽章)$/gi, "").trim(),
        });
      }

      log(`徽章页 ${page}: ${rows.length} 行，累计 ${badges.length} 个 AppID`, "info");
      const hasNext = !!doc.querySelector(`a.pagebtn[href*="p=${page + 1}"]`);
      if (!hasNext) break;
    }

    state.badges = badges;
    hideProgress();
    log(`徽章池已准备：${badges.length} 个 AppID`, badges.length ? "ok" : "warn");
  }

  function addMarketHash(pool, seen, raw) {
    const value = String(raw || "").trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    pool.push(value);
  }

  async function collectCardPool() {
    const profileUrl = getProfileUrl();
    const pool = [];
    const seen = new Set();
    state.scanStep = "收集卡牌样本";

    for (let index = 0; index < state.badges.length && state.running; index++) {
      const badge = state.badges[index];
      setProgress(index, state.badges.length, `卡牌页 ${index + 1}/${state.badges.length}`);
      try {
        const response = await fetch(`${profileUrl}/gamecards/${badge.appid}/?l=english`, {
          credentials: "include",
        });
        if (!response.ok) {
          log(`[${badge.appid}] gamecards HTTP ${response.status}`, "warn");
          continue;
        }
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const multibuy = doc.querySelector('a[href*="/market/multibuy"]')?.getAttribute("href") || "";
        if (multibuy) {
          const url = new URL(multibuy.replace(/&amp;/g, "&"), location.origin);
          url.searchParams.getAll("items[]").forEach(item => addMarketHash(pool, seen, item));
        }
        doc.querySelectorAll('a[href*="/market/listings/753/"]').forEach(link => {
          const href = link.getAttribute("href") || "";
          const match = href.match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
          if (!match) return;
          try {
            addMarketHash(pool, seen, decodeURIComponent(match[1]));
          } catch (_) {
            addMarketHash(pool, seen, match[1]);
          }
        });
      } catch (error) {
        log(`[${badge.appid}] 卡牌样本读取失败: ${error?.message || error}`, "warn");
      }
    }

    state.cardPool = pool;
    hideProgress();
    log(`卡牌池已准备：${pool.length} 个 market hash name`, pool.length ? "ok" : "warn");
  }

  function targetNeedsBadges(target) {
    return ["priceoverview", "listing", "pricehistory", "gamecards", "mixed"].includes(target);
  }

  function targetNeedsCards(target) {
    return ["priceoverview", "listing", "pricehistory", "mixed"].includes(target);
  }

  async function prepareProbeData() {
    state.steamId = getSteamId();
    if (targetNeedsBadges(state.target)) await scanBadgePages();
    if (!state.running) return;
    if (targetNeedsBadges(state.target) && state.badges.length === 0) {
      throw new Error("没有可用的徽章样本");
    }
    if (targetNeedsCards(state.target)) await collectCardPool();
    if (!state.running) return;
    if (targetNeedsCards(state.target) && state.cardPool.length === 0) {
      throw new Error("没有可用的卡牌市场样本");
    }
    if (["inventory", "mixed"].includes(state.target) && !state.steamId) {
      if (state.target === "inventory") throw new Error("无法读取 SteamID，不能探测库存 API");
      log("混合模式未读取到 SteamID，将跳过库存 API", "warn");
    }
  }

  function nextCard() {
    const value = state.cardPool[state.cardIndex % state.cardPool.length];
    state.cardIndex++;
    return value;
  }

  function nextBadge() {
    const value = state.badges[state.badgeIndex % state.badges.length];
    state.badgeIndex++;
    return value;
  }

  function getAvailableMixedTargets() {
    const targets = ["marketsearch", "badges"];
    if (state.cardPool.length) targets.unshift("priceoverview", "listing", "pricehistory");
    if (state.badges.length) targets.push("gamecards");
    if (state.steamId) targets.push("inventory");
    return targets;
  }

  function buildProbeRequest(selectedTarget = state.target, requestNumber = state.dispatchedRequests + 1) {
    const profileUrl = getProfileUrl();
    let target = selectedTarget;
    if (target === "mixed") {
      const available = getAvailableMixedTargets();
      target = available[state.mixedIndex % available.length];
      state.mixedIndex++;
    }

    if (target === "priceoverview") {
      const card = nextCard();
      return {
        target,
        sample: card,
        url: `https://steamcommunity.com/market/priceoverview/?appid=753&currency=23&market_hash_name=${encodeURIComponent(card)}`,
      };
    }
    if (target === "listing") {
      const card = nextCard();
      return {
        target,
        sample: card,
        url: `https://steamcommunity.com/market/listings/753/${encodeURIComponent(card)}?l=english`,
      };
    }
    if (target === "pricehistory") {
      const card = nextCard();
      return {
        target,
        sample: card,
        url: `https://steamcommunity.com/market/pricehistory/?appid=753&market_hash_name=${encodeURIComponent(card)}`,
      };
    }
    if (target === "marketsearch") {
      const start = ((requestNumber - 1) % 10) * 10;
      return {
        target,
        sample: `start=${start}`,
        url: `https://steamcommunity.com/market/search/render/?query=&start=${start}&count=10&search_descriptions=0&sort_column=popular&sort_dir=desc&appid=753&norender=1`,
      };
    }
    if (target === "gamecards") {
      const badge = nextBadge();
      return {
        target,
        sample: badge.gameName || badge.appid,
        url: `${profileUrl}/gamecards/${badge.appid}/?l=english`,
      };
    }
    if (target === "badges") {
      const page = ((requestNumber - 1) % state.maxBadgePages) + 1;
      return {
        target,
        sample: `p=${page}`,
        url: `${profileUrl}/badges/?sort=p&p=${page}`,
      };
    }
    if (target === "inventory") {
      return {
        target,
        sample: state.steamId,
        url: `https://steamcommunity.com/inventory/${state.steamId}/753/6?l=english&count=1`,
      };
    }
    throw new Error(`不支持的探测目标: ${target}`);
  }

  function requestWithFetch(url) {
    return fetch(url, { credentials: "include", cache: "no-store" })
      .then(async response => ({ status: response.status, text: await response.text() }));
  }

  function requestWithXhr(url) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.withCredentials = true;
      xhr.timeout = 20000;
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText || "" });
      xhr.onerror = () => reject(new Error("XMLHttpRequest 网络错误"));
      xhr.ontimeout = () => reject(new Error("XMLHttpRequest 超时"));
      xhr.send();
    });
  }

  function requestWithJquery(url) {
    if (!$J?.ajax) return Promise.reject(new Error("当前页面没有 jQuery.ajax"));
    return new Promise((resolve, reject) => {
      $J.ajax({
        url,
        method: "GET",
        dataType: "text",
        cache: false,
        xhrFields: { withCredentials: true },
      }).done((data, _textStatus, jqXHR) => {
        resolve({ status: jqXHR?.status || 200, text: typeof data === "string" ? data : "" });
      }).fail((jqXHR, textStatus, errorThrown) => {
        if (jqXHR?.status) {
          resolve({ status: jqXHR.status, text: jqXHR.responseText || "" });
        } else {
          reject(new Error(errorThrown || textStatus || "jQuery.ajax 网络错误"));
        }
      });
    });
  }

  function requestWithGm(url) {
    if (typeof GM_xmlhttpRequest !== "function") {
      return Promise.reject(new Error("GM_xmlhttpRequest 不可用"));
    }
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: 20000,
        anonymous: false,
        withCredentials: true,
        onload: response => resolve({
          status: response.status || 0,
          text: response.responseText || "",
        }),
        onerror: () => reject(new Error("GM_xmlhttpRequest 网络错误")),
        ontimeout: () => reject(new Error("GM_xmlhttpRequest 超时")),
      });
    });
  }

  async function sendProbeRequest(request) {
    const startedAt = Date.now();
    const targetUrl = new URL(request.url);
    targetUrl.searchParams.set("_rlp", `${startedAt}-${request.number}`);
    const url = targetUrl.href;
    state.inFlight++;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    updateStats();
    try {
      let response;
      if (state.transport === "xhr") response = await requestWithXhr(url);
      else if (state.transport === "jquery") response = await requestWithJquery(url);
      else if (state.transport === "gm") response = await requestWithGm(url);
      else response = await requestWithFetch(url);
      return { ...response, latency: Date.now() - startedAt };
    } finally {
      state.inFlight = Math.max(0, state.inFlight - 1);
      updateStats();
    }
  }

  function recordResult(request, result) {
    state.totalRequests++;
    state.latencyTotal += result.latency;
    state.lastStatus = String(result.status);
    state.byTarget[request.target] ||= { total: 0, success: 0, limited: 0, other: 0 };
    const targetStats = state.byTarget[request.target];
    targetStats.total++;

    if (result.status >= 200 && result.status < 300) {
      state.totalSuccess++;
      state.currentSuccessStreak++;
      state.maxSuccessStreak = Math.max(state.maxSuccessStreak, state.currentSuccessStreak);
      targetStats.success++;
      return "success";
    }
    state.currentSuccessStreak = 0;
    if (result.status === 429) {
      state.total429++;
      state.first429At ??= request.number;
      targetStats.limited++;
      return "limited";
    }
    state.totalOther++;
    targetStats.other++;
    return "other";
  }

  function applyAutoTune(hit429, completedBatch) {
    if (!state.autoTune) return;
    if (hit429) {
      const oldInterval = state.currentInterval;
      const oldPause = state.batchPause;
      state.currentInterval = Math.min(5000, oldInterval + state.backoffStep);
      if (state.useBatchPause) {
        state.batchPause = Math.min(300000, oldPause + 5000);
      }
      state.cleanBatches = 0;
      log(
        `自动调优: 429 后间隔 ${oldInterval}→${state.currentInterval}ms`
        + (state.useBatchPause ? `，暂停 ${formatDuration(oldPause)}→${formatDuration(state.batchPause)}` : "，批次暂停保持关闭"),
        "warn"
      );
      return;
    }
    if (!completedBatch) return;
    state.bestInterval = state.bestInterval == null
      ? state.currentInterval
      : Math.min(state.bestInterval, state.currentInterval);
    state.cleanBatches++;
    if (state.cleanBatches < 2 || state.currentInterval <= state.minInterval) return;
    const oldInterval = state.currentInterval;
    state.currentInterval = Math.max(state.minInterval, oldInterval - state.tuneStep);
    state.cleanBatches = 0;
    log(`自动调优: 两个完整成功批次，间隔 ${oldInterval}→${state.currentInterval}ms`, "info");
  }

  function reachedRequestLimit() {
    return state.maxRequests > 0 && state.dispatchedRequests >= state.maxRequests;
  }

  async function executeProbeRequest(requestNumber) {
    const request = {
      ...buildProbeRequest(state.target, requestNumber),
      number: requestNumber,
    };
    try {
      const result = await sendProbeRequest(request);
      return { request, result, error: null };
    } catch (error) {
      return {
        request,
        result: { status: -1, text: "", latency: 0 },
        error,
      };
    }
  }

  function processProbeResult(entry) {
    const { request, result, error } = entry;
    if (error) {
      log(`#${request.number} ${TARGET_LABELS[request.target]} 网络错误: ${error?.message || error}`, "err");
    }
    const streakBeforeResult = state.currentSuccessStreak;
    const outcome = recordResult(request, result);
    const sample = String(request.sample || "").slice(0, 34);
    if (outcome === "success") {
      log(`#${request.number} ${result.status} ${TARGET_LABELS[request.target]} [${sample}] ${result.latency}ms`, "ok");
    } else if (outcome === "limited") {
      log(
        `#${request.number} 429 ${TARGET_LABELS[request.target]} [${sample}]，本轮连续成功 ${streakBeforeResult}，历史最大 ${state.maxSuccessStreak}`,
        "err"
      );
    } else if (result.status !== -1) {
      log(`#${request.number} ${result.status} ${TARGET_LABELS[request.target]} [${sample}] ${result.latency}ms`, "warn");
    }
    updateStats();
    return outcome;
  }

  async function runSerialBatch(requestCount) {
    let hit429 = false;
    let completedBatch = requestCount === state.batchSize;
    for (let index = 0; index < requestCount && state.running; index++) {
      const requestNumber = ++state.dispatchedRequests;
      const outcome = processProbeResult(await executeProbeRequest(requestNumber));
      if (outcome !== "success") completedBatch = false;
      if (outcome === "limited") {
        hit429 = true;
        break;
      }
      if (index < requestCount - 1 && state.running) {
        await sleep(state.currentInterval);
      }
    }
    return { hit429, completedBatch };
  }

  async function runFixedBatch(requestCount) {
    const batchStartedAt = Date.now();
    const jobs = [];
    for (let index = 0; index < requestCount && state.running; index++) {
      const dueAt = batchStartedAt + index * state.currentInterval;
      await sleep(Math.max(0, dueAt - Date.now()));
      if (!state.running) break;
      const requestNumber = ++state.dispatchedRequests;
      jobs.push(executeProbeRequest(requestNumber));
    }

    const entries = await Promise.all(jobs);
    let hit429 = false;
    let completedBatch = jobs.length === requestCount && requestCount === state.batchSize;
    for (const entry of entries) {
      const outcome = processProbeResult(entry);
      if (outcome !== "success") completedBatch = false;
      if (outcome === "limited") hit429 = true;
    }
    return { hit429, completedBatch };
  }

  async function probeLoop() {
    state.phase = "探测";
    state.scanStep = "";
    state.probeStartTime = Date.now();

    while (state.running && !reachedRequestLimit()) {
      state.batchNum++;
      const remaining = state.maxRequests > 0
        ? state.maxRequests - state.dispatchedRequests
        : state.batchSize;
      const batchRequestCount = Math.min(state.batchSize, remaining);

      log(
        `批次 #${state.batchNum}: 目标=${TARGET_LABELS[state.target]}，通道=${TRANSPORT_LABELS[state.transport]}，调度=${SCHEDULE_LABELS[state.scheduleMode]}，间隔=${state.currentInterval}ms，请求=${batchRequestCount}`,
        "info"
      );

      const batchResult = state.scheduleMode === "serial"
        ? await runSerialBatch(batchRequestCount)
        : await runFixedBatch(batchRequestCount);
      applyAutoTune(batchResult.hit429, batchResult.completedBatch);
      updateStats();
      if (!state.running || reachedRequestLimit()) break;
      if (state.useBatchPause && state.batchPause > 0) {
        await sleepInterruptible(
          state.batchPause,
          batchResult.hit429 ? "429 冷却" : "批次冷却"
        );
      }
    }

    if (reachedRequestLimit()) state.stopReason = `达到请求上限 ${state.maxRequests}`;
    else if (!state.stopReason) state.stopReason = "手动停止";
    const targetSummary = Object.entries(state.byTarget)
      .map(([target, stats]) => (
        `${TARGET_LABELS[target]} ${stats.success}/${stats.total}`
        + (stats.limited ? `, 429=${stats.limited}` : "")
      ))
      .join("；");
    if (targetSummary) log(`目标统计: ${targetSummary}`, "info");
    log(
      `探测结束: ${state.stopReason}；最大连续成功 ${state.maxSuccessStreak}，首次429 ${state.first429At ? `#${state.first429At}` : "未触发"}`,
      state.total429 ? "warn" : "ok"
    );
  }

  function buildReportData() {
    const finishedAt = Date.now();
    const durationMs = state.probeStartTime ? finishedAt - state.probeStartTime : 0;
    return {
      generatedAt: new Date(finishedAt).toISOString(),
      configuration: {
        target: state.target,
        targetLabel: TARGET_LABELS[state.target],
        transport: state.transport,
        transportLabel: TRANSPORT_LABELS[state.transport],
        scheduleMode: state.scheduleMode,
        scheduleLabel: SCHEDULE_LABELS[state.scheduleMode],
        intervalMs: state.currentInterval,
        batchSize: state.batchSize,
        batchPauseEnabled: state.useBatchPause,
        batchPauseMs: state.useBatchPause ? state.batchPause : 0,
        maxRequests: state.maxRequests,
        autoTune: state.autoTune,
        minIntervalMs: state.autoTune ? state.minInterval : null,
        successStepMs: state.autoTune ? state.tuneStep : null,
        backoffStepMs: state.autoTune ? state.backoffStep : null,
      },
      result: {
        stopReason: state.stopReason || "unknown",
        durationMs,
        dispatchedRequests: state.dispatchedRequests,
        completedRequests: state.totalRequests,
        successfulRequests: state.totalSuccess,
        limitedRequests: state.total429,
        otherResponses: state.totalOther,
        first429Request: state.first429At,
        currentSuccessStreak: state.currentSuccessStreak,
        maxSuccessStreak: state.maxSuccessStreak,
        maxConcurrency: state.maxInFlight,
        averageLatencyMs: state.totalRequests > 0
          ? Number((state.latencyTotal / state.totalRequests).toFixed(2))
          : null,
        requestsPerSecond: durationMs > 0
          ? Number((state.totalRequests / (durationMs / 1000)).toFixed(3))
          : null,
        bestCleanBatchIntervalMs: state.bestInterval,
      },
      byTarget: state.byTarget,
    };
  }

  function downloadReport(reportText = state.reportText) {
    if (!reportText) return;
    const blob = new Blob([reportText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `steam-rate-limit-${state.target}-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyReport() {
    if (!state.reportText) {
      setStatus("暂无可复制的报告");
      return;
    }
    try {
      await navigator.clipboard.writeText(state.reportText);
      setStatus("报告已复制到剪贴板");
    } catch (_) {
      const output = document.getElementById("rlp-result-output");
      output?.select();
      const copied = document.execCommand("copy");
      setStatus(copied ? "报告已复制到剪贴板" : "复制失败，请手动选择报告内容");
    }
  }

  function generateReport() {
    state.reportText = JSON.stringify(buildReportData(), null, 2);
    const output = document.getElementById("rlp-result-output");
    if (output) output.value = state.reportText;
    console.info("[RLP][Report]", state.reportText);
    if (state.autoDownload) downloadReport();
  }

  function readNumber(id, fallback, options = {}) {
    const raw = document.getElementById(id)?.value;
    let value = options.integer === false ? parseFloat(raw) : parseInt(raw, 10);
    if (!Number.isFinite(value)) value = fallback;
    if (Number.isFinite(options.min)) value = Math.max(options.min, value);
    if (Number.isFinite(options.max)) value = Math.min(options.max, value);
    return value;
  }

  function readControls() {
    state.target = document.getElementById("rlp-target")?.value || DEFAULTS.target;
    state.transport = document.getElementById("rlp-transport")?.value || DEFAULTS.transport;
    state.scheduleMode = document.getElementById("rlp-schedule-mode")?.value || DEFAULTS.scheduleMode;
    if (state.transport === "jquery" && !$J?.ajax) {
      state.transport = "fetch";
      document.getElementById("rlp-transport").value = "fetch";
      log("当前页面没有 jQuery.ajax，已改用 fetch", "warn");
    }
    state.currentInterval = readNumber("rlp-interval", DEFAULTS.interval, { min: 0, max: 5000 });
    state.batchSize = readNumber("rlp-batch-size", DEFAULTS.batchSize, { min: 1, max: 1000 });
    state.useBatchPause = !!document.getElementById("rlp-use-batch-pause")?.checked;
    state.batchPause = readNumber("rlp-batch-pause", DEFAULTS.batchPause / 1000, { min: 0, max: 300 }) * 1000;
    state.maxRequests = readNumber("rlp-max-requests", DEFAULTS.maxRequests, { min: 0, max: 100000 });
    state.maxBadgePages = readNumber("rlp-max-pages", DEFAULTS.maxBadgePages, { min: 1, max: 20 });
    state.autoTune = !!document.getElementById("rlp-auto-tune")?.checked;
    state.minInterval = readNumber("rlp-min-interval", DEFAULTS.minInterval, { min: 0, max: 5000 });
    state.tuneStep = readNumber("rlp-tune-step", DEFAULTS.tuneStep, { min: 1, max: 1000 });
    state.backoffStep = readNumber("rlp-backoff-step", DEFAULTS.backoffStep, { min: 1, max: 5000 });
    state.autoDownload = !!document.getElementById("rlp-auto-download")?.checked;
    if (state.autoTune) {
      state.currentInterval = Math.max(state.minInterval, state.currentInterval);
    }
  }

  function resetCounters() {
    state.phase = "idle";
    state.scanStep = "";
    state.stopReason = "";
    state.cleanBatches = 0;
    state.bestInterval = null;
    state.totalRequests = 0;
    state.dispatchedRequests = 0;
    state.totalSuccess = 0;
    state.total429 = 0;
    state.totalOther = 0;
    state.batchNum = 0;
    state.probeStartTime = null;
    state.latencyTotal = 0;
    state.currentSuccessStreak = 0;
    state.maxSuccessStreak = 0;
    state.first429At = null;
    state.lastStatus = "—";
    state.byTarget = {};
    state.inFlight = 0;
    state.maxInFlight = 0;
    state.reportText = "";
    state.badges = [];
    state.cardPool = [];
    state.badgeIndex = 0;
    state.cardIndex = 0;
    state.mixedIndex = 0;
    state.steamId = "";
  }

  async function startProbe() {
    if (state.running) return;
    readControls();
    resetCounters();
    state.running = true;
    setControlsRunning(true);
    document.getElementById("rlp-log").innerHTML = "";
    document.getElementById("rlp-result-output").value = "";
    log("开始 Steam 请求限制探测", "info");
    log(
      `配置: ${TARGET_LABELS[state.target]} / ${TRANSPORT_LABELS[state.transport]} / ${SCHEDULE_LABELS[state.scheduleMode]} / 批次暂停 ${state.useBatchPause ? "开启" : "关闭"} / 上限 ${state.maxRequests || "无限"} / 自动调优 ${state.autoTune ? "开启" : "关闭"}`,
      "info"
    );
    updateStats();

    try {
      await prepareProbeData();
      if (!state.running) return;
      await probeLoop();
    } catch (error) {
      state.stopReason = error?.message || String(error);
      log(`探测中断: ${state.stopReason}`, "err");
    } finally {
      state.running = false;
      state.phase = "idle";
      state.scanStep = "";
      hideProgress();
      setStatus("");
      setControlsRunning(false);
      updateStats();
      generateReport();
    }
  }

  function stopProbe(silent = false) {
    if (!state.running) return;
    state.stopReason = "手动停止";
    state.running = false;
    if (!silent) log("已请求停止", "warn");
    setControlsRunning(false);
    updateStats();
  }

  function resetProbe() {
    if (state.running) return;
    state.target = DEFAULTS.target;
    state.transport = DEFAULTS.transport;
    state.scheduleMode = DEFAULTS.scheduleMode;
    state.currentInterval = DEFAULTS.interval;
    state.batchSize = DEFAULTS.batchSize;
    state.batchPause = DEFAULTS.batchPause;
    state.useBatchPause = DEFAULTS.useBatchPause;
    state.maxRequests = DEFAULTS.maxRequests;
    state.maxBadgePages = DEFAULTS.maxBadgePages;
    state.autoTune = DEFAULTS.autoTune;
    state.minInterval = DEFAULTS.minInterval;
    state.tuneStep = DEFAULTS.tuneStep;
    state.backoffStep = DEFAULTS.backoffStep;
    state.autoDownload = DEFAULTS.autoDownload;
    resetCounters();

    document.getElementById("rlp-target").value = state.target;
    document.getElementById("rlp-transport").value = state.transport;
    document.getElementById("rlp-schedule-mode").value = state.scheduleMode;
    document.getElementById("rlp-interval").value = state.currentInterval;
    document.getElementById("rlp-batch-size").value = state.batchSize;
    document.getElementById("rlp-use-batch-pause").checked = state.useBatchPause;
    document.getElementById("rlp-batch-pause").value = state.batchPause / 1000;
    document.getElementById("rlp-max-requests").value = state.maxRequests;
    document.getElementById("rlp-max-pages").value = state.maxBadgePages;
    document.getElementById("rlp-auto-tune").checked = state.autoTune;
    document.getElementById("rlp-min-interval").value = state.minInterval;
    document.getElementById("rlp-tune-step").value = state.tuneStep;
    document.getElementById("rlp-backoff-step").value = state.backoffStep;
    document.getElementById("rlp-auto-download").checked = state.autoDownload;
    document.getElementById("rlp-log").innerHTML = "";
    document.getElementById("rlp-result-output").value = "";
    syncAutoTuneControls();
    syncBatchPauseControls();
    updateStats();
    log("已恢复探测器默认参数", "info");
  }

  function closeModal() {
    if (state.running) {
      if (!confirm("探测正在运行，确定停止并关闭？")) return;
      stopProbe(true);
    }
    document.getElementById("rlp-backdrop")?.remove();
    modalEl?.remove();
    modalEl = null;
  }

  function buildModal() {
    const backdrop = document.createElement("div");
    backdrop.id = "rlp-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.id = "rlp-modal";
    modal.addEventListener("click", event => event.stopPropagation());
    modal.innerHTML = `
      <div class="rlp-header">
        <h2>Steam 请求限制探测器 v3</h2>
        <span class="rlp-close" title="关闭">✕</span>
      </div>
      <div class="rlp-body">
        <div class="rlp-section">请求选择</div>
        <div class="rlp-row">
          <label class="rlp-primary">探测目标
            <select id="rlp-target" class="rlp-input rlp-config-control">
              ${Object.entries(TARGET_LABELS).map(([value, label]) => `<option value="${value}" ${state.target === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label class="rlp-primary">请求通道
            <select id="rlp-transport" class="rlp-input rlp-config-control">
              <option value="fetch">fetch</option>
              <option value="xhr">XMLHttpRequest</option>
              <option value="jquery" ${$J?.ajax ? "" : "disabled"}>jQuery.ajax${$J?.ajax ? "" : "（不可用）"}</option>
              <option value="gm">GM_xmlhttpRequest</option>
            </select>
          </label>
          <label class="rlp-primary">调度方式
            <select id="rlp-schedule-mode" class="rlp-input rlp-config-control">
              ${Object.entries(SCHEDULE_LABELS).map(([value, label]) => `<option value="${value}" ${state.scheduleMode === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </label>
          <label>最大徽章页数
            <input id="rlp-max-pages" class="rlp-input rlp-config-control" type="number" min="1" max="20" value="${state.maxBadgePages}" style="width:54px">
          </label>
        </div>

        <div class="rlp-section">负载设置</div>
        <div class="rlp-row">
          <label>请求间隔
            <input id="rlp-interval" class="rlp-input rlp-config-control" type="number" min="0" max="5000" step="10" value="${state.currentInterval}" style="width:70px"> ms
          </label>
          <label>每批请求
            <input id="rlp-batch-size" class="rlp-input rlp-config-control" type="number" min="1" max="1000" value="${state.batchSize}" style="width:58px"> 次
          </label>
          <label class="rlp-primary">
            <input id="rlp-use-batch-pause" class="rlp-config-control" type="checkbox" ${state.useBatchPause ? "checked" : ""}>
            批次暂停
          </label>
          <label>暂停时长
            <input id="rlp-batch-pause" class="rlp-input rlp-config-control" type="number" min="0" max="300" value="${state.batchPause / 1000}" style="width:58px"> s
          </label>
          <label>总请求上限
            <input id="rlp-max-requests" class="rlp-input rlp-config-control" type="number" min="0" max="100000" value="${state.maxRequests}" style="width:72px">
          </label>
          <span class="rlp-row-note">总请求上限填 0 时持续运行，直到手动停止。</span>
        </div>

        <div class="rlp-section">自动调优</div>
        <div class="rlp-row">
          <label class="rlp-primary">
            <input id="rlp-auto-tune" class="rlp-config-control" type="checkbox" ${state.autoTune ? "checked" : ""}>
            启用自动调优
          </label>
          <label>最低间隔
            <input id="rlp-min-interval" class="rlp-input rlp-config-control" type="number" min="0" max="5000" value="${state.minInterval}" style="width:68px"> ms
          </label>
          <label>成功后减小
            <input id="rlp-tune-step" class="rlp-input rlp-config-control" type="number" min="1" max="1000" value="${state.tuneStep}" style="width:68px"> ms
          </label>
          <label>429 后增加
            <input id="rlp-backoff-step" class="rlp-input rlp-config-control" type="number" min="1" max="5000" value="${state.backoffStep}" style="width:68px"> ms
          </label>
          <span class="rlp-row-note">连续两个完整成功批次后按“成功后减小”缩短间隔；遇到 429 时按“429 后增加”放宽间隔。</span>
        </div>

        <div class="rlp-section">控制</div>
        <div class="rlp-row">
          <button class="rlp-btn" id="rlp-start" type="button">开始探测</button>
          <button class="rlp-btn stop" id="rlp-stop" type="button" disabled>停止</button>
          <button class="rlp-btn alt" id="rlp-reset" type="button">恢复默认</button>
        </div>

        <div class="rlp-progress" id="rlp-progress-wrap">
          <div class="rlp-progress-bar" id="rlp-progress-bar" style="width:0"></div>
          <div class="rlp-progress-text" id="rlp-progress-text">0/0</div>
        </div>
        <div class="rlp-status" id="rlp-status"></div>

        <div class="rlp-section">实时统计</div>
        <div class="rlp-stats" id="rlp-stats"></div>

        <div class="rlp-section">结果报告</div>
        <div class="rlp-row">
          <button class="rlp-btn alt" id="rlp-copy-report" type="button">复制报告</button>
          <button class="rlp-btn alt" id="rlp-download-report" type="button">下载 JSON</button>
          <label><input id="rlp-auto-download" class="rlp-config-control" type="checkbox" ${state.autoDownload ? "checked" : ""}> 结束后自动下载</label>
          <span class="rlp-row-note">停止或达到请求上限时自动生成，也会输出到控制台。</span>
        </div>
        <textarea id="rlp-result-output" readonly placeholder="探测结束后自动生成 JSON 报告"></textarea>

        <div class="rlp-section">日志</div>
        <div id="rlp-log"></div>
      </div>
      <div class="rlp-footer">Rate Limit Probe v3 · 多目标 · 多通道 · 连续成功统计 · 可选自动调优</div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;

    document.getElementById("rlp-transport").value = state.transport;
    modal.querySelector(".rlp-close").addEventListener("click", closeModal);
    document.getElementById("rlp-auto-tune").addEventListener("change", syncAutoTuneControls);
    document.getElementById("rlp-use-batch-pause").addEventListener("change", syncBatchPauseControls);
    document.getElementById("rlp-start").addEventListener("click", startProbe);
    document.getElementById("rlp-stop").addEventListener("click", () => stopProbe(false));
    document.getElementById("rlp-reset").addEventListener("click", resetProbe);
    document.getElementById("rlp-copy-report").addEventListener("click", copyReport);
    document.getElementById("rlp-download-report").addEventListener("click", () => downloadReport());
    syncAutoTuneControls();
    syncBatchPauseControls();
    updateStats();
  }

  function openModal() {
    if (modalEl) {
      modalEl.style.display = "";
      const backdrop = document.getElementById("rlp-backdrop");
      if (backdrop) backdrop.style.display = "block";
      return;
    }
    buildModal();
  }

  function injectEntryButton() {
    if (document.getElementById("rlp-entry")) return;
    const target = document.querySelector(".profile_xp_block")
      || document.querySelector(".badges_header")
      || document.body;
    const button = document.createElement("span");
    button.id = "rlp-entry";
    button.textContent = "Rate Limit Probe";
    button.addEventListener("click", openModal);
    if (target.classList.contains("profile_xp_block")) target.appendChild(button);
    else target.insertBefore(button, target.firstChild);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectEntryButton, { once: true });
  } else {
    injectEntryButton();
  }
})();
