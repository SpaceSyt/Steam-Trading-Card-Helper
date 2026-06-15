// ==UserScript==
// @name         Steam Badge Helper
// @name:zh-CN   Steam 徽章助手
// @namespace    https://github.com/SpaceSyt/Steam-Badge-Helper
// @version      1.0.0
// @description  Scan Steam badges, batch query card prices, estimate full set costs
// @description:zh-CN 扫描 Steam 徽章，批量查询卡牌价格，估算全套成本
// @author       SpaceSyt
// @homepageURL  https://github.com/SpaceSyt/Steam-Badge-Helper
// @supportURL   https://github.com/SpaceSyt/Steam-Badge-Helper/issues
// @downloadURL  https://github.com/SpaceSyt/Steam-Badge-Helper/raw/master/steam-badge-helper.user.js
// @updateURL    https://github.com/SpaceSyt/Steam-Badge-Helper/raw/master/steam-badge-helper.user.js
// @match        *://steamcommunity.com/*/badges*
// @match        *://steamcommunity.com/id/*/badges*
// @match        *://steamcommunity.com/profiles/*/badges*
// @match        *://steamcommunity.com/market/multibuy*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const $J = unsafeWindow.jQuery || unsafeWindow.$;
  if (!$J) {
    console.warn("[SBC] jQuery not found");
    return;
  }

  // ============================================================
  // Constants
  // ============================================================
  const DEFAULT_CONFIG = {
    threshold: 5,
    scanInterval: 800,
    requestInterval: 1200,
    batchSize: 20,
    batchPause: 15000,
    includeDrops: false,
    maxBadgePages: 1,
    blacklist: "",
    blacklistNames: "{}",
    buyMode: "complete5",
    buffer: 0.10,
  };

  const CURRENCY_CNY = 23;

  // ============================================================
  // Config
  // ============================================================
  function loadConfig() {
    try {
      const raw = GM_getValue("sbc_config", null);
      if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    } catch (e) {
      console.warn("[SBC] Config load failed:", e);
    }
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig(cfg) {
    GM_setValue("sbc_config", JSON.stringify(cfg));
  }

  function getProfileUrl() {
    if (unsafeWindow.g_strProfileURL) return unsafeWindow.g_strProfileURL;
    const a = document.querySelector("#global_actions a.user_avatar");
    return a ? a.href.replace(/\/$/, "") : null;
  }

  function getWalletCurrency() {
    if (unsafeWindow.g_rgWalletInfo && typeof unsafeWindow.g_rgWalletInfo.wallet_currency === "number") {
      return unsafeWindow.g_rgWalletInfo.wallet_currency;
    }
    return CURRENCY_CNY;
  }

  function formatCNY(cents) {
    if (cents == null || isNaN(cents)) return "?";
    return (cents / 100).toFixed(2);
  }

  // ============================================================
  // Request Queue
  // ============================================================
  class RequestQueue {
    constructor(interval = 300, batchSize = 18, batchPause = 3500, state = null, onStatus = null) {
      this.interval = interval;
      this.batchSize = batchSize;
      this.batchPause = batchPause;
      this.state = state;
      this.onStatus = onStatus;
      this.queue = [];
      this.running = false;
      this.stopped = false;
      this._consecutive429 = 0;
      this._reqCount = 0;
    }

    async fetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.stopped) { reject({ status: 0, error: "stopped" }); return; }
        this.queue.push({ url, options, resolve, reject });
        this._run();
      });
    }

    async _run() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.queue.length > 0 && !this.stopped) {
          const job = this.queue.shift();
          try {
            const res = await window.fetch(job.url, {
              credentials: "include",
              ...job.options,
            });

            if (res.status === 429) {
              this._consecutive429++;
              this.queue.unshift(job);
              const backoff = [20000, 45000, 90000, 180000, 360000][this._consecutive429 - 1] || 360000;
              if (this.onStatus) this.onStatus(`限流冷却中 (第${this._consecutive429}次, ${(backoff/1000).toFixed(0)}s)`, true);
              for (let tick = 0; tick < backoff / 500; tick++) {
                await new Promise(r => setTimeout(r, 500));
                if (this.stopped) break;
                if (this.state?.skipCurrent || this.state?.stopRequested) break;
              }
              if (this.state?.skipCurrent) {
                this.state.skipCurrent = false;
                job.reject({ status: 429, error: "skipped by user" });
                continue;
              }
              if (this.state?.stopRequested || this.stopped) {
                job.reject({ status: 0, error: "stopped" });
                continue;
              }
              continue;
            }
            this._consecutive429 = 0;
            if (this.onStatus) this.onStatus("扫描卡牌价格中", true);

            if (res.status >= 500) {
              await new Promise(r => setTimeout(r, this.interval * 3));
            }

            const text = await res.text();
            let data = null;
            try { data = JSON.parse(text); } catch (_) {}

            if (!res.ok) {
              job.reject({ status: res.status, text, data });
            } else {
              job.resolve({ status: res.status, text, data });
            }
          } catch (e) {
            job.reject({ error: e?.message || String(e) });
          }

          // adaptive delay: after N fast requests, pause to avoid rate limit
          this._reqCount++;
          if (this._reqCount >= this._batchSize) {
            this._reqCount = 0;
            await new Promise(r => setTimeout(r, this.batchPause));
          } else {
            await new Promise(r => setTimeout(r, this.interval));
          }
        }
      } finally {
        this.running = false;
      }

      if (this.queue.length > 0 && !this.stopped) this._run();
    }

    stop() {
      this.stopped = true;
      // reject all pending jobs so their promises resolve and loops can exit
      for (const job of this.queue) {
        if (job.reject) job.reject({ status: 0, error: "stopped" });
      }
      this.queue = [];
    }
    clear() { this.queue = []; }
  }

  // ============================================================
  // Scanner (Phase 1: quick scan badges list)
  // ============================================================
  async function scanBadgePages(cfg, onProgress, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("Profile URL not found");

    // detect current sort from URL, default to "p" (in progress)
    const curUrl = new URL(window.location.href);
    const curSort = curUrl.searchParams.get("sort") || "p";

    const candidates = [];
    const seen = new Set();
    const perPage = 150;

    for (let page = 1; page <= cfg.maxBadgePages; page++) {
      const rangeStart = (page - 1) * perPage + 1;
      const rangeEnd = page * perPage;
      onProgress?.(`正在扫描徽章 ${rangeStart}-${rangeEnd} (页${page})...`);
      const url = `${profileUrl}/badges/?sort=${curSort}&p=${page}`;
      const res = await queue.fetch(url);
      if (!res || !res.text) {
        if (page === 1) throw new Error(`Failed to fetch badges: ${res?.status}`);
        break;
      }
      const doc = new DOMParser().parseFromString(res.text, "text/html");

      const rows = doc.querySelectorAll(".badge_row");
      const actualEnd = Math.min(rangeEnd, rangeStart + rows.length - 1);
      if (rows.length === 0) break;

      let pageCandidateCount = 0;

      for (const row of rows) {
        const overlay = row.querySelector(".badge_row_overlay");
        if (!overlay) continue;
        const href = overlay.getAttribute("href") || "";

        // extract appid from /gamecards/{appid}/ or /badges/{appid}/
        const m = href.match(/\/(?:gamecards|badges)\/(\d+)\/?(\?|$)/);
        if (!m) continue;
        const appid = m[1];
        const isFoil = href.includes("border=1");
        const key = `${appid}_${isFoil ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);

        // skip completed badges (no card progress shown)
        const progressEl = row.querySelector(".badge_progress_info");
        if (!progressEl) continue;
        const progressText = progressEl.textContent.trim();
        // "已收集 X / Y 张卡牌" or "Collected X / Y cards"
        const countMatch = progressText.match(/(\d+)\s*\/\s*(\d+)/);
        if (!countMatch) continue;
        const owned = parseInt(countMatch[1], 10);
        const totalInSet = parseInt(countMatch[2], 10);

        // only keep badges with partial progress (have SOME cards, but NOT all)
        if (owned === 0 || owned >= totalInSet) continue;

        // game name
        const titleEl = row.querySelector(".badge_title");
        let gameName = "";
        if (titleEl) {
          gameName = (titleEl.querySelector(".badge_title_row")?.textContent
            || titleEl.textContent)
            .replace(/(?:View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
            .trim();
        }

        // drops remaining
        let dropsRemaining = 0;
        const dropsEl = row.querySelector(".progress_info_bold");
        if (dropsEl) {
          const dt = dropsEl.textContent;
          const dm = dt.match(/(\d+)\s*(?:张剩余卡牌掉落|card drops? remaining)/i);
          if (dm) dropsRemaining = parseInt(dm[1], 10);
        }

        candidates.push({ appid, isFoil, gameName, owned, totalInSet, dropsRemaining });
        pageCandidateCount++;
      }

      onProgress?.(`徽章 ${rangeStart}-${actualEnd}: ${pageCandidateCount} 个有未完成进度 (共 ${rows.length} 个徽章)`);

      const nextLink = doc.querySelector(`a.pagebtn[href*="p=${page + 1}"]`);
      if (!nextLink) break;

      await new Promise(r => setTimeout(r, cfg.scanInterval));
    }

    onProgress?.(`徽章列表扫描完成, 共 ${candidates.length} 个有未完成进度`);
    return candidates;
  }

  // ============================================================
  // Game Cards Parser
  // ============================================================
  function parseGameCardsHtml(html, appid, isFoil) {
    const doc = new DOMParser().parseFromString(html, "text/html");

    // game name from title
    let gameName = "";
    const titleEl = doc.querySelector(".badge_title");
    if (titleEl) {
      gameName = (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent)
        .replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
        .replace(/徽章$/i, "").trim();
    }

    // level from meta description: "徽章（0 级）" or "Badge (Level 0)"
    let level = 0;
    const metaDesc = doc.querySelector('meta[name="Description"]')?.content || "";
    const lm = metaDesc.match(/(?:徽章[（(](\d+)\s*级|Badge\s*\(Level\s*(\d+)\))/i);
    if (lm) level = parseInt(lm[1] || lm[2], 10);

    // drops remaining
    let dropsRemaining = 0;
    const progressBold = doc.querySelector(".progress_info_bold");
    if (progressBold) {
      const txt = progressBold.textContent;
      const dm = txt.match(/(\d+)\s*card drops?\s*remaining/i) || txt.match(/(\d+)\s*张剩余卡牌掉落/);
      if (dm) dropsRemaining = parseInt(dm[1], 10);
    }

    // Parse card info from badge_card_set_card: name + owned count (IN ORDER)
    const cardSetCards = doc.querySelectorAll(".badge_card_set_card");
    const cardList = [];
    cardSetCards.forEach((el, idx) => {
      const titleNode = el.querySelector(".badge_card_set_title");
      if (!titleNode) return;
      const qtyNode = el.querySelector(".badge_card_set_text_qty");
      const owned = qtyNode ? (parseInt(qtyNode.textContent.replace(/[()（）\[\]]/g, ""), 10) || 0) : 0;
      let name = titleNode.textContent.trim();
      if (qtyNode) {
        name = name.replace(qtyNode.textContent, "").trim();
      }
      cardList.push({ name, owned, marketHashName: "", idx });
    });

    // Primary: match market hash names from multibuy URL (has ALL cards, IN ORDER)
    const multibuyBtn = doc.querySelector('a[href*="multibuy"]');
    if (multibuyBtn) {
      const mbHref = multibuyBtn.getAttribute("href") || "";
      let items = [];
      try {
        const mbUrl = new URL(mbHref, window.location.origin);
        items = mbUrl.searchParams.getAll("items[]");
      } catch (_) {
        const m = mbHref.match(/[?&]items\[\]=([^&]+)/g) || [];
        items = m.map(s => {
          try { return decodeURIComponent(s.replace(/[?&]items\[\]=/, "").replace(/&$/, "")); } catch (_) { return s; }
        });
      }
      for (let i = 0; i < Math.min(items.length, cardList.length); i++) {
        cardList[i].marketHashName = items[i];
      }
    }

    // Secondary: badge_card_to_collect links (fills any gaps)
    const toCollect = doc.querySelectorAll(".badge_card_to_collect");
    toCollect.forEach(tc => {
      const titleNode = tc.querySelector(".badge_card_set_title");
      const marketLink = tc.querySelector('a[href*="/market/listings/"]');
      if (!titleNode || !marketLink) return;
      const name = titleNode.textContent.trim();
      const href = marketLink.getAttribute("href") || "";
      const m = href.match(/\/market\/listings\/\d+\/(.+?)(?:\?|$)/);
      if (!m) return;
      let mhn = "";
      try { mhn = decodeURIComponent(m[1]); } catch (_) { mhn = m[1]; }
      // find card by name and fill if missing
      for (const card of cardList) {
        if (card.name === name && !card.marketHashName) {
          card.marketHashName = mhn;
          break;
        }
      }
    });
    const totalInSet = cardList.length;
    if (totalInSet === 0) {
      return { gameName, level, totalInSet: 0, dropsRemaining, cards: cardList, need: 0, setsToLevel5: 0 };
    }

    // single set calculation
    const cappedOwned = cardList.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const need = Math.max(0, totalInSet - cappedOwned);
    const setsToLevel5 = Math.max(0, 5 - level);

    return {
      gameName,
      level,
      totalInSet,
      dropsRemaining,
      cards: cardList,
      need,
      setsToLevel5,
    };
  }
  // ============================================================
  function parsePrice(str) {
    if (!str) return 0;
    const n = parseFloat(str.replace(/[^0-9.,]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }

  async function priceCard(marketHashName, queue) {
    try {
      const url = `https://steamcommunity.com/market/priceoverview/?appid=753&currency=23&market_hash_name=${encodeURIComponent(marketHashName)}`;
      const res = await queue.fetch(url);

      if (!res?.data?.success) {
        return null;
      }

      const lowestCents = parsePrice(res.data.lowest_price);
      if (!lowestCents) return null;

      const medianCents = parsePrice(res.data.median_price);
      const volume = parseInt(res.data.volume, 10) || 0;

      return { lowestSellCents: lowestCents, medianCents, volume };
    } catch (e) {
      return null;
    }
  }

  // ============================================================
  // CSS
  // ============================================================
  GM_addStyle(`
    .sbc-btn-entry {
      display: inline-block;
      padding: 6px 12px;
      margin-left: 10px;
      background: rgba(67, 137, 179, 0.85);
      color: #fff;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }
    .sbc-btn-entry:hover { background: rgba(87, 157, 199, 1); }

    #sbc-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: none;
    }
    #sbc-modal {
      position: fixed;
      left: 50%; top: 20px;
      transform: translateX(-50%);
      width: 1060px; max-width: 95vw;
      height: 92vh;
      background: #1b2838;
      color: #c6d4df;
      z-index: 10001;
      border-radius: 4px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      font-family: "Motiva Sans", Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 0 30px rgba(0,0,0,0.6);
    }
    #sbc-modal .sbc-header {
      padding: 10px 16px;
      border-bottom: 1px solid #45556b;
      display: flex;
      align-items: center;
      background: #171a21;
    }
    #sbc-modal .sbc-header h2 {
      margin: 0; font-size: 20px; flex: 1; color: #fff;
    }
    #sbc-modal .sbc-close {
      cursor: pointer; font-size: 22px; color: #8f98a0;
    }
    #sbc-modal .sbc-close:hover { color: #fff; }
    #sbc-modal .sbc-body {
      flex: 1; overflow-y: hidden; padding: 12px 16px;
      display: flex; flex-direction: column;
      min-height: 0;
    }
    #sbc-modal .sbc-footer {
      padding: 10px 16px;
      background: #171a21;
      border-top: 1px solid #45556b;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .sbc-input {
      background: #0e1621;
      color: #fff;
      border: 1px solid #45556b;
      padding: 5px 8px;
      border-radius: 2px;
      width: 80px;
      font-size: 14px;
    }
    .sbc-input:focus { border-color: #66c0f4; outline: none; }
    .sbc-label { font-size: 14px; color: #8f98a0; }
    .sbc-btn {
      padding: 8px 16px;
      background: linear-gradient(to bottom, #75b022 5%, #588a1b 95%);
      color: #fff;
      border-radius: 2px;
      cursor: pointer;
      font-size: 15px;
      user-select: none;
    }
    .sbc-btn:hover { background: linear-gradient(to bottom, #8ed629 5%, #6aa621 95%); }
    .sbc-btn.disabled {
      background: #2a3f5a;
      color: #667;
      cursor: not-allowed;
      opacity: 0.6;
    }
    .sbc-btn.alt {
      background: linear-gradient(to bottom, #67c1f5 5%, #417a9b 95%);
    }
    .sbc-btn.alt:hover {
      background: linear-gradient(to bottom, #8ed8ff 5%, #5297b7 95%);
    }

    .sbc-game-list {
      max-height: 30vh;
      overflow-y: auto;
      border: 1px solid #2a3f5a;
      border-radius: 3px;
      background: rgba(0,0,0,0.2);
    }
    .sbc-game-row {
      padding: 6px 14px;
      border-bottom: 1px solid rgba(69,85,107,0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    .sbc-row-header {
      color: #8f98a0;
      font-size: 12px;
      font-weight: bold;
      border-bottom: 2px solid #45556b;
      padding-bottom: 6px;
      margin-bottom: 2px;
    }
    .sbc-game-row:hover { background: rgba(103,193,245,0.08); }
    .sbc-game-row .sbc-appid {
      width: 50px;
      flex-shrink: 0;
      color: #66c0f4;
      font-family: monospace;
      font-size: 12px;
    }
    .sbc-game-row .sbc-name {
      flex: 1;
      color: #e2e2e2;
      font-size: 13px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sbc-game-row .sbc-level {
      width: 50px;
      flex-shrink: 0;
      color: #a1b053;
      font-size: 12px;
      text-align: center;
    }
    .sbc-game-row .sbc-cards {
      width: 40px;
      flex-shrink: 0;
      color: #c6d4df;
      font-size: 12px;
      text-align: center;
    }
    .sbc-game-row .sbc-cost {
      width: 75px;
      flex-shrink: 0;
      color: #75b022;
      font-weight: bold;
      font-size: 13px;
      text-align: right;
    }
    .sbc-game-row .sbc-full {
      width: 80px;
      flex-shrink: 0;
      color: #ffc902;
      font-size: 12px;
      text-align: right;
    }
    .sbc-game-row .sbc-lv5 {
      width: 80px;
      flex-shrink: 0;
      color: #e74c3c;
      font-size: 12px;
      text-align: right;
    }
    .sbc-game-row .sbc-drops {
      width: 55px;
      flex-shrink: 0;
      color: #8db7d7;
      font-size: 12px;
      text-align: center;
    }
    .sbc-game-row .sbc-select {
      width: 50px;
      flex-shrink: 0;
      text-align: center;
    }
    .sbc-toolbar {
      display: flex;
      gap: 14px;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      font-size: 14px;
      color: #8f98a0;
    }
    .sbc-toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .sbc-primary-label { color: #fff !important; font-weight: bold; }

    .sbc-status-text { color: #8db7d7; font-size: 13px; padding: 6px 0; min-height: 20px; }

    .sbc-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 10px;
      border-bottom: 1px solid #45556b;
    }
    .sbc-tab {
      padding: 6px 16px;
      background: rgba(0,0,0,0.3);
      color: #8f98a0;
      cursor: pointer;
      border-radius: 3px 3px 0 0;
      font-size: 14px;
      user-select: none;
    }
    .sbc-tab:hover { color: #fff; background: rgba(103,193,245,0.1); }
    .sbc-tab.active { color: #fff; background: #1b2838; border: 1px solid #45556b; border-bottom-color: #1b2838; }
    .sbc-tab-content { display: none; }
    .sbc-tab-content.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }

    .sbc-bl-form {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .sbc-bl-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      border: 1px solid #2a3f5a;
      border-radius: 3px;
      background: rgba(0,0,0,0.2);
    }
    .sbc-bl-row {
      padding: 6px 14px;
      border-bottom: 1px solid rgba(69,85,107,0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
    }
    .sbc-bl-row:hover { background: rgba(103,193,245,0.08); }
    .sbc-bl-row .sbc-bl-id { width: 70px; color: #66c0f4; font-family: monospace; }
    .sbc-bl-row .sbc-bl-name { flex: 1; color: #e2e2e2; }
    .sbc-bl-row .sbc-bl-del { color: #c04040; cursor: pointer; font-size: 16px; user-select: none; }
    .sbc-bl-row .sbc-bl-del:hover { color: #ff6060; }

    .sbc-bl-result { color: #75b022; font-size: 14px; }

    #sbc-log {
      margin-top: 10px;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      background: #0e1621;
      border-radius: 3px;
      padding: 10px;
      font-family: "Courier New", monospace;
      font-size: 13px;
      line-height: 1.5;
      color: #b0c3d9;
      white-space: pre-wrap;
      word-break: break-all;
    }
    #sbc-log .ok { color: #75b022; }
    #sbc-log .warn { color: #ffc902; }
    #sbc-log .err { color: #c04040; }
    #sbc-log .info { color: #67c1f5; }

    .sbc-progress {
      height: 20px;
      background: #0e1621;
      border-radius: 2px;
      overflow: hidden;
      margin: 8px 0;
      position: relative;
    }
    .sbc-progress-bar {
      height: 100%;
      background: linear-gradient(to right, #75b022, #8ed629);
      transition: width 0.2s;
    }
    .sbc-progress-text {
      position: absolute;
      inset: 0;
      text-align: center;
      font-size: 13px;
      line-height: 20px;
      color: #fff;
    }

    .sbc-summary {
      font-size: 14px;
      color: #8f98a0;
      margin: 8px 0;
    }
    .sbc-summary b { color: #fff; }
  `);

  // ============================================================
  // UI
  // ============================================================
  function injectEntryBtn() {
    const target = document.querySelector(".profile_xp_block")
      || document.querySelector(".badges_header")
      || document.body;

    const btn = document.createElement("span");
    btn.className = "sbc-btn-entry";
    btn.textContent = "Steam Badge Helper";
    btn.addEventListener("click", openModal);

    if (target.classList.contains("profile_xp_block")) {
      target.appendChild(btn);
    } else {
      target.insertBefore(btn, target.firstChild);
    }
  }

  let modalEl = null;
  const state = {
    cfg: loadConfig(),
    results: [],
    scanning: false,
    stopRequested: false,
    skipCurrent: false,
    queue: null,
  };

  function openModal() {
    if (modalEl) { modalEl.style.display = ""; return; }
    buildModal();
  }

  function buildModal() {
    const backdrop = document.createElement("div");
    backdrop.id = "sbc-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.id = "sbc-modal";
    modal.addEventListener("click", e => e.stopPropagation());
    modal.innerHTML = `
      <div class="sbc-header">
        <h2>Steam 徽章助手</h2>
        <span class="sbc-close" title="关闭">✕</span>
      </div>
      <div class="sbc-body">
        <div class="sbc-tabs">
          <span class="sbc-tab active" data-tab="scan">价格扫描</span>
          <span class="sbc-tab" data-tab="blacklist">黑名单</span>
        </div>
        <div class="sbc-tab-content active" id="sbc-tab-scan">
          <div class="sbc-toolbar">
            <label class="sbc-primary-label">单套卡牌价格上限 ¥ <input id="sbc-threshold" class="sbc-input" type="number" min="0" step="0.5" value="${state.cfg.threshold}"></label>
            <label class="sbc-primary-label">购买卡牌逻辑 <select id="sbc-buy-mode" class="sbc-input" style="width:110px">
              <option value="complete1" ${state.cfg.buyMode === "complete1" ? "selected" : ""}>补全单套</option>
              <option value="complete5" ${state.cfg.buyMode === "complete5" ? "selected" : ""}>补全五套</option>
              <option value="buy1" ${state.cfg.buyMode === "buy1" ? "selected" : ""}>购买单套</option>
              <option value="buy5" ${state.cfg.buyMode === "buy5" ? "selected" : ""}>购买五套</option>
            </select></label>
            <label class="sbc-primary-label">价格上浮 ¥ <input id="sbc-buffer" class="sbc-input" type="number" min="0" step="0.01" value="${state.cfg.buffer}" style="width:60px"></label>
            <label>最大徽章页数 <input id="sbc-max-pages" class="sbc-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <label>
              <input id="sbc-include-drops" type="checkbox" ${state.cfg.includeDrops ? "checked" : ""}>
              包含有掉落卡牌的游戏
            </label>
          </div>
          <div class="sbc-toolbar" style="margin-bottom:6px">
            <label>请求间隔 ms <input id="sbc-req-interval" class="sbc-input" type="number" min="100" step="100" value="${state.cfg.requestInterval}" style="width:70px"></label>
            <label>扫描间隔 ms <input id="sbc-scan-interval" class="sbc-input" type="number" min="200" step="100" value="${state.cfg.scanInterval}"></label>
            <label>每 <input id="sbc-batch-size" class="sbc-input" type="number" min="5" step="1" value="${state.cfg.batchSize}" style="width:55px"> 次快速price请求后暂停</label>
            <label><input id="sbc-batch-pause" class="sbc-input" type="number" min="500" step="500" value="${state.cfg.batchPause}" style="width:75px"> ms</label>
          </div>
          <div style="display:flex; gap:10px; margin-bottom:8px;">
            <div class="sbc-btn" id="sbc-scan-btn">开始扫描</div>
            <div class="sbc-btn alt disabled" id="sbc-stop-btn">停止</div>
            <div class="sbc-btn alt disabled" id="sbc-skip-btn" title="跳过当前徽章">跳过当前</div>
          </div>
          <div class="sbc-progress" id="sbc-progress-wrap" style="display:none">
            <div class="sbc-progress-bar" id="sbc-progress-bar" style="width:0"></div>
            <div class="sbc-progress-text" id="sbc-progress-text">0/0</div>
          </div>
          <div class="sbc-summary" id="sbc-summary"></div>
          <div class="sbc-status-text" id="sbc-status"></div>
          <div class="sbc-game-list" id="sbc-list"></div>
          <div id="sbc-log"></div>
        </div>
        <div class="sbc-tab-content" id="sbc-tab-blacklist">
          <div class="sbc-bl-form">
            <label>游戏 AppID <input id="sbc-bl-appid" class="sbc-input" type="text" style="width:100px" placeholder="例如: 261640"></label>
            <div class="sbc-btn alt" id="sbc-bl-lookup">查询游戏</div>
            <span class="sbc-bl-result" id="sbc-bl-result"></span>
          </div>
          <div class="sbc-bl-form">
            <div class="sbc-btn" id="sbc-bl-add" style="display:none;">加入黑名单</div>
          </div>
          <div class="sbc-bl-list" id="sbc-bl-list"></div>
        </div>
      </div>
      <div class="sbc-footer">
        <span class="sbc-label">V1.0.0 · 默认货币：人民币(CNY)</span>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;

    modal.querySelector(".sbc-close").addEventListener("click", closeModal);

    const cfgIds = ["sbc-threshold", "sbc-scan-interval",
      "sbc-req-interval", "sbc-max-pages", "sbc-include-drops",
      "sbc-batch-size", "sbc-batch-pause", "sbc-buy-mode", "sbc-buffer"];
    cfgIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        state.cfg.threshold = parseFloat(document.getElementById("sbc-threshold").value) || 0;
        state.cfg.scanInterval = parseInt(document.getElementById("sbc-scan-interval").value, 10) || 800;
        state.cfg.requestInterval = parseInt(document.getElementById("sbc-req-interval").value, 10) || 800;
        state.cfg.maxBadgePages = parseInt(document.getElementById("sbc-max-pages").value, 10) || 5;
        state.cfg.includeDrops = document.getElementById("sbc-include-drops").checked;
        state.cfg.batchSize = parseInt(document.getElementById("sbc-batch-size").value, 10) || 18;
        state.cfg.batchPause = parseInt(document.getElementById("sbc-batch-pause").value, 10) || 15000;
        state.cfg.buyMode = document.getElementById("sbc-buy-mode").value;
        state.cfg.buffer = parseFloat(document.getElementById("sbc-buffer").value) || 0;
        saveConfig(state.cfg);
      });
    });

    // Tab switching
    modal.querySelectorAll(".sbc-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        modal.querySelectorAll(".sbc-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        const tabName = tab.dataset.tab;
        modal.querySelectorAll(".sbc-tab-content").forEach(c => c.classList.remove("active"));
        document.getElementById(`sbc-tab-${tabName}`).classList.add("active");
        if (tabName === "blacklist") renderBlacklist();
      });
    });

    document.getElementById("sbc-scan-btn").addEventListener("click", startScan);
    document.getElementById("sbc-stop-btn").addEventListener("click", requestStop);
    document.getElementById("sbc-skip-btn").addEventListener("click", skipCurrentBadge);

    // Blacklist tab
    let blLookupAppid = "";
    let blLookupName = "";
    document.getElementById("sbc-bl-lookup").addEventListener("click", () => {
      const appid = document.getElementById("sbc-bl-appid").value.trim();
      if (!appid || !/^\d+$/.test(appid)) {
        document.getElementById("sbc-bl-result").textContent = "请输入有效的 AppID";
        return;
      }
      document.getElementById("sbc-bl-result").textContent = "查询中...";
      document.getElementById("sbc-bl-add").style.display = "none";
      lookupGameName(appid).then(name => {
        blLookupAppid = appid;
        blLookupName = name;
        document.getElementById("sbc-bl-result").textContent = name ? `${appid} — ${name}` : "未找到该游戏";
        if (name) {
          document.getElementById("sbc-bl-add").style.display = "";
        }
      });
    });

    document.getElementById("sbc-bl-add").addEventListener("click", () => {
      if (!blLookupAppid || !blLookupName) return;
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
      if (bl.includes(blLookupAppid)) {
        document.getElementById("sbc-bl-result").textContent = "该游戏已在黑名单中";
        return;
      }
      bl.push(blLookupAppid);
      state.cfg.blacklist = bl.join(",");

      let names = {};
      try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}
      names[blLookupAppid] = blLookupName;
      state.cfg.blacklistNames = JSON.stringify(names);

      saveConfig(state.cfg);
      document.getElementById("sbc-bl-add").style.display = "none";
      document.getElementById("sbc-bl-result").textContent = `${blLookupName} 已加入黑名单`;
      document.getElementById("sbc-bl-appid").value = "";
      blLookupAppid = "";
      blLookupName = "";
      renderBlacklist();
    });

    renderBlacklist();
  }

  function skipCurrentBadge() {
    state.skipCurrent = true;
    log("跳过当前徽章...", "warn");
  }

  function closeModal() {
    if (state.scanning) {
      state.stopRequested = true;
      state.queue?.stop();
    }
    document.getElementById("sbc-backdrop")?.remove();
    modalEl?.remove();
    modalEl = null;
  }

  // ============================================================
  // Logging / Progress
  // ============================================================
  function log(msg, type = "") {
    const box = document.getElementById("sbc-log");
    if (!box) { console.log("[SBC]", msg); return; }
    const line = document.createElement("div");
    if (type) line.className = type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function setProgress(done, total, text = "") {
    const wrap = document.getElementById("sbc-progress-wrap");
    const bar = document.getElementById("sbc-progress-bar");
    const ptxt = document.getElementById("sbc-progress-text");
    if (!wrap) return;
    wrap.style.display = "";
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    bar.style.width = pct + "%";
    ptxt.textContent = text || `${done}/${total}`;
  }

  function hideProgress() {
    const wrap = document.getElementById("sbc-progress-wrap");
    if (wrap) wrap.style.display = "none";
  }

  function setSummary(html) {
    const el = document.getElementById("sbc-summary");
    if (el) el.innerHTML = html;
  }

  // ============================================================
  // Animated status
  // ============================================================
  let statusTimer = null;
  function setStatus(text, animate = true) {
    const el = document.getElementById("sbc-status");
    if (!el) return;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (!text) { el.textContent = ""; return; }
    if (!animate) { el.textContent = text; return; }
    el.textContent = text;
    let dots = 0;
    statusTimer = setInterval(() => {
      dots = (dots + 1) % 4;
      el.textContent = text + " " + ".".repeat(dots);
    }, 500);
  }

  // ============================================================
  // Scan flow
  // ============================================================
  function setScanPhase(phase) {
    const btn = document.getElementById("sbc-scan-btn");
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

  async function startScan() {
    if (state.scanning) return;
    state.scanning = true;
    state.stopRequested = false;
    state.skipCurrent = false;
    state.results = [];
    document.getElementById("sbc-list").innerHTML = "";
    document.getElementById("sbc-log").innerHTML = "";
    document.getElementById("sbc-scan-btn").classList.add("disabled");
    document.getElementById("sbc-skip-btn").classList.remove("disabled");
    document.getElementById("sbc-stop-btn").classList.remove("disabled");
    setScanPhase("scanning");
    setStatus("正在扫描徽章页");

    const cfg = state.cfg;
    const queue = new RequestQueue(cfg.requestInterval, cfg.batchSize, cfg.batchPause, state, setStatus);


    state.queue = queue;
    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      log("未找到 Profile URL", "err");
      state.scanning = false;
      state.queue = null;
      hideProgress();
      document.getElementById("sbc-scan-btn").classList.remove("disabled");
      document.getElementById("sbc-skip-btn").classList.add("disabled");
      document.getElementById("sbc-stop-btn").classList.add("disabled");
      return;
    }

    try {
      log("【阶段 1/3】正在扫描徽章页 (找有未完成进度的游戏)...");
      setProgress(0, 1, "阶段1: 扫描徽章页列表中...");
      setScanPhase("phase1");
      const badges = await scanBadgePages(cfg, msg => log(msg, "info"), queue);

      if (badges.length === 0) {
        log("未找到任何有未完成进度的徽章", "warn");
        setSummary("扫描完成: 未找到有未完成进度的徽章");
        setStatus(null);
        setScanPhase("done");
        return;
      }

      log(`找到 ${badges.length} 个有未完成进度的徽章，开始逐个获取卡牌详情`);
      log("【阶段 2/3】逐个获取卡牌页 + 查价中...");
      setProgress(0, badges.length, `阶段2: 获取卡牌详情 0/${badges.length}`);
      setScanPhase("phase2");
      setStatus("扫描卡牌价格中");

      let processed = 0;
      let skipped = 0;
      const thresholdCents = Math.round(cfg.threshold * 100);

      for (const b of badges) {
            if (state.stopRequested || state.skipCurrent) { log("已手动停止", "warn"); break; }
            // blacklist check
            const blAppids = (cfg.blacklist || "").split(",").map(s => s.trim()).filter(Boolean);
            if (blAppids.includes(String(b.appid))) {
              log(`[${b.appid}] ${b.gameName || ""}: 在黑名单中, 跳过`, "info");
              skipped++;
              continue;
            }
        processed++;
        setProgress(processed, badges.length,
          `阶段2: 获取卡牌详情 ${processed}/${badges.length} · ${b.gameName || b.appid}`);

        try {
          if (state.stopRequested || state.skipCurrent) { skipped++; continue; }
          if (state.skipCurrent) {
            state.skipCurrent = false;
            log(`[${b.appid}] 跳过 (手动)`, "warn");
            skipped++;
            continue;
          }
          const suffix = b.isFoil ? "?border=1" : "";
          const url = `${profileUrl}/gamecards/${b.appid}/${suffix}`;
          let res;
          try {
            res = await queue.fetch(url);
          } catch (fetchErr) {
            if (state.stopRequested || state.skipCurrent) {
              if (state.skipCurrent) { state.skipCurrent = false; log("已跳过当前徽章", "warn"); skipped++; }
              else { log("已手动停止", "warn"); }
              if (state.stopRequested) break;
              continue;
            }
            log(`[${b.appid}] ${b.gameName || ""}: 拉取 gamecards 网络错误`, "warn");
            skipped++;
            continue;
          }
          if (!res || !res.text) {
            log(`[${b.appid}] ${b.gameName || ""}: 拉取 gamecards 失败`, "warn");
            skipped++;
            continue;
          }
          // skip non-trading-card badges
          if (!res.text.includes('badge_card_set_card')) {
            log(`[${b.appid}] ${b.gameName || ""}: 无卡牌套组 (可能是社区徽章)`, "info");
            skipped++;
            continue;
          }

          const info = parseGameCardsHtml(res.text, b.appid, b.isFoil);
          info.appid = b.appid;
          info.isFoil = b.isFoil;
          info.gameName = b.gameName || info.gameName || "";
          info.cardPrices = [];
          info.cheapestSetCostCents = 0;
          info.fullSetCostCents = 0;
          info.level5CostCents = 0;

          if (info.totalInSet === 0 || info.need === 0) {
            log(`[${b.appid}] ${info.gameName}: Lv${info.level}, 套卡完整或无卡牌`, "info");
            skipped++;
            continue;
          }

          if (!cfg.includeDrops && info.dropsRemaining > 0) {
            log(`[${b.appid}] ${info.gameName}: 还有 ${info.dropsRemaining} 张掉落，跳过 (可勾选"包含有掉落"来扫描)`, "info");
            skipped++;
            continue;
          }

          if (info.level >= 5) {
            log(`[${b.appid}] ${info.gameName}: 已满级 Lv${info.level}`, "info");
            skipped++;
            continue;
          }

          log(`[${b.appid}] ${info.gameName} Lv${info.level} 缺 ${info.need}/${info.totalInSet} 张, 正在查价...`);

          // Phase 3: price each card type
          let setCostCents = 0;            // 单套补全价: missing for 1 level
          let fullSetCostCents = 0;         // 单套最低价: all cards
          let level5CostCents = 0;          // 满级最低价: to Lv5
          let minVolume = Infinity;          // smallest volume across priced cards
          const setsTo5 = Math.max(0, 5 - info.level);
          let allPriced = true;
          let thresholdSkip = false;

          for (const card of info.cards) {
            if (state.stopRequested || state.skipCurrent) break;
            if (!card.marketHashName) {
              log(`  ⚠ 卡牌 "${card.name}" 无 market hash name, 跳过此游戏`, "warn");
              allPriced = false;
              break;
            }

            const pk = await priceCard(card.marketHashName, queue);
            if (!pk) {
              log(`  ⚠ 卡牌 "${card.name}" (market: ${card.marketHashName}) 查价失败, 跳过此游戏`, "warn");
              allPriced = false;
              break;
            }
            if (pk.lowestSellCents == null) {
              log(`  ⚠ 卡牌 "${card.name}" 无卖单, 跳过此游戏`, "warn");
              allPriced = false;
              break;
            }

            card.lowestCents = pk.lowestSellCents;
            card.medianCents = pk.medianCents;
            card.volume = pk.volume;
            if (pk.volume < minVolume) minVolume = pk.volume;
            info.cardPrices.push({
              name: card.name,
              lowestCents: pk.lowestSellCents,
              medianCents: pk.medianCents,
              volume: pk.volume,
              marketHashName: card.marketHashName,
            });

            const need1 = Math.max(0, 1 - card.owned);
            const need5 = Math.max(0, setsTo5 - card.owned);
            setCostCents += pk.lowestSellCents * need1;
            fullSetCostCents += pk.lowestSellCents;
            // level5: 1st copy at lowest, rest at median
            level5CostCents += need5 > 0
              ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents)
              : 0;

            // smart skip: if full set cost already exceeds threshold
            if (fullSetCostCents > thresholdCents) {
              log(`  → 已查${info.cardPrices.length}/${info.totalInSet}张, 全套 ¥${formatCNY(fullSetCostCents)} > ¥${cfg.threshold}，跳过`, "info");
              allPriced = false;
              thresholdSkip = true;
              break;
            }
          }

          if (!allPriced) {
            if (thresholdSkip) {
              log(`  → 整套卡牌价格已大于上限，跳过`, "info");
            } else {
              log(`  → 部分卡牌无法取价, 跳过`, "warn");
            }
            skipped++;
            continue;
          }

          info.cheapestSetCostCents = setCostCents;
          info.fullSetCostCents = fullSetCostCents;
          info.level5CostCents = level5CostCents;
          info.minVolume = minVolume === Infinity ? 0 : minVolume;
          info.cheapestSetCNY = formatCNY(setCostCents);
          info.fullSetCNY = formatCNY(fullSetCostCents);
          info.level5CNY = formatCNY(level5CostCents);

          if (fullSetCostCents > thresholdCents) {
            log(`  → 整套卡牌价格已大于上限(¥${info.fullSetCNY} > ¥${cfg.threshold})，跳过`, "info");
            skipped++;
            continue;
          }

          state.results.push(info);
          renderGameRow(info);
          log(`  ✓ [${b.appid}] ${info.gameName}: 补全 ¥${info.cheapestSetCNY} | 全套 ¥${info.fullSetCNY} | 满级 ¥${info.level5CNY}`, "ok");

        } catch (e) {
          log(`[${b.appid}] ${b.gameName || ""}: 出错 ${e?.error || e?.status || JSON.stringify(e)}`, "err");
          skipped++;
        }
      }

      const resultCount = state.results.length;
      setSummary(`扫描完成: 扫描 ${processed} 个徽章, 跳过 ${skipped} 个`);
      updateSummary();
      setStatus(null);

      if (resultCount > 0) {
        setScanPhase("phase3");
      } else {
        setScanPhase("done");
      }

    } catch (e) {
      log(`扫描中断: ${e?.message || JSON.stringify(e)}`, "err");
    } finally {
      state.scanning = false;
      state.queue = null;
      hideProgress();
      setStatus(null);
      document.getElementById("sbc-scan-btn").classList.remove("disabled");
      document.getElementById("sbc-skip-btn").classList.add("disabled");
      document.getElementById("sbc-stop-btn").classList.add("disabled");
    }
  }

  // ============================================================
  // Render game row
  // ============================================================
  function renderGameRow(info) {
    const list = document.getElementById("sbc-list");
    // add header on first row
    if (list.children.length === 0) {
      const hdr = document.createElement("div");
      hdr.className = "sbc-game-row sbc-row-header";
      hdr.innerHTML = `
        <span class="sbc-appid">游戏ID</span>
        <span class="sbc-name">游戏名</span>
        <span class="sbc-level">等级</span>
        <span class="sbc-cards">卡牌</span>
        <span class="sbc-cost">单套补全价</span>
        <span class="sbc-full">单套最低价</span>
        <span class="sbc-lv5" title="满级价格不准, 绿色会准一些, 灰色不准">满级价格估算</span>
        <span class="sbc-drops">掉落</span>
        <span class="sbc-select"></span>
      `;
      list.appendChild(hdr);
    }

    const row = document.createElement("div");
    row.className = "sbc-game-row";
    row.dataset.appid = info.appid;
    row.dataset.foil = info.isFoil ? 1 : 0;
    const ownedCards = info.cards.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const lv5Color = (info.minVolume || 0) > 1 ? "color:#4caf50" : (info.minVolume || 0) === 0 ? "color:#888" : "";
    row.innerHTML = `
      <span class="sbc-appid">${info.appid}${info.isFoil ? "(箔)" : ""}</span>
      <span class="sbc-name">${info.gameName || "(未知)"}</span>
      <span class="sbc-level">Lv${info.level}/5</span>
      <span class="sbc-cards">${ownedCards}/${info.totalInSet}</span>
      <span class="sbc-cost">¥${info.cheapestSetCNY}</span>
      <span class="sbc-full">¥${info.fullSetCNY}</span>
      <span class="sbc-lv5" style="${lv5Color}">¥${info.level5CNY}</span>
      <span class="sbc-drops">${info.dropsRemaining}</span>
      <span class="sbc-select"><a href="javascript:void(0)" class="sbc-buy-link" data-appid="${info.appid}" style="text-decoration:underline;color:#66c0f4;cursor:pointer;">购买</a></span>
    `;

    const buyLink = row.querySelector(".sbc-buy-link");
    buyLink.addEventListener("click", (e) => {
      e.stopPropagation();
      openMultibuy(info);
    });

    row.addEventListener("click", (e) => {
      if (e.target.closest(".sbc-buy-link")) return;
      const pUrl = getProfileUrl();
      if (pUrl) window.open(`${pUrl}/gamecards/${info.appid}/`, "_blank");
    });
    row.style.cursor = "pointer";

    list.appendChild(row);
  }

  function updateSummary() {
    const count = state.results.length;
    const totalCNY = (state.results.reduce((s, r) => s + r.cheapestSetCostCents, 0) / 100).toFixed(2);
    const fullCNY = (state.results.reduce((s, r) => s + r.fullSetCostCents, 0) / 100).toFixed(2);
    const lv5CNY = (state.results.reduce((s, r) => s + r.level5CostCents, 0) / 100).toFixed(2);
    document.getElementById("sbc-summary").innerHTML = `
      共 <b>${count}</b> 个 ≤ ¥${state.cfg.threshold} (单套卡牌价格上限)，补全总价 <b>¥${totalCNY}</b>，全套总价 ¥${fullCNY}，满级总价 ¥${lv5CNY}
    `;
  }

  // ============================================================
  // Multibuy
  // ============================================================
  function openMultibuy(info) {
    const cardsWithHash = info.cards.filter(c => c.marketHashName);
    if (cardsWithHash.length === 0) {
      log(`${info.gameName}: 无可用卡牌数据`, "warn");
      return;
    }

    const mode = state.cfg.buyMode || "complete1";
    const params = new URLSearchParams();
    params.set("appid", "753");

    const qtyByCard = [];
    cardsWithHash.forEach(c => {
      let qty;
      switch (mode) {
        case "complete5": qty = Math.max(0, 5 - c.owned); break;
        case "buy1":      qty = 1; break;
        case "buy5":      qty = 5; break;
        default:          qty = c.owned < 1 ? 1 : 0; break; // complete1
      }
      params.append("items[]", c.marketHashName);
      params.append("qty[]", String(qty));
      qtyByCard.push({ card: c, qty });
    });

    const profileUrl = getProfileUrl();
    if (profileUrl) {
      params.set("steamdb_return_to", `${profileUrl}/gamecards/${info.appid}/`);
    }

    const bufferCents = Math.round((state.cfg.buffer || 0) * 100);
    const toBuy = qtyByCard.filter(q => q.qty > 0);
    const buyData = {
      appid: info.appid,
      gameName: info.gameName,
      bufferCents,
      cards: toBuy.map(q => ({
        marketHashName: q.card.marketHashName,
        lowestCents: q.card.lowestCents || 0,
        name: q.card.name,
        qty: q.qty,
      })),
    };

    GM_setValue("sbc_multibuy_data", JSON.stringify(buyData));

    const multibuyUrl = `https://steamcommunity.com/market/multibuy?${params.toString()}`;
    const totalQty = toBuy.reduce((s, q) => s + q.qty, 0);
    log(`${info.gameName}: 打开批量购买 (${totalQty} 张, 模式: ${mode})`, "ok");
    window.open(multibuyUrl, "_blank");
  }

  function initMultibuyAutoFill() {
    console.log("[SBC] multibuy auto-fill init");

    let data;
    try {
      const raw = GM_getValue("sbc_multibuy_data", null);
      if (!raw) { console.log("[SBC] no multibuy data in storage"); return; }
      data = JSON.parse(raw);
    } catch (_) { console.log("[SBC] failed to parse multibuy data"); return; }

    if (!data || !data.cards || data.cards.length === 0) {
      console.log("[SBC] multibuy data empty"); return;
    }

    console.log("[SBC] loaded data:", data.cards.length, "cards, bufferCents:", data.bufferCents);
    const bufferCents = data.bufferCents || 0;

    // Inject "恢复默认价格" button next to Steam's title
    const injectResetBtn = () => {
      const heading = document.querySelector("h2, h1, .market_multibuy_header, .pageheader");
      if (heading && !document.getElementById("sbc-reset-btn")) {
        const btn = document.createElement("span");
        btn.id = "sbc-reset-btn";
        btn.textContent = "恢复默认价格";
        btn.style.cssText = "margin-left:12px;padding:4px 12px;background:rgba(67,137,179,0.85);color:#fff;border-radius:3px;cursor:pointer;font-size:13px;";
        btn.addEventListener("click", () => { location.reload(); });
        heading.appendChild(btn);
      }
    };
    injectResetBtn();

    let fillAttempted = false;
    const tryFill = () => {
      if (fillAttempted) return;

      // Find ALL input elements (not just type=text)
      const allInputs = document.querySelectorAll("input");
      console.log("[SBC] found", allInputs.length, "total inputs on page");

      // Categorize: qty inputs vs price inputs
      const qtyInputs = [];
      const priceInputs = [];
      allInputs.forEach(inp => {
        const name = (inp.getAttribute("name") || "").toLowerCase();
        const cls = (inp.className || "").toLowerCase();
        const placeholder = (inp.getAttribute("placeholder") || "").toLowerCase();
        const t = (inp.type || "").toLowerCase();

        if (name.includes("qty") || name.includes("quantity") || cls.includes("quantity") || placeholder.includes("quantity")) {
          qtyInputs.push(inp);
        } else if (name.includes("price") || cls.includes("price") || placeholder.includes("price") || t === "number") {
          priceInputs.push(inp);
        } else if (t === "text") {
          // Generic text input: determine role by position in row
          const row = inp.closest("tr");
          if (row) {
            const textInputsInRow = row.querySelectorAll("input[type='text']");
            if (textInputsInRow.length === 1 && textInputsInRow[0] === inp) {
              // Only one text input in this row → it's the qty
              qtyInputs.push(inp);
            }
          }
        }
      });
      console.log("[SBC] qty inputs:", qtyInputs.length, "price inputs:", priceInputs.length);

      // Group by parent row (tr or container)
      const rows = new Map();
      const getRowKey = (el) => {
        const tr = el.closest("tr");
        if (tr) return tr;
        return el.closest(".market_multibuy_item") || el.closest(".multibuy_item_row") || el.parentElement;
      };

      // Collect all rows that have at least one of our inputs
      const seenRows = new Set();
      qtyInputs.forEach(inp => {
        const row = getRowKey(inp);
        if (!row) return;
        if (!rows.has(row)) rows.set(row, { qty: null, price: null });
        rows.get(row).qty = inp;
        seenRows.add(row);
      });
      priceInputs.forEach(inp => {
        const row = getRowKey(inp);
        if (!row) return;
        if (!rows.has(row)) rows.set(row, { qty: null, price: null });
        rows.get(row).price = inp;
        seenRows.add(row);
      });

      // Also try matching price inputs to qty rows by looking for price input in same tr
      // If a qty row has no price, search for any input that could be price in the same tr
      rows.forEach((fields, row) => {
        if (!fields.price) {
          const allInRow = row.querySelectorAll("input");
          for (const inp of allInRow) {
            if (inp !== fields.qty && (inp.type === "number" || inp.name.toLowerCase().includes("price") || inp.className.toLowerCase().includes("price"))) {
              fields.price = inp;
              break;
            }
          }
          // Last resort: any non-qty input in the row
          if (!fields.price) {
            for (const inp of allInRow) {
              if (inp !== fields.qty) { fields.price = inp; break; }
            }
          }
        }
      });

      const entries = Array.from(rows.entries()).filter(([_, f]) => f.price);
      console.log("[SBC] rows with price input:", entries.length);

      let filled = 0;
      entries.forEach(([row, fields], idx) => {
        const rowText = row.textContent.trim();

        let card = null;
        for (const c of data.cards) {
          const terms = [c.name, c.marketHashName].filter(Boolean).map(t => decodeURIComponent(t));
          if (terms.some(t => t && rowText.indexOf(t) >= 0)) {
            card = c;
            break;
          }
        }
        if (!card && idx < data.cards.length) card = data.cards[idx];

        if (!card) {
          console.log("[SBC] unmatched row", idx, rowText.substring(0, 60));
          return;
        }

        console.log("[SBC] matched:", card.name, "qty:", card.qty, "lowest:", card.lowestCents);
        if (card.lowestCents != null && fields.price) {
          const p = ((card.lowestCents + bufferCents) / 100).toFixed(2);
          fields.price.value = p;
          fields.price.dispatchEvent(new Event("input", { bubbles: true }));
          fields.price.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (fields.qty) {
          fields.qty.value = String(card.qty || 1);
          fields.qty.dispatchEvent(new Event("input", { bubbles: true }));
          fields.qty.dispatchEvent(new Event("change", { bubbles: true }));
        }
        filled++;
      });

      if (filled > 0) {
        console.log("[SBC] filled", filled, "items, clearing storage");
        fillAttempted = true;
        GM_setValue("sbc_multibuy_data", null);
      }
    };

    let pollCount = 0;
    const poll = () => {
      tryFill();
      if (fillAttempted || ++pollCount >= 20) return;
      setTimeout(poll, 500);
    };
    setTimeout(poll, 600);

    const observer = new MutationObserver(() => {
      if (!fillAttempted) tryFill();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 15000);
  }

  // ============================================================
  // Blacklist management
  // ============================================================
  async function lookupGameName(appid) {
    try {
      const profileUrl = getProfileUrl();
      if (!profileUrl) return null;
      const url = `${profileUrl}/gamecards/${appid}/`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return null;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const titleEl = doc.querySelector(".badge_title");
      if (titleEl) {
        return (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent)
          .replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
          .replace(/徽章$/i, "").trim() || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function renderBlacklist() {
    const list = document.getElementById("sbc-bl-list");
    if (!list) return;
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
    let names = {};
    try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}

    if (bl.length === 0) {
      list.innerHTML = `<div class="sbc-bl-row"><span style="color:#8f98a0">黑名单为空</span></div>`;
      return;
    }

    list.innerHTML = bl.map(appid => {
      const name = names[appid] || "—";
      return `<div class="sbc-bl-row">
        <span class="sbc-bl-id">${appid}</span>
        <span class="sbc-bl-name">${name}</span>
        <span class="sbc-bl-del" data-appid="${appid}" title="移除">✕</span>
      </div>`;
    }).join("");

    list.querySelectorAll(".sbc-bl-del").forEach(btn => {
      btn.addEventListener("click", () => {
        const appid = btn.dataset.appid;
        const newBl = bl.filter(a => a !== appid);
        state.cfg.blacklist = newBl.join(",");
        delete names[appid];
        state.cfg.blacklistNames = JSON.stringify(names);
        saveConfig(state.cfg);
        renderBlacklist();
      });
    });
  }

  function requestStop() {
    if (state.scanning) {
      state.stopRequested = true;
      state.queue?.stop();
      log("已请求停止...", "warn");

      setTimeout(() => {
        if (state.scanning) {
          state.scanning = false;
          state.stopRequested = false;
          if (state.queue) {
            state.queue.clear();
            state.queue = null;
          }
          hideProgress();
          document.getElementById("sbc-scan-btn").classList.remove("disabled");
          document.getElementById("sbc-skip-btn").classList.add("disabled");
          document.getElementById("sbc-stop-btn").classList.add("disabled");
          setScanPhase("done");
        }
      }, 5000);
    }
  }

  // ============================================================
  // Init
  // ============================================================
  const pageUrl = window.location.href;

  if (pageUrl.includes("/market/multibuy")) {
    window.addEventListener("load", () => {
      initMultibuyAutoFill();
    });
  } else {
    window.addEventListener("load", () => {
      injectEntryBtn();
    });
  }

})();
