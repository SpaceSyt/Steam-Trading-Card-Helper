// ==UserScript==
// @name         Steam Trading Card Helper
// @name:zh-CN   Steam 卡牌助手
// @namespace    https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @version      1.4.3
// @description  Scan Steam trading cards, estimate badge costs, and streamline purchases
// @description:zh-CN 扫描 Steam 卡牌价格、估算徽章成本并辅助批量购买
// @author       SpaceSyt
// @homepageURL  https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @supportURL   https://github.com/SpaceSyt/Steam-Trading-Card-Helper/issues
// @downloadURL  https://github.com/SpaceSyt/Steam-Trading-Card-Helper/raw/master/steam-trading-card-helper.user.js
// @updateURL    https://github.com/SpaceSyt/Steam-Trading-Card-Helper/raw/master/steam-trading-card-helper.user.js
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
    console.warn("[STCH] jQuery not found");
    return;
  }

  // ============================================================
  // Constants
  // ============================================================
  const DEFAULT_CONFIG = {
    configVersion: 4,
    threshold: 5,
    scanInterval: 0,
    requestInterval: 330,
    batchSize: 20,
    batchPause: 53000,
    includeDrops: false,
    maxBadgePages: 1,
    blacklist: "",
    blacklistNames: "{}",
    blacklistSources: "{}",
    blacklistDates: "{}",
    blacklistFixed: "{}",
    autoBlackThreshold: 10,
    autoBlackEnabled: false,
    buyMode: "complete5",
    orderPriceSource: "lowest",
    priceAdjustment: 0,
    earlyPricePrediction: true,
  };

  // ============================================================
  // Config
  // ============================================================
  function loadConfig() {
    const defaults = { ...DEFAULT_CONFIG };
    try {
      const raw = GM_getValue("stch_config", null);
      if (raw) {
        const saved = JSON.parse(raw);
        return { ...defaults, ...saved };
      }
    } catch (e) {
      console.warn("[STCH] Config load failed:", e);
    }
    return defaults;
  }

  function saveConfig(cfg) {
    GM_setValue("stch_config", JSON.stringify(cfg));
  }

  function getProfileUrl() {
    const url = unsafeWindow.g_strProfileURL
      || document.querySelector("#global_actions a.user_avatar")?.href
      || null;
    return url ? url.replace(/\/$/, "") : null;
  }

  function formatCNY(cents) {
    if (cents == null || isNaN(cents)) return "?";
    return (cents / 100).toFixed(2);
  }

  function createTextSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = String(text);
    return span;
  }

  // ============================================================
  // Request Queue
  // ============================================================
  class RequestQueue {
    constructor(
      interval = 330,
      batchSize = 20,
      batchPause = 53000,
      state = null,
      onStatus = null,
      onLog = null,
      otherInterval = 0
    ) {
      this.interval = interval;
      this.batchSize = batchSize;
      this.batchPause = batchPause;
      this.otherInterval = otherInterval;
      this.state = state;
      this.onStatus = onStatus;
      this.onLog = onLog;
      this.queue = [];
      this.running = false;
      this.stopped = false;
      this._consecutive429 = 0;
      this._429Warned = false;
      this._reqCount = 0;
    }

    async fetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.stopped) { reject({ status: 0, error: "stopped" }); return; }
        this.queue.push({ url, options, resolve, reject });
        this._run();
      });
    }

    async _sleep(ms) {
      const endAt = Date.now() + Math.max(0, ms);
      while (Date.now() < endAt) {
        if (
          this.stopped
          || this.state?.stopRequested
          || this.state?.skipCurrent
        ) {
          return false;
        }
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(250, endAt - Date.now()))
        );
      }
      return true;
    }

    async _run() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.queue.length > 0 && !this.stopped) {
          const job = this.queue.shift();
          const isPriceOverview = job.url.includes("/market/priceoverview/");
          const requestStartedAt = Date.now();
          try {
            const res = await window.fetch(job.url, {
              credentials: "include",
              ...job.options,
            });

            if (res.status === 429) {
              this._consecutive429++;
              this._reqCount = 0;
              const pauseMs = this.batchPause;
              if (this.onStatus) this.onStatus(`限流冷却中 (第${this._consecutive429}次, ${(pauseMs/1000).toFixed(0)}s)`, true);
              if (this._consecutive429 >= 5 && !this._429Warned && this.onLog) {
                this._429Warned = true;
                this.onLog("Steam 可能暂时限制了此 IP 访问价格 API，建议更换 IP 或等候几小时", "warn-ip");
              }
              await this._sleep(pauseMs);
              if (this.state?.skipCurrent) {
                job.reject({ status: 429, error: "skipped by user" });
                continue;
              }
              if (this.state?.stopRequested || this.stopped) {
                job.reject({ status: 0, error: "stopped" });
                continue;
              }
              this.queue.unshift(job);
              continue;
            }
            this._consecutive429 = 0;
            if (isPriceOverview && this.onStatus) {
              this.onStatus("扫描卡牌价格中", true);
            }

            if (res.status >= 500) {
              await this._sleep(this.interval * 3);
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

          // Only priceoverview calls count toward the proactive market API cooldown.
          if (isPriceOverview) {
            this._reqCount++;
            if (this._reqCount >= this.batchSize) {
              this._reqCount = 0;
              if (this.onStatus) this.onStatus(`主动冷却中 (${(this.batchPause/1000).toFixed(0)}s)`, true);
              await this._sleep(this.batchPause);
              continue;
            }
          }

          const targetInterval = isPriceOverview
            ? this.interval
            : this.otherInterval;
          const elapsed = Date.now() - requestStartedAt;
          await this._sleep(Math.max(0, targetInterval - elapsed));
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

      const lowestCents = parsePrice(res?.data?.lowest_price);
      const medianCents = parsePrice(res?.data?.median_price);
      const sellCents = lowestCents || medianCents;
      if (!sellCents) {
        return res?.data?.success ? { noPriceData: true, volume: 0 } : null;
      }

      const volume = parseInt(res?.data?.volume, 10) || 0;

      return {
        lowestSellCents: sellCents,
        medianCents,
        volume,
        estimated: !lowestCents,
        priceSource: lowestCents ? "lowest" : "median",
      };
    } catch (e) {
      return null;
    }
  }

  const EARLY_PREDICTION_MARGIN = 1.05;
  const EARLY_PREDICTION_STAGES = {
    2: { factor: 0.78, highWeight: 0.20 },
    3: { factor: 0.80, highWeight: 0.30 },
    4: { factor: 0.84, highWeight: 0.25 },
  };

  function predictFullSetLowerBound(cardPrices, totalCards, knownTotalCents) {
    const sampleCount = cardPrices.length;
    const stage = EARLY_PREDICTION_STAGES[sampleCount];
    if (!stage || totalCards <= sampleCount) return null;

    const prices = cardPrices.map(card => card.lowestCents);
    if (cardPrices.some(card => card.volume <= 0) || prices.some(price => !Number.isFinite(price) || price <= 0)) {
      return null;
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (maxPrice / minPrice >= 2) return null;

    const representativePrice = minPrice + stage.highWeight * (maxPrice - minPrice);
    const remainingAverage = representativePrice * stage.factor;
    return {
      sampleCount,
      minPrice,
      maxPrice,
      predictedCents: Math.ceil(
        knownTotalCents + (totalCards - sampleCount) * remainingAverage
      ),
    };
  }

  function geometricMeanCents(values) {
    const usable = values.filter(value => Number.isFinite(value) && value > 0);
    if (usable.length === 0) return null;
    const meanLog = usable.reduce((sum, value) => sum + Math.log(value), 0) / usable.length;
    return Math.round(Math.exp(meanLog));
  }

  function estimateMissingLevel5Cost(noPriceCards, cardPrices, setsTo5) {
    const knownUnitPrices = cardPrices.map(price =>
      Math.max(price.lowestCents, price.medianCents || 0)
    );
    const estimatedUnitCents = geometricMeanCents(knownUnitPrices);
    if (estimatedUnitCents == null) return null;

    const estimatedCostCents = noPriceCards.reduce((sum, card) => {
      const need5 = Math.max(0, setsTo5 - card.owned);
      return sum + estimatedUnitCents * need5;
    }, 0);
    return { estimatedUnitCents, estimatedCostCents };
  }

  // ============================================================
  // CSS
  // ============================================================
  GM_addStyle(`
    .stch-btn-entry {
      display: inline-block;
      padding: 6px 12px;
      margin-left: 10px;
      background: rgba(67, 137, 179, 0.85);
      color: #fff;
      border-radius: 3px;
      cursor: pointer;
      font-size: 13px;
    }
    .stch-btn-entry:hover { background: rgba(87, 157, 199, 1); }

    #stch-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.6);
      z-index: 10000;
      display: none;
    }
    #stch-modal {
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
    #stch-modal .stch-header {
      padding: 10px 16px;
      border-bottom: 1px solid #45556b;
      display: flex;
      align-items: center;
      background: #171a21;
    }
    #stch-modal .stch-header h2 {
      margin: 0; font-size: 20px; flex: 1; color: #fff;
    }
    #stch-modal .stch-close {
      cursor: pointer; font-size: 22px; color: #8f98a0;
    }
    #stch-modal .stch-close:hover { color: #fff; }
    #stch-modal .stch-body {
      flex: 1; overflow-y: hidden; padding: 12px 16px;
      display: flex; flex-direction: column;
      min-height: 0;
    }
    #stch-modal .stch-footer {
      padding: 10px 16px;
      background: #171a21;
      border-top: 1px solid #45556b;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
    }
    .stch-input {
      background: #0e1621;
      color: #fff;
      border: 1px solid #45556b;
      padding: 5px 8px;
      border-radius: 2px;
      width: 80px;
      font-size: 14px;
    }
    .stch-input:focus { border-color: #66c0f4; outline: none; }
    .stch-label { font-size: 14px; color: #8f98a0; }
    .stch-btn {
      padding: 8px 16px;
      background: linear-gradient(to bottom, #75b022 5%, #588a1b 95%);
      color: #fff;
      border-radius: 2px;
      cursor: pointer;
      font-size: 15px;
      user-select: none;
    }
    .stch-btn:hover { background: linear-gradient(to bottom, #8ed629 5%, #6aa621 95%); }
    .stch-btn.disabled {
      background: #2a3f5a;
      color: #667;
      cursor: not-allowed;
      opacity: 0.6;
    }
    .stch-btn.alt {
      background: linear-gradient(to bottom, #67c1f5 5%, #417a9b 95%);
    }
    .stch-btn.alt:hover {
      background: linear-gradient(to bottom, #8ed8ff 5%, #5297b7 95%);
    }
    .stch-btn.stch-btn-danger {
      background: linear-gradient(to bottom, #c04040 5%, #8b2020 95%);
    }
    .stch-btn.stch-btn-danger:hover {
      background: linear-gradient(to bottom, #e05050 5%, #a03030 95%);
    }

    .stch-game-list {
      max-height: 30vh;
      overflow-y: auto;
      border: 1px solid #2a3f5a;
      border-radius: 3px;
      background: rgba(0,0,0,0.2);
    }
    .stch-game-row {
      padding: 6px 14px;
      border-bottom: 1px solid rgba(69,85,107,0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
      line-height: 1.4;
    }
    .stch-row-header {
      color: #8f98a0;
      font-size: 12px;
      font-weight: bold;
      border-bottom: 2px solid #45556b;
      padding-bottom: 6px;
      margin-bottom: 2px;
    }
    .stch-game-row:hover { background: rgba(103,193,245,0.08); }
    .stch-game-row .stch-appid {
      width: 56px;
      flex-shrink: 0;
      color: #66c0f4;
      font-family: monospace;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-name {
      flex: 1;
      color: #e2e2e2;
      font-size: 13px;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stch-game-row .stch-level {
      width: 42px;
      flex-shrink: 0;
      color: #a1b053;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-cards {
      width: 36px;
      flex-shrink: 0;
      color: #c6d4df;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-cost {
      width: 68px;
      flex-shrink: 0;
      color: #75b022;
      font-weight: bold;
      font-size: 13px;
      text-align: center;
    }
    .stch-game-row .stch-full {
      width: 68px;
      flex-shrink: 0;
      color: #ffc902;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-lv5 {
      width: 84px;
      flex-shrink: 0;
      color: #e74c3c;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-drops {
      width: 36px;
      flex-shrink: 0;
      color: #8db7d7;
      font-size: 12px;
      text-align: center;
    }
    .stch-game-row .stch-buy {
      width: 60px;
      flex-shrink: 0;
      text-align: center;
    }
    .stch-game-row .stch-check {
      width: 24px;
      flex-shrink: 0;
      text-align: center;
    }
    .stch-game-list:not(.stch-show-drops) .stch-drops { display: none; }
    .stch-result-cb {
      margin: 0;
      cursor: pointer;
      accent-color: #75b022;
    }
    .stch-scan-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .stch-bulk-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-left: auto;
    }
    .stch-selected-count {
      color: #8f98a0;
      margin-left: auto;
      width: 24px;
      margin-right: 14px;
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      white-space: nowrap;
    }
    .stch-help {
      cursor: help;
      color: #8f98a0;
      font-size: 12px;
    }
    .stch-sortable {
      cursor: pointer;
      user-select: none;
    }
    .stch-sortable:hover { color: #fff; }
    .stch-sort-arrow { font-size: 10px; }
    .stch-toolbar {
      display: flex;
      gap: 14px;
      align-items: center;
      margin-bottom: 8px;
      flex-wrap: wrap;
      font-size: 14px;
      color: #8f98a0;
    }
    .stch-toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .stch-primary-label { color: #fff !important; font-weight: bold; }

    .stch-status-text { color: #8db7d7; font-size: 13px; padding: 6px 0; min-height: 20px; }

    .stch-tabs {
      display: flex;
      gap: 2px;
      margin-bottom: 10px;
      border-bottom: 1px solid #45556b;
    }
    .stch-tab {
      padding: 6px 16px;
      background: rgba(0,0,0,0.3);
      color: #8f98a0;
      cursor: pointer;
      border-radius: 3px 3px 0 0;
      font-size: 14px;
      user-select: none;
    }
    .stch-tab:hover { color: #fff; background: rgba(103,193,245,0.1); }
    .stch-tab.active { color: #fff; background: #1b2838; border: 1px solid #45556b; border-bottom-color: #1b2838; }
    .stch-tab-disabled { color: #555; cursor: not-allowed; opacity: 0.5; pointer-events: none; }
    .stch-tab-right { margin-left: auto; }
    .stch-tab-content { display: none; position: relative; }
    .stch-tab-content.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }

    .stch-onboarding {
      position: absolute;
      inset: 0;
      z-index: 10;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      background: #1b2838;
      padding: 24px 28px;
    }
    .stch-onboarding h3 {
      margin: 0 0 8px;
      color: #fff;
      font-size: 22px;
    }
    .stch-onboarding-intro {
      margin: 0 0 20px;
      color: #8db7d7;
      line-height: 1.7;
    }
    .stch-onboarding-step {
      padding: 12px 0;
      border-top: 1px solid #2a3f5a;
      line-height: 1.65;
    }
    .stch-onboarding-step b {
      display: block;
      margin-bottom: 2px;
      color: #fff;
      font-size: 15px;
    }
    .stch-onboarding-note {
      margin-top: 8px;
      padding: 10px 12px;
      border-left: 3px solid #ffc902;
      background: rgba(0,0,0,0.2);
      color: #c6d4df;
      line-height: 1.6;
    }
    .stch-onboarding-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: auto;
      padding-top: 20px;
    }

    .stch-bl-form {
      display: flex;
      gap: 10px;
      align-items: center;
      margin-bottom: 10px;
      flex-wrap: wrap;
    }
    .stch-bl-list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      border: 1px solid #2a3f5a;
      border-radius: 3px;
      background: rgba(0,0,0,0.2);
    }
    .stch-bl-row {
      padding: 6px 14px;
      border-bottom: 1px solid rgba(69,85,107,0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 14px;
    }
    .stch-bl-row:hover { background: rgba(103,193,245,0.08); }
    .stch-bl-row .stch-bl-id { width: 70px; color: #66c0f4; font-family: monospace; }
    .stch-bl-row .stch-bl-name { flex: 1; color: #e2e2e2; }
    .stch-bl-row .stch-bl-source { width: 50px; color: #8f98a0; font-size: 12px; text-align: center; }
    .stch-bl-row .stch-bl-fixed-col { width: 40px; color: #75b022; font-size: 12px; text-align: center; }
    .stch-bl-row .stch-bl-days { width: 45px; color: #8f98a0; font-size: 12px; text-align: center; }
    .stch-bl-row .stch-bl-cb-hd { width: 24px; flex-shrink: 0; text-align: center; }
    .stch-bl-cb { cursor: pointer; accent-color: #75b022; }
    .stch-bl-count { color: #8f98a0; font-size: 12px; margin-top: 6px; }
    .stch-bl-sep { color: #45556b; font-size: 12px; margin: 4px 0; padding-left: 8px; }
    .stch-bl-fixed { color: #75b022; }

    .stch-bl-result { color: #75b022; font-size: 14px; }

    #stch-log {
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
    #stch-log .ok { color: #75b022; }
    #stch-log .warn { color: #ffc902; }
    #stch-log .warn-ip { color: #fff; }
    #stch-log .err { color: #c04040; }
    #stch-log .info { color: #67c1f5; }

    .stch-progress {
      height: 20px;
      background: #0e1621;
      border-radius: 2px;
      overflow: hidden;
      margin: 8px 0;
      position: relative;
    }
    .stch-progress-bar {
      height: 100%;
      background: linear-gradient(to right, #75b022, #8ed629);
      transition: width 0.2s;
    }
    .stch-progress-text {
      position: absolute;
      inset: 0;
      text-align: center;
      font-size: 13px;
      line-height: 20px;
      color: #fff;
    }

    .stch-summary {
      font-size: 14px;
      color: #8f98a0;
      margin: 8px 0;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .stch-summary-text { min-width: 0; }
    .stch-summary b { color: #fff; }

    #stch-order-dialog-backdrop {
      position: fixed;
      inset: 0;
      z-index: 10020;
      background: rgba(0,0,0,0.65);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stch-order-dialog {
      width: 620px;
      max-width: 92vw;
      max-height: 82vh;
      display: flex;
      flex-direction: column;
      background: #1b2838;
      border: 1px solid #45556b;
      border-radius: 4px;
      box-shadow: 0 12px 40px rgba(0,0,0,0.7);
      color: #c6d4df;
    }
    .stch-order-dialog h3 {
      margin: 0;
      padding: 14px 16px;
      color: #fff;
      font-size: 18px;
      border-bottom: 1px solid #45556b;
    }
    .stch-order-summary {
      padding: 12px 16px;
      line-height: 1.7;
    }
    .stch-order-summary b { color: #fff; }
    .stch-order-list {
      margin: 0 16px;
      max-height: 42vh;
      overflow-y: auto;
      border: 1px solid #2a3f5a;
      background: #0e1621;
    }
    .stch-order-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 55px 70px;
      gap: 10px;
      padding: 7px 10px;
      border-bottom: 1px solid rgba(69,85,107,0.4);
      font-size: 12px;
    }
    .stch-order-item span:first-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .stch-order-note {
      padding: 10px 16px;
      color: #ffc902;
      font-size: 12px;
    }
    .stch-order-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      padding: 12px 16px;
      border-top: 1px solid #45556b;
    }
  `);

  // ============================================================
  // UI
  // ============================================================
  const ONBOARDING_SEEN_KEY = "stch_onboarding_seen";

  function injectEntryBtn() {
    const target = document.querySelector(".profile_xp_block")
      || document.querySelector(".badges_header")
      || document.body;

    const btn = document.createElement("span");
    btn.className = "stch-btn-entry";
    btn.textContent = "Steam Trading Card Helper";
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
    sortKey: null,
    sortAsc: true,
    selectedResults: new Set(),
    bulkActionRunning: false,
    pendingOrderQuantities: new Map(),
    highestBuyPrices: new Map(),
  };

  function openModal() {
    if (modalEl) { modalEl.style.display = ""; return; }
    buildModal();
  }

  function buildModal() {
    const backdrop = document.createElement("div");
    backdrop.id = "stch-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.id = "stch-modal";
    modal.addEventListener("click", e => e.stopPropagation());
    modal.innerHTML = `
      <div class="stch-header">
        <h2>Steam 卡牌助手</h2>
        <span class="stch-close" title="关闭">✕</span>
      </div>
      <div class="stch-body">
        <div class="stch-tabs">
          <span class="stch-tab active" data-tab="scan">价格扫描</span>
          <span class="stch-tab stch-tab-disabled" title="未实现">闪卡价格扫描</span>
          <span class="stch-tab" data-tab="blacklist">黑名单</span>
          <span class="stch-tab stch-tab-disabled" title="未实现">多余卡牌检测</span>
          <span class="stch-tab stch-tab-right" data-tab="settings">设置</span>
        </div>
        <div class="stch-tab-content active" id="stch-tab-scan">
          <div class="stch-onboarding" id="stch-onboarding" style="display:none">
            <h3>欢迎使用 Steam 卡牌助手</h3>
            <p class="stch-onboarding-intro">扫描未完成的徽章，比较卡牌成本，并更快地完成购买。</p>
            <div class="stch-onboarding-step">
              <b>1. 设置并扫描</b>
              设置单套价格上限和购买逻辑后开始扫描。价格预测会在明显超出上限时提前跳过，减少请求和等待。
            </div>
            <div class="stch-onboarding-step">
              <b>2. 选择购买方式</b>
              “手动购买”会打开 Steam multibuy 并自动填写数量和价格；勾选结果后也可以批量提交长期订购单。
            </div>
            <div class="stch-onboarding-step">
              <b>3. 理解购买价格</b>
              在售最低通常更快成交，平均价格用于参考，求购最高通常需要等待卖家成交。买价调整可正可负。
            </div>
            <div class="stch-onboarding-note">
              市场价格和满级成本均可能变化。提交前请检查数量、单价和总金额；长期订购单会保留到成交或手动取消。
            </div>
            <div class="stch-onboarding-actions">
              <div class="stch-btn" id="stch-onboarding-close">关闭</div>
            </div>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">单套卡牌价格上限 ¥ <input id="stch-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.threshold}"></label>
            <label class="stch-primary-label">购买卡牌逻辑 <select id="stch-buy-mode" class="stch-input" style="width:110px">
              <option value="complete1" ${state.cfg.buyMode === "complete1" ? "selected" : ""}>补全单套</option>
              <option value="complete5" ${state.cfg.buyMode === "complete5" ? "selected" : ""}>补至五级</option>
              <option value="buy1" ${state.cfg.buyMode === "buy1" ? "selected" : ""}>购买单套</option>
              <option value="buy5" ${state.cfg.buyMode === "buy5" ? "selected" : ""}>购买五套</option>
            </select></label>
            <label>最大徽章页数 <input id="stch-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <label>
              <input id="stch-include-drops" type="checkbox" ${state.cfg.includeDrops ? "checked" : ""}>
              包含有掉落卡牌的游戏
            </label>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">购买价格
              <span class="stch-help" title="在售最低：当前最低卖单价格，通常可立即成交&#10;平均价格：Steam 返回的 median_price，用作市场参考价&#10;求购最高：当前最高买单价格，通常需要等待卖家成交&#10;仅用于自动提交长期订购单；手动购买仍使用在售最低">?</span>
              <select id="stch-order-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.orderPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.orderPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.orderPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">买价调整 ¥ <input id="stch-price-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.priceAdjustment}" style="width:68px"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-scan-btn">开始扫描</div>
            <div class="stch-btn alt disabled" id="stch-stop-btn">停止</div>
            <div class="stch-btn alt disabled" id="stch-skip-btn" title="跳过当前徽章">跳过当前</div>
            <div class="stch-bulk-actions">
              <div class="stch-btn alt disabled" id="stch-recalculate-btn">重新计算</div>
              <div class="stch-btn disabled" id="stch-submit-orders-btn">提交订购单</div>
            </div>
          </div>
          <div class="stch-progress" id="stch-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-progress-text">0/0</div>
          </div>
          <div class="stch-summary" id="stch-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-summary"></span>
            <span class="stch-selected-count" id="stch-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-status"></div>
          <div class="stch-game-list" id="stch-list"></div>
          <div id="stch-log"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-blacklist">
          <div class="stch-bl-form">
            <label>输入游戏 AppID <input id="stch-bl-appid" class="stch-input" type="text" style="width:100px" placeholder="例如: 1144400"></label>
            <div class="stch-btn alt" id="stch-bl-lookup">查询游戏</div>
            <div class="stch-btn" id="stch-bl-add" style="display:none;">加入黑名单</div>
            <div class="stch-btn" id="stch-bl-add-fixed" style="display:none;">加入固定黑名单</div>
            <div class="stch-btn alt stch-btn-danger disabled" id="stch-bl-del-sel" style="display:none;">删除选中项</div>
            <div class="stch-btn alt disabled" id="stch-bl-fix-sel" style="display:none;">加入固定黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-unfix-sel" style="display:none;">移除固定黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-cleanup">一键清理过期</div>
            <span class="stch-bl-result" id="stch-bl-result"></span>
          </div>
          <div class="stch-bl-form">
            <label>
              <input id="stch-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动黑名单
            </label>
            <label class="stch-primary-label">价格上限 ¥ <input id="stch-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <span style="color:#8f98a0;font-size:12px;">扫描时超过此价格的游戏自动加入黑名单</span>
          </div>
          <div class="stch-bl-list" id="stch-bl-list"></div>
          <div class="stch-bl-list" id="stch-bl-list-fixed" style="max-height:100px;margin-top:8px;"></div>
          <div class="stch-bl-count" id="stch-bl-count"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-settings">
          <div style="color:#fff;font-weight:bold;font-size:16px;margin-bottom:4px;">价格扫描</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>priceoverview请求间隔 <input id="stch-req-interval" class="stch-input" type="number" min="100" step="10" value="${state.cfg.requestInterval}" style="width:70px"> ms</label>
            <label>gamecard请求间隔 <input id="stch-scan-interval" class="stch-input" type="number" min="0" step="100" value="${state.cfg.scanInterval}"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label>每 <input id="stch-batch-size" class="stch-input" type="number" min="5" step="1" value="${state.cfg.batchSize}" style="width:55px"> 次priceoverview请求后暂停</label>
            <label><input id="stch-batch-pause" class="stch-input" type="number" min="500" step="500" value="${state.cfg.batchPause}" style="width:75px"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label><input id="stch-early-price-prediction" type="checkbox" ${state.cfg.earlyPricePrediction ? "checked" : ""}> 价格预测提早跳过</label>
            <span style="color:#8f98a0;font-size:12px;">扫描部分卡牌后保守预测全套价格，超过上限时提前跳过</span>
          </div>
          <div style="color:#8f98a0;font-size:12px;margin-top:4px;">默认值为作者测试稳定配置 (330ms / 53s)。如遇 429 可调高 100ms / 5s。gamecard 通常不需要调整，保持 0 即可。</div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">使用说明</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <div class="stch-btn alt" id="stch-onboarding-open">重新查看使用说明</div>
          </div>
        </div>
      </div>
      <div class="stch-footer">
        <span class="stch-label">V1.4.3 · 默认货币：人民币(CNY)</span>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;

    modal.querySelector(".stch-close").addEventListener("click", closeModal);

    const cfgIds = ["stch-threshold", "stch-scan-interval",
      "stch-req-interval", "stch-max-pages", "stch-include-drops",
      "stch-batch-size", "stch-batch-pause", "stch-buy-mode",
      "stch-order-price-source", "stch-price-adjustment",
      "stch-early-price-prediction"];
    cfgIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("change", () => {
        state.cfg.threshold = parseFloat(document.getElementById("stch-threshold").value) || 0;
        state.cfg.scanInterval = parseInt(document.getElementById("stch-scan-interval").value, 10) || 0;
        state.cfg.requestInterval = parseInt(document.getElementById("stch-req-interval").value, 10) || DEFAULT_CONFIG.requestInterval;
        state.cfg.maxBadgePages = parseInt(document.getElementById("stch-max-pages").value, 10) || DEFAULT_CONFIG.maxBadgePages;
        state.cfg.includeDrops = document.getElementById("stch-include-drops").checked;
        state.cfg.batchSize = parseInt(document.getElementById("stch-batch-size").value, 10) || DEFAULT_CONFIG.batchSize;
        state.cfg.batchPause = parseInt(document.getElementById("stch-batch-pause").value, 10) || DEFAULT_CONFIG.batchPause;
        state.cfg.buyMode = document.getElementById("stch-buy-mode").value;
        state.cfg.orderPriceSource = document.getElementById("stch-order-price-source").value;
        const adjustment = parseFloat(document.getElementById("stch-price-adjustment").value);
        state.cfg.priceAdjustment = Number.isFinite(adjustment) ? adjustment : 0;
        state.cfg.earlyPricePrediction = document.getElementById("stch-early-price-prediction").checked;
        saveConfig(state.cfg);
        updateResultColumns();
      });
    });
    document.getElementById("stch-price-adjustment").addEventListener("input", event => {
      const adjustment = parseFloat(event.target.value);
      state.cfg.priceAdjustment = Number.isFinite(adjustment) ? adjustment : 0;
      saveConfig(state.cfg);
    });

    const activateTab = tabName => {
      modal.querySelectorAll(".stch-tab").forEach(tab => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
      modal.querySelectorAll(".stch-tab-content").forEach(content => {
        content.classList.toggle("active", content.id === `stch-tab-${tabName}`);
      });
      if (tabName === "blacklist") renderBlacklist();
    };
    const showOnboarding = () => {
      GM_setValue(ONBOARDING_SEEN_KEY, true);
      activateTab("scan");
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "flex";
    };
    const closeOnboarding = () => {
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "none";
    };

    // Tab switching
    modal.querySelectorAll(".stch-tab[data-tab]").forEach(tab => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.tab);
      });
    });

    document.getElementById("stch-onboarding-close").addEventListener("click", closeOnboarding);
    document.getElementById("stch-onboarding-open").addEventListener("click", showOnboarding);
    document.getElementById("stch-scan-btn").addEventListener("click", startScan);
    document.getElementById("stch-stop-btn").addEventListener("click", requestStop);
    document.getElementById("stch-skip-btn").addEventListener("click", skipCurrentBadge);
    document.getElementById("stch-recalculate-btn").addEventListener("click", recalculateSelectedResults);
    document.getElementById("stch-submit-orders-btn").addEventListener("click", submitSelectedBuyOrders);

    // Auto blacklist threshold
    document.getElementById("stch-auto-bl-threshold").addEventListener("change", () => {
      state.cfg.autoBlackThreshold = parseFloat(document.getElementById("stch-auto-bl-threshold").value) || 0;
      saveConfig(state.cfg);
    });
    document.getElementById("stch-auto-bl-enabled").addEventListener("change", () => {
      state.cfg.autoBlackEnabled = document.getElementById("stch-auto-bl-enabled").checked;
      saveConfig(state.cfg);
    });

    if (!GM_getValue(ONBOARDING_SEEN_KEY, false)) {
      showOnboarding();
    }

    // Blacklist tab
    // Source: 0 = 手动 (manual query+add), 1 = 自动 (auto threshold during scan)
    // Fixed:  0 = 普通黑名单,           1 = 固定黑名单 (permanent, ignored by cleanup)
    // Days:   computed from stored Date.now() timestamp, 0 = today

    document.getElementById("stch-bl-lookup").addEventListener("click", () => {
      const appid = document.getElementById("stch-bl-appid").value.trim();
      if (!appid || !/^\d+$/.test(appid)) {
        document.getElementById("stch-bl-result").textContent = "请输入有效的 AppID";
        return;
      }
      document.getElementById("stch-bl-result").textContent = "查询中...";
      lookupGameName(appid).then(name => {
        blLookupAppid = appid;
        blLookupName = name;
        document.getElementById("stch-bl-result").textContent = name ? `${appid} — ${name}` : "未找到该游戏";
        updateBlRow();
      });
    });

    document.getElementById("stch-bl-add").addEventListener("click", () => {
      if (!blLookupAppid || !blLookupName) return;
      addToBlacklist(blLookupAppid, blLookupName, 0, 0);
      document.getElementById("stch-bl-result").textContent = `${blLookupName} 已加入黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      blLookupAppid = "";
      blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-add-fixed").addEventListener("click", () => {
      if (!blLookupAppid || !blLookupName) return;
      addToBlacklist(blLookupAppid, blLookupName, 0, 1);
      document.getElementById("stch-bl-result").textContent = `${blLookupName} 已加入固定黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      blLookupAppid = "";
      blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-del-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try { n = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) { n = {}; }
      try { s = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) { s = {}; }
      try { d = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) { d = {}; }
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => {
        const appid = cb.dataset.appid;
        const idx = bl.indexOf(appid);
        if (idx >= 0) bl.splice(idx, 1);
        delete n[appid]; delete s[appid]; delete d[appid]; delete f[appid];
      });
      state.cfg.blacklist = bl.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-fix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      let f = {};
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => { f[cb.dataset.appid] = 1; });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-unfix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      let f = {};
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      allCbs.forEach(cb => { f[cb.dataset.appid] = 0; });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });

    document.getElementById("stch-bl-cleanup").addEventListener("click", () => {
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try { n = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) { n = {}; }
      try { s = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) { s = {}; }
      try { d = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) { d = {}; }
      try { f = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) { f = {}; }
      const now = Date.now();
      const expired = bl.filter(a => !f[a] && d[a] && (now - d[a] > 7 * 86400000));
      if (expired.length === 0) {
        document.getElementById("stch-bl-result").textContent = "没有可清理的过期项";
        return;
      }
      if (!confirm(`将清理 ${expired.length} 项过期（>7天）黑名单，确定？`)) return;
      const keep = bl.filter(a => !expired.includes(a));
      expired.forEach(a => { delete n[a]; delete s[a]; delete d[a]; delete f[a]; });
      state.cfg.blacklist = keep.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      document.getElementById("stch-bl-result").textContent = `已清理 ${expired.length} 项`;
      renderBlacklist();
    });

    renderBlacklist();
  }

  function skipCurrentBadge() {
    state.skipCurrent = true;
    log("跳过当前徽章...", "warn");
  }

  function closeModal() {
    if (state.bulkActionRunning) return;
    if (state.scanning) {
      state.stopRequested = true;
      state.queue?.stop();
    }
    if (_stopTimeout) {
      clearTimeout(_stopTimeout);
      _stopTimeout = null;
    }
    setStatus(null);
    document.getElementById("stch-backdrop")?.remove();
    modalEl?.remove();
    modalEl = null;
  }

  // ============================================================
  // Logging / Progress
  // ============================================================
  function log(msg, type = "") {
    const box = document.getElementById("stch-log");
    if (!box) { console.log("[STCH]", msg); return; }
    const line = document.createElement("div");
    if (type) line.className = type;
    line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function setProgress(done, total, text = "") {
    const wrap = document.getElementById("stch-progress-wrap");
    const bar = document.getElementById("stch-progress-bar");
    const ptxt = document.getElementById("stch-progress-text");
    if (!wrap) return;
    wrap.style.display = "";
    const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;
    bar.style.width = pct + "%";
    ptxt.textContent = text || `${done}/${total}`;
  }

  function hideProgress() {
    const wrap = document.getElementById("stch-progress-wrap");
    if (wrap) wrap.style.display = "none";
  }

  function setSummary(html) {
    const el = document.getElementById("stch-summary");
    if (el) el.innerHTML = html;
  }

  function setSummaryVisibility(visible) {
    const row = document.getElementById("stch-summary-row");
    if (row) row.style.display = visible ? "" : "none";
  }

  // ============================================================
  // Animated status
  // ============================================================
  let statusTimer = null;
  function setStatus(text, animate = true) {
    const el = document.getElementById("stch-status");
    if (!el) return;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (!text) { el.textContent = ""; el.style.display = "none"; return; }
    el.style.display = "";
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

  function getResultKey(info) {
    return `${info.appid}_${info.isFoil ? 1 : 0}`;
  }

  function getSelectedResults() {
    return state.results.filter(info => state.selectedResults.has(getResultKey(info)));
  }

  function updateBulkActionState() {
    const selectedCount = getSelectedResults().length;
    const countEl = document.getElementById("stch-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;

    const disabled = selectedCount === 0 || state.scanning || state.bulkActionRunning;
    document.getElementById("stch-recalculate-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-submit-orders-btn")?.classList.toggle("disabled", disabled);

    const selectAll = document.getElementById("stch-result-select-all");
    if (selectAll) {
      selectAll.checked = state.results.length > 0 && selectedCount === state.results.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.results.length;
    }
  }

  function updateResultColumns() {
    const showDrops = state.cfg.includeDrops
      && state.results.some(info => Number(info.dropsRemaining) > 0);
    document.getElementById("stch-list")?.classList.toggle("stch-show-drops", showDrops);
  }

  async function refreshResultInfo(existing, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("未找到 Profile URL");

    const suffix = existing.isFoil ? "?border=1" : "";
    const res = await queue.fetch(`${profileUrl}/gamecards/${existing.appid}/${suffix}`);
    if (!res?.text?.includes("badge_card_set_card")) {
      throw new Error("未找到卡牌套组");
    }

    const info = parseGameCardsHtml(res.text, existing.appid, existing.isFoil);
    info.appid = existing.appid;
    info.isFoil = existing.isFoil;
    info.gameName = existing.gameName || info.gameName || "";
    info.cardPrices = [];
    info.cheapestSetCostCents = 0;
    info.fullSetCostCents = 0;
    info.level5CostCents = 0;

    let setCostCents = 0;
    let fullSetCostCents = 0;
    let level5CostCents = 0;
    let minVolume = Infinity;
    const setsTo5 = Math.max(0, 5 - info.level);
    const noPriceCards = [];
    let failedPriceCount = 0;

    for (const card of info.cards) {
      if (!card.marketHashName) {
        throw new Error(`卡牌“${card.name}”缺少 market hash name`);
      }
      const pk = await priceCard(card.marketHashName, queue);
      if (!pk) {
        failedPriceCount++;
        info.hasEstimated = true;
        continue;
      }
      if (pk.noPriceData) {
        card.priceSource = "none";
        noPriceCards.push(card);
        info.hasEstimated = true;
        continue;
      }

      card.lowestCents = pk.lowestSellCents;
      card.medianCents = pk.medianCents;
      card.volume = pk.volume;
      card.priceSource = pk.priceSource;
      minVolume = Math.min(minVolume, pk.volume);
      if (pk.estimated) {
        info.hasEstimated = true;
        info.hasMedianFallback = true;
      }
      info.cardPrices.push({
        name: card.name,
        lowestCents: pk.lowestSellCents,
        medianCents: pk.medianCents,
        volume: pk.volume,
        marketHashName: card.marketHashName,
        priceSource: pk.priceSource,
      });

      const need1 = Math.max(0, 1 - card.owned);
      const need5 = Math.max(0, setsTo5 - card.owned);
      setCostCents += pk.lowestSellCents * need1;
      fullSetCostCents += pk.lowestSellCents;
      level5CostCents += need5 > 0
        ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents)
        : 0;
    }

    if (info.cardPrices.length === 0) {
      throw new Error("Steam 未返回任何可用价格");
    }

    if (noPriceCards.length / info.totalInSet >= 0.5) {
      const formulaEstimate = estimateMissingLevel5Cost(noPriceCards, info.cardPrices, setsTo5);
      if (formulaEstimate) {
        level5CostCents += formulaEstimate.estimatedCostCents;
        info.hasEstimated = true;
        info.hasFormulaEstimate = true;
        info.formulaEstimatedCards = noPriceCards.length;
        info.formulaEstimateUnitCents = formulaEstimate.estimatedUnitCents;
      }
    }

    info.noPriceDataCount = noPriceCards.length;
    info.failedPriceCount = failedPriceCount;
    info.cheapestSetCostCents = setCostCents;
    info.fullSetCostCents = fullSetCostCents;
    info.level5CostCents = level5CostCents;
    info.minVolume = minVolume === Infinity ? 0 : minVolume;
    info.cheapestSetCNY = formatCNY(setCostCents);
    info.fullSetCNY = formatCNY(fullSetCostCents);
    info.level5CNY = formatCNY(level5CostCents);
    return info;
  }

  async function recalculateSelectedResults() {
    const selected = getSelectedResults();
    if (selected.length === 0 || state.scanning || state.bulkActionRunning) return;

    state.bulkActionRunning = true;
    updateBulkActionState();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setStatus,
      log,
      cfg.scanInterval
    );

    let refreshed = 0;
    let failed = 0;
    try {
      for (let index = 0; index < selected.length; index++) {
        const existing = selected[index];
        setStatus(`重新计算 ${index + 1}/${selected.length}: ${existing.gameName}`);
        try {
          const next = await refreshResultInfo(existing, queue);
          const resultIndex = state.results.findIndex(
            info => getResultKey(info) === getResultKey(existing)
          );
          if (next.level >= 5) {
            if (resultIndex >= 0) state.results.splice(resultIndex, 1);
            state.selectedResults.delete(getResultKey(existing));
            log(`[${existing.appid}] ${existing.gameName}: 已满级，从结果中移除`, "info");
          } else if (resultIndex >= 0) {
            state.results[resultIndex] = next;
            refreshed++;
            log(
              `[${existing.appid}] ${existing.gameName}: 重算完成，` +
              `补全 ¥${next.cheapestSetCNY} | 满级 ¥${next.level5CNY}`,
              "ok"
            );
          }
        } catch (error) {
          failed++;
          log(
            `[${existing.appid}] ${existing.gameName}: 重算失败 ${error?.message || error}`,
            "err"
          );
        }
      }
    } finally {
      queue.stop();
      state.bulkActionRunning = false;
      setStatus(null);
      renderResults();
      updateSummary();
      updateBulkActionState();
      log(`选中项重算结束: 成功 ${refreshed}, 失败 ${failed}`, failed ? "warn" : "ok");
    }
  }

  async function startScan() {
    if (state.scanning) return;
    if (_stopTimeout) { clearTimeout(_stopTimeout); _stopTimeout = null; }
    state.scanning = true;
    state.stopRequested = false;
    state.skipCurrent = false;
    state.results = [];
    state.selectedResults.clear();
    setSummary("");
    setSummaryVisibility(false);
    document.getElementById("stch-list").innerHTML = "";
    document.getElementById("stch-log").innerHTML = "";
    document.getElementById("stch-scan-btn").classList.add("disabled");
    document.getElementById("stch-skip-btn").classList.remove("disabled");
    document.getElementById("stch-stop-btn").classList.remove("disabled");
    updateBulkActionState();
    setScanPhase("scanning");
    setStatus("正在扫描徽章页");

    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setStatus,
      log,
      cfg.scanInterval
    );


    state.queue = queue;
    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      log("未找到 Profile URL", "err");
      state.scanning = false;
      state.queue = null;
      hideProgress();
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      return;
    }

    try {
      log("【阶段 1/3】正在扫描徽章页 (找有未完成进度的游戏)...");
      setProgress(0, 1, "阶段1: 扫描徽章页列表中...");
      setScanPhase("phase1");
      const badges = await scanBadgePages(cfg, msg => log(msg, "info"), queue);

      if (badges.length === 0) {
        log("未找到任何有未完成进度的徽章", "warn");
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
        if (state.stopRequested) { log("已手动停止", "warn"); break; }
        if (state.skipCurrent) {
          state.skipCurrent = false;
          log(`[${b.appid}] 跳过 (手动)`, "warn");
          skipped++;
          continue;
        }
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
          const suffix = b.isFoil ? "?border=1" : "";
          const url = `${profileUrl}/gamecards/${b.appid}/${suffix}`;
          let res;
          try {
            res = await queue.fetch(url);
          } catch (fetchErr) {
            if (state.stopRequested) { log("已手动停止", "warn"); break; }
            if (state.skipCurrent) {
              state.skipCurrent = false;
              log("已跳过当前徽章", "warn");
              skipped++;
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
          let setCostCents = 0;
          let fullSetCostCents = 0;
          let level5CostCents = 0;
          let minVolume = Infinity;
          const setsTo5 = Math.max(0, 5 - info.level);
          let allPriced = true;
          let thresholdSkip = false;
          let cancelledCurrent = false;
          const noPriceCards = [];
          let failedPriceCount = 0;

          for (const card of info.cards) {
            if (state.stopRequested || state.skipCurrent) {
              cancelledCurrent = true;
              break;
            }
            if (!card.marketHashName) {
              log(`  ⚠ 卡牌 "${card.name}" 无 market hash name, 跳过此游戏`, "warn");
              allPriced = false;
              break;
            }

            const pk = await priceCard(card.marketHashName, queue);
            if (!pk) {
              log(`  ⚠ 卡牌 "${card.name}" (market: ${card.marketHashName}) 查价失败, 跳过此卡`, "warn");
              failedPriceCount++;
              info.hasEstimated = true;
              continue;
            }
            if (pk.noPriceData) {
              log(`  ⚠ 卡牌 "${card.name}" Steam 仅返回 success，无可用价格`, "warn");
              card.priceSource = "none";
              noPriceCards.push(card);
              info.hasEstimated = true;
              continue;
            }

            card.lowestCents = pk.lowestSellCents;
            card.medianCents = pk.medianCents;
            card.volume = pk.volume;
            card.priceSource = pk.priceSource;
            if (pk.volume < minVolume) minVolume = pk.volume;
            if (pk.estimated) {
              info.hasEstimated = true;
              info.hasMedianFallback = true;
            }
            info.cardPrices.push({
              name: card.name,
              lowestCents: pk.lowestSellCents,
              medianCents: pk.medianCents,
              volume: pk.volume,
              marketHashName: card.marketHashName,
              priceSource: pk.priceSource,
            });

            const need1 = Math.max(0, 1 - card.owned);
            const need5 = Math.max(0, setsTo5 - card.owned);
            setCostCents += pk.lowestSellCents * need1;
            fullSetCostCents += pk.lowestSellCents;
            level5CostCents += need5 > 0
              ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents)
              : 0;

            if (fullSetCostCents > thresholdCents) {
              log(`  → 已查${info.cardPrices.length}/${info.totalInSet}张, 全套 ¥${formatCNY(fullSetCostCents)} > ¥${cfg.threshold}，跳过`, "info");
              allPriced = false;
              thresholdSkip = true;
              break;
            }

            if (cfg.earlyPricePrediction) {
              const prediction = predictFullSetLowerBound(
                info.cardPrices,
                info.totalInSet,
                fullSetCostCents
              );
              const predictionLimit = Math.ceil(thresholdCents * EARLY_PREDICTION_MARGIN);
              if (prediction && prediction.predictedCents > predictionLimit) {
                log(
                  `  → 已查${prediction.sampleCount}/${info.totalInSet}张, ` +
                  `保守预测全套≥¥${formatCNY(prediction.predictedCents)} > ` +
                  `安全线¥${formatCNY(predictionLimit)}，提前跳过 ` +
                  `(样本¥${formatCNY(prediction.minPrice)}-${formatCNY(prediction.maxPrice)})`,
                  "info"
                );
                allPriced = false;
                thresholdSkip = true;
                break;
              }
            }
          }

          if (cancelledCurrent) {
            if (state.skipCurrent) {
              state.skipCurrent = false;
              log(`[${b.appid}] ${info.gameName}: 已跳过当前徽章`, "warn");
              skipped++;
              continue;
            }
            if (state.stopRequested) {
              log("已手动停止", "warn");
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

          if (info.cardPrices.length === 0) {
            log(`  → Steam 未返回任何可用价格，无法估算，跳过`, "warn");
            skipped++;
            continue;
          }

          const noPriceRatio = noPriceCards.length / info.totalInSet;
          if (noPriceCards.length > 0 && noPriceRatio >= 0.5) {
            const formulaEstimate = estimateMissingLevel5Cost(
              noPriceCards,
              info.cardPrices,
              setsTo5
            );
            if (formulaEstimate) {
              level5CostCents += formulaEstimate.estimatedCostCents;
              info.hasEstimated = true;
              info.hasFormulaEstimate = true;
              info.formulaEstimatedCards = noPriceCards.length;
              info.formulaEstimateUnitCents = formulaEstimate.estimatedUnitCents;
              log(
                `  → ${noPriceCards.length}/${info.totalInSet}张无价格，` +
                `按已知卡牌几何均价 ¥${formatCNY(formulaEstimate.estimatedUnitCents)} ` +
                `补充满级估算 ¥${formatCNY(formulaEstimate.estimatedCostCents)}`,
                "warn"
              );
            }
          }
          info.noPriceDataCount = noPriceCards.length;
          info.failedPriceCount = failedPriceCount;

          info.cheapestSetCostCents = setCostCents;
          info.fullSetCostCents = fullSetCostCents;
          info.level5CostCents = level5CostCents;
          info.minVolume = minVolume === Infinity ? 0 : minVolume;
          info.cheapestSetCNY = formatCNY(setCostCents);
          info.fullSetCNY = formatCNY(fullSetCostCents);
          info.level5CNY = formatCNY(level5CostCents);

          const autoBlCents = Math.round((state.cfg.autoBlackThreshold || 0) * 100);
          if (state.cfg.autoBlackEnabled && autoBlCents > 0 && fullSetCostCents > autoBlCents) {
            addToBlacklist(b.appid, info.gameName || b.gameName || "", 1);
            log(`  → 自动加入黑名单: 全套 ¥${info.fullSetCNY} > ¥${state.cfg.autoBlackThreshold}`, "info");
            skipped++;
            continue;
          }

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
      if (!state.stopRequested && !queue.stopped) {
        updateSummary();
        setSummaryVisibility(resultCount > 0);
      }
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
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      updateBulkActionState();
    }
  }

  // ============================================================
  // Render game row
  // ============================================================
  function sortArrow(key) {
    if (state.sortKey !== key) return "";
    return state.sortAsc ? " ▲" : " ▼";
  }

  function renderHeader(list) {
    const hdr = document.createElement("div");
    hdr.className = "stch-game-row stch-row-header";
    hdr.innerHTML = `
      <span class="stch-appid stch-sortable" data-sort="appid">游戏ID<span class="stch-sort-arrow">${sortArrow("appid")}</span></span>
      <span class="stch-name stch-sortable" data-sort="name">游戏名<span class="stch-sort-arrow">${sortArrow("name")}</span></span>
      <span class="stch-level stch-sortable" data-sort="level">等级<span class="stch-sort-arrow">${sortArrow("level")}</span></span>
      <span class="stch-cards stch-sortable" data-sort="cards">卡牌<span class="stch-sort-arrow">${sortArrow("cards")}</span></span>
      <span class="stch-cost stch-sortable" data-sort="cost">单套补全<span class="stch-sort-arrow">${sortArrow("cost")}</span></span>
      <span class="stch-full stch-sortable" data-sort="full">单套最低<span class="stch-sort-arrow">${sortArrow("full")}</span></span>
      <span class="stch-lv5 stch-sortable" data-sort="lv5">满级估算 <span class="stch-sort-arrow">${sortArrow("lv5")}</span><span style="cursor:help;color:#8f98a0;font-size:11px;" title="绿色:近期成交>1，参考性较强&#10;灰色:近期成交=1，参考性不强&#10;红色:近期成交=0，参考性较弱&#10;黄色:Steam返回信息不全，采用 median_price 或公式估算，结果可能偏低">?</span></span>
      <span class="stch-drops stch-sortable" data-sort="drops">掉落<span class="stch-sort-arrow">${sortArrow("drops")}</span></span>
      <span class="stch-buy">手动购买</span>
      <span class="stch-check"><input id="stch-result-select-all" class="stch-result-cb" type="checkbox" title="全选"></span>
    `;
    hdr.querySelectorAll(".stch-sortable").forEach(sp => {
      sp.addEventListener("click", () => sortAndRender(sp.dataset.sort));
    });
    hdr.querySelector("#stch-result-select-all").addEventListener("click", e => {
      e.stopPropagation();
      if (e.target.checked) {
        state.results.forEach(info => state.selectedResults.add(getResultKey(info)));
      } else {
        state.selectedResults.clear();
      }
      renderResults();
    });
    list.appendChild(hdr);
  }

  function getSortedResults() {
    const sorted = [...state.results];
    if (!state.sortKey) return sorted;
    return sorted.sort((a, b) => {
      let va, vb;
      switch (state.sortKey) {
        case "appid": va = +a.appid; vb = +b.appid; break;
        case "name": va = a.gameName || ""; vb = b.gameName || ""; break;
        case "level": va = a.level; vb = b.level; break;
        case "cards": va = a.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0);
                      vb = b.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0); break;
        case "cost": va = a.cheapestSetCostCents; vb = b.cheapestSetCostCents; break;
        case "full": va = a.fullSetCostCents; vb = b.fullSetCostCents; break;
        case "lv5": va = a.level5CostCents; vb = b.level5CostCents; break;
        case "drops": va = a.dropsRemaining; vb = b.dropsRemaining; break;
        default: return 0;
      }
      if (typeof va === "string") {
        const cmp = va.localeCompare(vb, "zh");
        return state.sortAsc ? cmp : -cmp;
      }
      return state.sortAsc ? va - vb : vb - va;
    });
  }

  function renderResults() {
    const list = document.getElementById("stch-list");
    if (!list) return;
    list.innerHTML = "";
    if (state.results.length === 0) {
      updateBulkActionState();
      updateResultColumns();
      return;
    }
    renderHeader(list);
    const sorted = getSortedResults();
    sorted.forEach(info => renderDataRow(list, info));
    updateBulkActionState();
    updateResultColumns();
  }

  function sortAndRender(key) {
    if (state.sortKey === key) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = key;
      state.sortAsc = true;
    }
    renderResults();
  }

  function renderDataRow(list, info) {
    const row = document.createElement("div");
    row.className = "stch-game-row";
    row.dataset.appid = info.appid;
    row.dataset.foil = info.isFoil ? 1 : 0;
    const ownedCards = info.cards.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const minVol = info.minVolume || 0;
    const lv5Color = info.hasEstimated ? "color:#c9a02c" : minVol > 1 ? "color:#4caf50" : minVol === 1 ? "color:#888" : "";
    const estimateNotes = [];
    if (info.hasFormulaEstimate) {
      estimateNotes.push(
        `Steam返回信息不全：${info.formulaEstimatedCards}张卡牌无价格，` +
        `使用已知卡牌几何均价 ¥${formatCNY(info.formulaEstimateUnitCents)} 估算`
      );
    }
    if (info.hasMedianFallback) {
      estimateNotes.push("部分卡牌无最低出售价格，使用 median_price 估算");
    }
    const unestimatedCards =
      Math.max(0, (info.noPriceDataCount || 0) - (info.formulaEstimatedCards || 0)) +
      (info.failedPriceCount || 0);
    if (unestimatedCards > 0) {
      estimateNotes.push(`${unestimatedCards}张卡牌未计入估算`);
    }
    const lv5Title = estimateNotes.length > 0
      ? `${estimateNotes.join("\n")}，结果可能偏低`
      : minVol > 1
        ? "近期成交>1，参考性较强"
        : minVol === 1
          ? "近期成交=1，参考性不强"
          : "近期成交=0，参考性较弱";
    row.appendChild(createTextSpan("stch-appid", `${info.appid}${info.isFoil ? "(箔)" : ""}`));
    row.appendChild(createTextSpan("stch-name", info.gameName || "(未知)"));
    row.appendChild(createTextSpan("stch-level", `Lv${info.level}/5`));
    row.appendChild(createTextSpan("stch-cards", `${ownedCards}/${info.totalInSet}`));
    row.appendChild(createTextSpan("stch-cost", `¥${info.cheapestSetCNY}`));
    row.appendChild(createTextSpan("stch-full", `¥${info.fullSetCNY}`));
    const lv5 = createTextSpan("stch-lv5", `¥${info.level5CNY}`);
    lv5.style.cssText = lv5Color;
    lv5.title = lv5Title;
    row.appendChild(lv5);
    row.appendChild(createTextSpan("stch-drops", info.dropsRemaining));

    const buyCell = document.createElement("span");
    buyCell.className = "stch-buy";
    const buyLink = document.createElement("a");
    buyLink.href = "javascript:void(0)";
    buyLink.className = "stch-buy-link";
    buyLink.dataset.appid = info.appid;
    buyLink.style.cssText = "text-decoration:underline;color:#66c0f4;cursor:pointer;";
    buyLink.textContent = "购买";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "stch-result-cb";
    checkbox.checked = state.selectedResults.has(getResultKey(info));
    checkbox.title = "选择此游戏进行重新计算或提交订购单";
    buyCell.appendChild(buyLink);
    row.appendChild(buyCell);
    const checkboxCell = document.createElement("span");
    checkboxCell.className = "stch-check";
    checkboxCell.appendChild(checkbox);
    row.appendChild(checkboxCell);

    buyLink.addEventListener("click", (e) => {
      e.stopPropagation();
      openMultibuy(info);
    });
    checkbox.addEventListener("click", e => {
      e.stopPropagation();
      const key = getResultKey(info);
      if (checkbox.checked) {
        state.selectedResults.add(key);
      } else {
        state.selectedResults.delete(key);
      }
      updateBulkActionState();
    });
    row.addEventListener("click", (e) => {
      if (e.target.closest(".stch-buy-link, .stch-result-cb")) return;
      const pUrl = getProfileUrl();
      if (pUrl) window.open(`${pUrl}/gamecards/${info.appid}/`, "_blank");
    });
    row.style.cursor = "pointer";
    list.appendChild(row);
  }

  function renderGameRow(info) {
    const list = document.getElementById("stch-list");
    if (list.children.length === 0) renderHeader(list);
    renderDataRow(list, info);
    updateBulkActionState();
    updateResultColumns();
  }

  function updateSummary() {
    const summary = document.getElementById("stch-summary");
    if (!summary) return;
    const count = state.results.length;
    const totalCNY = (state.results.reduce((s, r) => s + r.cheapestSetCostCents, 0) / 100).toFixed(2);
    const fullCNY = (state.results.reduce((s, r) => s + r.fullSetCostCents, 0) / 100).toFixed(2);
    const lv5CNY = (state.results.reduce((s, r) => s + r.level5CostCents, 0) / 100).toFixed(2);
    summary.innerHTML = `
      共 <b>${count}</b> 个 ≤ ¥${state.cfg.threshold} (单套卡牌价格上限)，补全总价 <b>¥${totalCNY}</b>，全套总价 ¥${fullCNY}，满级总价 ¥${lv5CNY}
    `;
  }

  // ============================================================
  // Multibuy
  // ============================================================
  const MULTIBUY_DATA_KEY = "stch_multibuy_data";
  const MULTIBUY_DATA_TTL = 5 * 60 * 1000;
  const MULTIBUY_FILL_TIMEOUT = 30000;

  function clearMultibuyData() {
    GM_setValue(MULTIBUY_DATA_KEY, null);
  }

  function getMultibuyQuantity(mode, badgeLevel, owned) {
    switch (mode) {
      case "complete5": return Math.max(0, (5 - badgeLevel) - owned);
      case "buy1":      return 1;
      case "buy5":      return 5;
      default:          return owned < 1 ? 1 : 0;
    }
  }

  function getMarketMinimumPriceCents() {
    const walletMinimum = Number(unsafeWindow.g_rgWalletInfo?.wallet_market_minimum);
    return Number.isFinite(walletMinimum) && walletMinimum > 0 ? walletMinimum * 3 : 21;
  }

  function getSessionId() {
    if (unsafeWindow.g_sessionID) return unsafeWindow.g_sessionID;
    const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function parseMarketHashNameFromHref(href) {
    const match = String(href || "").match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }

  async function loadActiveBuyOrders() {
    const response = await window.fetch(
      "https://steamcommunity.com/market/mylistings?start=0&count=100",
      { credentials: "include" }
    );
    if (!response.ok) {
      throw new Error(`读取现有订购单失败 (${response.status})`);
    }
    const data = await response.json();
    if (data?.success !== true && data?.success !== 1) {
      throw new Error("Steam 未返回现有订购单");
    }

    const doc = new DOMParser().parseFromString(data.results_html || "", "text/html");
    const orders = new Map();
    doc.querySelectorAll('[id^="mybuyorder_"]').forEach(row => {
      const link = row.querySelector('a[href*="/market/listings/"]');
      const href = link?.getAttribute("href") || "";
      if (!href.includes("/market/listings/753/")) return;
      const marketHashName = parseMarketHashNameFromHref(link?.getAttribute("href"));
      if (!marketHashName) {
        throw new Error("无法解析现有 Steam 卡牌订购单");
      }

      const quantityCell = row.querySelector(
        ".market_listing_buyorder_qty .market_listing_price"
      );
      const quantity = parseInt(quantityCell?.textContent || "", 10) || 0;
      if (quantity <= 0) {
        throw new Error(`无法解析现有订购单数量: ${marketHashName}`);
      }
      const orderId = row.id.replace("mybuyorder_", "");
      const current = orders.get(marketHashName) || { quantity: 0, orderIds: [] };
      current.quantity += quantity;
      if (orderId) current.orderIds.push(orderId);
      orders.set(marketHashName, current);
    });
    return orders;
  }

  function getPendingOrderExpectedQuantity(marketHashName) {
    const pending = state.pendingOrderQuantities.get(marketHashName);
    if (!pending) return 0;
    if (Date.now() - pending.createdAt > 2 * 60 * 1000) {
      state.pendingOrderQuantities.delete(marketHashName);
      return 0;
    }
    return pending.expectedQuantity;
  }

  function getOrderPriceSourceLabel(priceSource) {
    if (priceSource === "median") return "平均价格";
    if (priceSource === "highest") return "求购最高";
    return "在售最低";
  }

  function parseMarketOrderbookFromListingHtml(listingHtml, marketHashName) {
    const renderContextMatch = String(listingHtml || "").match(
      /window\.SSR\.renderContext=JSON\.parse\(("(?:\\.|[^"\\])*")\);/
    );
    if (!renderContextMatch) return null;

    try {
      const renderContext = JSON.parse(JSON.parse(renderContextMatch[1]));
      const queryData = JSON.parse(renderContext?.queryData || "{}");
      const queries = Array.isArray(queryData?.queries) ? queryData.queries : [];
      const orderbookQuery = queries.find(query => {
        const key = query?.queryKey;
        return Array.isArray(key)
          && key[0] === "market"
          && key[1] === "orderbook"
          && String(key[2]) === "753"
          && key[3] === marketHashName;
      }) || queries.find(query => {
        const data = query?.state?.data;
        return data && Object.prototype.hasOwnProperty.call(data, "amtMaxBuyOrder");
      });
      const orderbook = orderbookQuery?.state?.data;
      const highestBuyCents = Number(orderbook?.amtMaxBuyOrder);
      const currency = Number(orderbook?.eCurrency);
      if (!Number.isFinite(highestBuyCents) || highestBuyCents < 0) return null;
      return {
        highestBuyCents,
        currency: Number.isFinite(currency) ? currency : null,
      };
    } catch (_) {
      return null;
    }
  }

  async function fetchHighestBuyPrice(marketHashName) {
    const cached = state.highestBuyPrices.get(marketHashName);
    if (
      Number.isFinite(cached?.priceCents)
      && cached.priceCents > 0
      && Date.now() - cached.fetchedAt < 30000
    ) {
      return cached.priceCents;
    }

    const listingUrl =
      `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}`;
    const listingResponse = await window.fetch(listingUrl, { credentials: "include" });
    if (!listingResponse.ok) {
      throw new Error(`读取商品页失败 (${listingResponse.status})`);
    }
    const listingHtml = await listingResponse.text();
    const newOrderbook = parseMarketOrderbookFromListingHtml(
      listingHtml,
      marketHashName
    );
    if (newOrderbook) {
      const walletCurrency = Number(
        unsafeWindow.g_rgWalletInfo?.wallet_currency || 23
      );
      if (
        newOrderbook.currency != null
        && newOrderbook.currency !== walletCurrency
      ) {
        throw new Error(
          `商品页币种不一致 (${newOrderbook.currency}/${walletCurrency})`
        );
      }
      if (newOrderbook.highestBuyCents <= 0) {
        throw new Error("当前没有可用的最高求购价格");
      }
      state.highestBuyPrices.set(marketHashName, {
        priceCents: newOrderbook.highestBuyCents,
        fetchedAt: Date.now(),
      });
      return newOrderbook.highestBuyCents;
    }

    const itemNameIdMatch =
      listingHtml.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/)
      || listingHtml.match(/ItemActivityTicker\.Start\(\s*(\d+)\s*\)/);
    if (!itemNameIdMatch) {
      throw new Error("商品页缺少可用的订单簿数据");
    }

    const params = new URLSearchParams({
      country: unsafeWindow.g_strCountryCode || "CN",
      language: unsafeWindow.g_strLanguage || "schinese",
      currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
      item_nameid: itemNameIdMatch[1],
    });
    const histogramResponse = await window.fetch(
      `https://steamcommunity.com/market/itemordershistogram?${params}`,
      { credentials: "include" }
    );
    if (!histogramResponse.ok) {
      throw new Error(`读取市场订单簿失败 (${histogramResponse.status})`);
    }
    const histogram = await histogramResponse.json();
    const highestBuyCents = parseInt(histogram?.highest_buy_order, 10);
    if (
      (histogram?.success !== true && histogram?.success !== 1)
      || !Number.isFinite(highestBuyCents)
      || highestBuyCents <= 0
    ) {
      throw new Error("当前没有可用的最高求购价格");
    }

    state.highestBuyPrices.set(marketHashName, {
      priceCents: highestBuyCents,
      fetchedAt: Date.now(),
    });
    return highestBuyCents;
  }

  async function buildBuyOrderPlan(selected, activeOrders) {
    const configuredPriceSource =
      document.getElementById("stch-order-price-source")?.value
      || state.cfg.orderPriceSource
      || "lowest";
    const priceSource = ["lowest", "median", "highest"].includes(configuredPriceSource)
      ? configuredPriceSource
      : "lowest";
    const adjustmentInput = document.getElementById("stch-price-adjustment");
    const adjustmentValue = adjustmentInput
      ? parseFloat(adjustmentInput.value)
      : state.cfg.priceAdjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const minimumCents = getMarketMinimumPriceCents();
    const plan = [];
    const skipped = {
      covered: 0,
      missingPrice: 0,
      missingHash: 0,
      clamped: 0,
    };
    const candidates = [];

    for (const info of selected) {
      for (const card of info.cards) {
        if (!card.marketHashName) {
          skipped.missingHash++;
          continue;
        }

        const targetQuantity = getMultibuyQuantity(
          state.cfg.buyMode || "complete1",
          info.level,
          card.owned
        );
        if (targetQuantity <= 0) continue;

        const activeQuantity = activeOrders.get(card.marketHashName)?.quantity || 0;
        const pendingQuantity = getPendingOrderExpectedQuantity(card.marketHashName);
        const reservedQuantity = Math.max(activeQuantity, pendingQuantity);
        const quantity = Math.max(0, targetQuantity - reservedQuantity);
        if (quantity <= 0) {
          skipped.covered++;
          continue;
        }

        candidates.push({
          info,
          card,
          quantity,
          reservedQuantity,
          targetQuantity,
        });
      }
    }

    for (let index = 0; index < candidates.length; index++) {
      const { info, card, quantity, reservedQuantity, targetQuantity } = candidates[index];
      let basePriceCents = null;
      if (
        priceSource === "lowest"
        && card.priceSource === "lowest"
        && Number.isFinite(card.lowestCents)
        && card.lowestCents > 0
      ) {
        basePriceCents = card.lowestCents;
      } else if (
        priceSource === "median"
        && Number.isFinite(card.medianCents)
        && card.medianCents > 0
      ) {
        basePriceCents = card.medianCents;
      } else if (priceSource === "highest") {
        setStatus(`读取求购最高 ${index + 1}/${candidates.length}: ${card.name}`);
        try {
          basePriceCents = await fetchHighestBuyPrice(card.marketHashName);
        } catch (error) {
          log(
            `  ${info.gameName} · ${card.name}: ${error?.message || error}，已跳过`,
            "warn"
          );
        }
      }
      if (basePriceCents == null) {
        skipped.missingPrice++;
        continue;
      }

      const adjustedPrice = basePriceCents + adjustmentCents;
      const unitPriceCents = Math.max(minimumCents, adjustedPrice);
      if (unitPriceCents !== adjustedPrice) skipped.clamped++;
      plan.push({
        appid: info.appid,
        gameName: info.gameName,
        cardName: card.name,
        marketHashName: card.marketHashName,
        quantity,
        reservedQuantity,
        targetQuantity,
        basePriceCents,
        unitPriceCents,
        totalPriceCents: unitPriceCents * quantity,
      });
    }

    return { plan, skipped, priceSource, adjustmentCents, minimumCents };
  }

  function showBuyOrderConfirmation(planData, selectedGameCount) {
    return new Promise(resolve => {
      const { plan, skipped, priceSource, adjustmentCents, minimumCents } = planData;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
      const totalCents = plan.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const plannedGameCount = new Set(plan.map(item => `${item.appid}:${item.gameName}`)).size;
      const adjustmentText = `${adjustmentCents >= 0 ? "+" : "-"}¥${formatCNY(Math.abs(adjustmentCents))}`;

      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认提交长期订购单</h3>
          <div class="stch-order-summary">
            游戏 <b>${plannedGameCount}</b>/${selectedGameCount} 个 · 卡牌种类 <b>${plan.length}</b> ·
            数量 <b>${totalQuantity}</b> 张 · 新增最高占用 <b>¥${formatCNY(totalCents)}</b><br>
            价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> ·
            买价调整 <b>${adjustmentText}</b>
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note"></div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">提交订购单</div>
          </div>
        </div>
      `;

      const list = backdrop.querySelector(".stch-order-list");
      plan.forEach(item => {
        const row = document.createElement("div");
        row.className = "stch-order-item";
        row.title = `${item.gameName} · ${item.marketHashName}`;
        row.appendChild(createTextSpan("", `${item.gameName} · ${item.cardName}`));
        row.appendChild(createTextSpan("", `${item.quantity} 张`));
        row.appendChild(createTextSpan("", `¥${formatCNY(item.unitPriceCents)}`));
        list.appendChild(row);
      });

      const notes = [];
      if (skipped.covered) notes.push(`${skipped.covered} 种卡牌已被现有订购单覆盖`);
      if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 种卡牌缺少所选价格，已跳过`);
      if (skipped.missingHash) notes.push(`${skipped.missingHash} 种卡牌缺少市场标识，已跳过`);
      if (skipped.clamped) {
        notes.push(`${skipped.clamped} 种卡牌低于 Steam 最低价，已调整为 ¥${formatCNY(minimumCents)}`);
      }
      backdrop.querySelector(".stch-order-note").textContent =
        `${notes.join("；") || "未发现需跳过的卡牌"}。` +
        "订单将长期保留，直到成交或手动取消；提交即表示同意 Steam 订户协议。";

      const finish = confirmed => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", event => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }

  async function createLongTermBuyOrder(item) {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    if (unsafeWindow.g_bRequiresBillingInfo === true) {
      throw new Error("Steam 要求补充账单信息，请先在市场页面手动提交一次订单");
    }

    let confirmation = 0;
    for (let attempt = 0; attempt < 41; attempt++) {
      const body = new URLSearchParams({
        sessionid: sessionId,
        currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
        appid: "753",
        market_hash_name: item.marketHashName,
        price_total: String(item.totalPriceCents),
        quantity: String(item.quantity),
        first_name: "",
        last_name: "",
        billing_address: "",
        billing_address_two: "",
        billing_country: "",
        billing_city: "",
        billing_state: "",
        billing_postal_code: "",
        save_my_address: "0",
        confirmation: String(confirmation || 0),
      });
      const response = await window.fetch(
        "https://steamcommunity.com/market/createbuyorder/",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: body.toString(),
        }
      );
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (data?.success === 1) return data;
      if (data?.need_confirmation && data?.confirmation?.confirmation_id) {
        confirmation = data.confirmation.confirmation_id;
        if (attempt === 0) {
          log(`  ${item.cardName}: 等待 Steam 移动确认`, "warn");
          setStatus(`请在 Steam 移动应用中确认: ${item.cardName}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1500));
        continue;
      }
      throw new Error(data?.message || `提交失败 (${response.status})`);
    }
    throw new Error("等待 Steam 移动确认超时");
  }

  async function submitSelectedBuyOrders() {
    const selected = getSelectedResults();
    if (selected.length === 0 || state.scanning || state.bulkActionRunning) return;

    state.bulkActionRunning = true;
    updateBulkActionState();
    let submitted = 0;
    let failed = 0;
    try {
      setStatus("读取现有订购单");
      const activeOrders = await loadActiveBuyOrders();
      const planData = await buildBuyOrderPlan(selected, activeOrders);
      if (planData.plan.length === 0) {
        log(
          `无需提交订购单：已有订单已覆盖，或没有可用的${getOrderPriceSourceLabel(planData.priceSource)}`,
          "warn"
        );
        return;
      }

      const confirmed = await showBuyOrderConfirmation(planData, selected.length);
      if (!confirmed) return;

      for (let index = 0; index < planData.plan.length; index++) {
        const item = planData.plan[index];
        setStatus(`提交订购单 ${index + 1}/${planData.plan.length}: ${item.cardName}`);
        try {
          const result = await createLongTermBuyOrder(item);
          submitted++;
          state.pendingOrderQuantities.set(item.marketHashName, {
            expectedQuantity: item.reservedQuantity + item.quantity,
            createdAt: Date.now(),
          });
          log(
            `  ✓ ${item.gameName} · ${item.cardName}: ${item.quantity} 张 @ ` +
            `¥${formatCNY(item.unitPriceCents)}，订单 ${result.buy_orderid}`,
            "ok"
          );
        } catch (error) {
          failed++;
          log(
            `  ✗ ${item.gameName} · ${item.cardName}: ${error?.message || error}`,
            "err"
          );
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      log(`长期订购单提交结束: 成功 ${submitted}, 失败 ${failed}`, failed ? "warn" : "ok");
    } catch (error) {
      log(`无法提交长期订购单: ${error?.message || error}`, "err");
    } finally {
      state.bulkActionRunning = false;
      setStatus(null);
      updateBulkActionState();
    }
  }

  function sameMarketItems(left, right) {
    if (left.length !== right.length) return false;
    const a = [...left].sort();
    const b = [...right].sort();
    return a.every((item, index) => item === b[index]);
  }

  function getMultibuyItemsFromUrl(url) {
    const params = new URL(url).searchParams;
    const repeatedItems = params.getAll("items[]");
    if (repeatedItems.length > 0) return repeatedItems;

    const indexedItems = [];
    for (const [key, value] of params.entries()) {
      const match = key.match(/^items\[(\d+)\]$/);
      if (match) {
        indexedItems.push({ index: Number(match[1]), value });
      }
    }
    indexedItems.sort((a, b) => a.index - b.index);
    return indexedItems.map(item => item.value);
  }

  function getMarketHashNameFromLink(link) {
    const href = link?.getAttribute("href") || link?.href || "";
    const match = href.match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }

  function getFieldContext(field) {
    const attributes = [
      field?.name,
      field?.id,
      field?.className,
      field?.getAttribute?.("placeholder"),
      field?.getAttribute?.("aria-label"),
      field?.getAttribute?.("data-field"),
    ];
    return attributes.filter(Boolean).join(" ").toLowerCase();
  }

  function findMultibuyFields(row) {
    const steamQuantity = row.querySelector(
      "input.market_multi_quantity, input[name$='_qty'], input[id$='_qty']"
    );
    const steamPrice = row.querySelector(
      "input.market_multi_price, input[name$='_price'], input[id$='_price']"
    );
    if (steamQuantity || steamPrice) {
      return { quantity: steamQuantity, price: steamPrice };
    }

    const fields = [...row.querySelectorAll("input, select")].filter(field => {
      const type = (field.type || "").toLowerCase();
      return !field.disabled && !["hidden", "button", "submit", "checkbox", "radio"].includes(type);
    });
    const quantityPattern = /qty|quantity|count|数量/;
    const pricePattern = /price|cost|currency|buyorder|金额|价格|单价/;
    const quantity = fields.find(field => quantityPattern.test(getFieldContext(field))) || null;

    const priceCandidates = fields.filter(
      field => field !== quantity && (field.tagName || "").toUpperCase() !== "SELECT"
    );
    let price = priceCandidates.find(field => pricePattern.test(getFieldContext(field))) || null;
    if (!price) {
      const nestedPriceFields = [...row.querySelectorAll(
        ".market_multibuy_price input, .market_commodity_buyorder_price input, [class*='price'] input"
      )].filter(field => priceCandidates.includes(field));
      if (nestedPriceFields.length === 1) price = nestedPriceFields[0];
    }
    if (!price && priceCandidates.length === 1) {
      price = priceCandidates[0];
    }

    return { quantity, price };
  }

  function findMultibuyRow(link) {
    const isSingleItemContainer = node => {
      if (!node?.querySelector("input, select")) return false;
      const listingCount = node.querySelectorAll?.('a[href*="/market/listings/753/"]').length || 0;
      return listingCount <= 1;
    };
    const preferred = link.closest(
      "tr, .market_multibuy_item, .multibuy_item_row, [class*='multibuy'][class*='item']"
    );
    if (isSingleItemContainer(preferred)) return preferred;

    let node = link.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      if (isSingleItemContainer(node)) return node;
    }
    return null;
  }

  function setMultibuyFieldValue(field, value) {
    if (!field) return false;
    const nextValue = String(value);
    if (field.value === nextValue) return false;
    field.value = nextValue;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    $J(field).trigger("blur");
    return true;
  }

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
      const qty = getMultibuyQuantity(mode, info.level, c.owned);
      qtyByCard.push({ card: c, qty });
    });
    const toBuy = qtyByCard.filter(q => q.qty > 0);
    if (toBuy.length === 0) {
      log(`${info.gameName}: 当前模式下无需购买卡牌`, "info");
      return;
    }
    toBuy.forEach(q => {
      params.append("items[]", q.card.marketHashName);
      params.append("qty[]", String(q.qty));
    });

    const profileUrl = getProfileUrl();
    if (profileUrl) {
      params.set("steamdb_return_to", `${profileUrl}/gamecards/${info.appid}/`);
    }

    const adjustmentInput = document.getElementById("stch-price-adjustment");
    const adjustmentValue = adjustmentInput
      ? parseFloat(adjustmentInput.value)
      : state.cfg.priceAdjustment;
    const bufferCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const buyData = {
      appid: info.appid,
      gameName: info.gameName,
      bufferCents,
      createdAt: Date.now(),
      items: toBuy.map(q => q.card.marketHashName),
      cards: toBuy.map(q => ({
        marketHashName: q.card.marketHashName,
        lowestCents: q.card.priceSource === "lowest"
          && Number.isFinite(q.card.lowestCents)
          && q.card.lowestCents > 0
          ? q.card.lowestCents
          : null,
        name: q.card.name,
        qty: q.qty,
      })),
    };

    GM_setValue(MULTIBUY_DATA_KEY, JSON.stringify(buyData));

    const multibuyUrl = `https://steamcommunity.com/market/multibuy?${params.toString()}`;
    const totalQty = toBuy.reduce((s, q) => s + q.qty, 0);
    log(`${info.gameName}: 打开批量购买 (${totalQty} 张, 模式: ${mode})`, "ok");
    window.open(multibuyUrl, "_blank");
  }

  function initMultibuyAutoFill() {
    let data;
    try {
      const raw = GM_getValue(MULTIBUY_DATA_KEY, null);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch (_) {
      clearMultibuyData();
      return;
    }

    const currentItems = getMultibuyItemsFromUrl(window.location.href);
    const storedItems = Array.isArray(data?.items) ? data.items : [];
    const sameItems = sameMarketItems(currentItems, storedItems);
    const isFresh = Number.isFinite(data?.createdAt)
      && Date.now() - data.createdAt <= MULTIBUY_DATA_TTL;

    if (!data || !Array.isArray(data.cards) || data.cards.length === 0 || !sameItems || !isFresh) {
      console.warn("[STCH] Ignoring stale or mismatched multibuy data", {
        currentItems,
        storedItems,
        isFresh,
      });
      clearMultibuyData();
      return;
    }

    const bufferCents = data.bufferCents || 0;

    // Inject "恢复默认价格" button next to Steam's title
    const injectResetBtn = () => {
      const heading = document.querySelector("h2, h1, .market_multibuy_header, .pageheader");
      if (heading && !document.getElementById("stch-reset-btn")) {
        const btn = document.createElement("span");
        btn.id = "stch-reset-btn";
        btn.textContent = "恢复默认价格";
        btn.style.cssText = "margin-left:12px;padding:4px 12px;background:rgba(67,137,179,0.85);color:#fff;border-radius:3px;cursor:pointer;font-size:13px;";
        btn.addEventListener("click", () => { location.reload(); });
        heading.appendChild(btn);
      }
    };
    injectResetBtn();

    const cardsByHash = new Map(data.cards.map(card => [card.marketHashName, card]));
    const filledCards = new Set();
    const warnedCards = new Set();
    let finished = false;
    let completionTimer = null;
    let deadlineTimer = null;
    let observer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (completionTimer) clearTimeout(completionTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      clearMultibuyData();
      observer?.disconnect();
    };

    const tryFill = () => {
      if (finished) return;

      let changed = false;
      const listingLinks = document.querySelectorAll('a[href*="/market/listings/753/"]');
      listingLinks.forEach(listingLink => {
        const marketHashName = getMarketHashNameFromLink(listingLink);
        if (filledCards.has(marketHashName)) return;
        const card = cardsByHash.get(marketHashName);
        if (!card) return;

        const row = findMultibuyRow(listingLink);
        if (!row) return;
        const { quantity, price } = findMultibuyFields(row);
        if (!price) {
          if (!warnedCards.has(marketHashName)) {
            warnedCards.add(marketHashName);
            console.warn(`[STCH] Price input not found for ${marketHashName}`);
          }
          return;
        }

        if (card.lowestCents > 0) {
          changed = setMultibuyFieldValue(
            price,
            (
              Math.max(getMarketMinimumPriceCents(), card.lowestCents + bufferCents) / 100
            ).toFixed(2)
          ) || changed;
        }
        if (quantity) {
          changed = setMultibuyFieldValue(quantity, card.qty || 1) || changed;
        }
        filledCards.add(marketHashName);
      });

      if (changed && typeof unsafeWindow.UpdateOrderTotal === "function") {
        unsafeWindow.UpdateOrderTotal();
      }

      if (filledCards.size === data.cards.length && !completionTimer) {
        completionTimer = setTimeout(() => {
          tryFill();
          finish();
        }, 750);
      }
    };

    let pollCount = 0;
    const poll = () => {
      tryFill();
      if (finished) return;
      if (++pollCount >= MULTIBUY_FILL_TIMEOUT / 500) {
        finish();
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 600);

    observer = new MutationObserver(() => {
      if (!finished) tryFill();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    deadlineTimer = setTimeout(finish, MULTIBUY_FILL_TIMEOUT);
  }

  // ============================================================
  // Blacklist management
  // Source: 0 = 手动 (manual query+add), 1 = 自动 (auto threshold during scan)
  // ============================================================
  function addToBlacklist(appid, name, source, fixedVal = 0) {
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];

    // Already in list: just update fixed flag if requested
    if (bl.includes(appid)) {
      if (fixedVal) {
        let fixed = {};
        try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
        fixed[appid] = 1;
        state.cfg.blacklistFixed = JSON.stringify(fixed);
        saveConfig(state.cfg);
      }
      return;
    }

    bl.push(appid);
    state.cfg.blacklist = bl.join(",");

    let names = {};
    try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}
    names[appid] = name;
    state.cfg.blacklistNames = JSON.stringify(names);

    let sources = {};
    try { sources = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) {}
    sources[appid] = source;
    state.cfg.blacklistSources = JSON.stringify(sources);

    let dates = {};
    try { dates = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) {}
    dates[appid] = Date.now();
    state.cfg.blacklistDates = JSON.stringify(dates);

    if (fixedVal) {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      fixed[appid] = 1;
      state.cfg.blacklistFixed = JSON.stringify(fixed);
    }

    saveConfig(state.cfg);
  }

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
          .trim()
          .replace(/\s*徽章\s*$/, "")
          .trim() || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  let blLookupAppid = "";
  let blLookupName = "";

  function updateBlRow() {
    const add = document.getElementById("stch-bl-add");
    const addF = document.getElementById("stch-bl-add-fixed");
    const del = document.getElementById("stch-bl-del-sel");
    const fix = document.getElementById("stch-bl-fix-sel");
    const unfix = document.getElementById("stch-bl-unfix-sel");
    if (!add) return;

    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const cbs = [...(list ? list.querySelectorAll(".stch-bl-cb:checked") : [])];
    if (listFixed) cbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));

    const anyChecked = cbs.length > 0;
    const hasNormal = cbs.some(cb => {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      return !fixed[cb.dataset.appid];
    });
    const hasFixed = cbs.some(cb => {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      return !!fixed[cb.dataset.appid];
    });

    add.style.display = (blLookupName && !anyChecked) ? "" : "none";
    addF.style.display = (blLookupName && !anyChecked) ? "" : "none";
    del.style.display = anyChecked ? "" : "none";
    fix.style.display = (anyChecked && hasNormal) ? "" : "none";
    unfix.style.display = (anyChecked && hasFixed) ? "" : "none";

    if (anyChecked) { del.classList.remove("disabled"); del.classList.add("stch-btn-danger"); }
    if (fix.style.display !== "none") fix.classList.remove("disabled");
    if (unfix.style.display !== "none") unfix.classList.remove("disabled");
    if (anyChecked) document.getElementById("stch-bl-result").textContent = "";
  }

  function renderBlacklist() {
    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const countEl = document.getElementById("stch-bl-count");
    if (!list) return;
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
    let names = {};
    try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}
    let sources = {};
    try { sources = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) {}
    let dates = {};
    try { dates = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) {}
    let fixed = {};
    try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}

    const sourceLabels = { "0": "手动", "1": "自动" };
    const normal = bl.filter(a => !fixed[a]);
    const fixedList = bl.filter(a => fixed[a]);

    const formatDays = ts => {
      if (!ts) return "—";
      return String(Math.floor((Date.now() - ts) / 86400000));
    };

    const createHeader = () => {
      const header = document.createElement("div");
      header.className = "stch-bl-row stch-row-header";
      header.appendChild(createTextSpan("stch-bl-id", "游戏ID"));
      header.appendChild(createTextSpan("stch-bl-name", "游戏名"));
      header.appendChild(createTextSpan("stch-bl-fixed-col", ""));
      header.appendChild(createTextSpan("stch-bl-source", "来源"));
      header.appendChild(createTextSpan("stch-bl-days", "天数"));
      header.appendChild(createTextSpan("stch-bl-cb-hd", ""));
      return header;
    };

    const createPlaceholder = (text) => {
      const row = document.createElement("div");
      row.className = "stch-bl-row";
      const span = createTextSpan("", text);
      span.style.color = "#8f98a0";
      row.appendChild(span);
      return row;
    };

    const appendItems = (target, items) => {
      for (const appid of items) {
        const row = document.createElement("div");
        row.className = "stch-bl-row";
        row.appendChild(createTextSpan("stch-bl-id", appid));
        row.appendChild(createTextSpan("stch-bl-name", names[appid] || "—"));
        row.appendChild(createTextSpan("stch-bl-fixed-col", fixed[appid] ? "固定" : ""));
        row.appendChild(createTextSpan("stch-bl-source", sourceLabels[sources[appid]] || "—"));
        row.appendChild(createTextSpan("stch-bl-days", dates[appid] ? formatDays(dates[appid]) : "—"));

        const checkboxCell = document.createElement("span");
        checkboxCell.className = "stch-bl-cb-hd";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "stch-bl-cb";
        checkbox.dataset.appid = appid;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);
        target.appendChild(row);
      }
    };

    list.replaceChildren();
    if (listFixed) listFixed.replaceChildren();

    if (normal.length === 0 && fixedList.length === 0) {
      list.appendChild(createPlaceholder("黑名单为空"));
      if (countEl) countEl.textContent = "";
    } else {
      list.appendChild(createHeader());
      if (normal.length > 0) appendItems(list, normal);
      else list.appendChild(createPlaceholder("—"));
      if (countEl) countEl.innerHTML = `共 <b>${bl.length}</b> 项（固定 <b>${fixedList.length}</b>）`;
    }

    if (listFixed && fixedList.length > 0) {
      const separator = createTextSpan("stch-bl-sep", "固定黑名单");
      listFixed.appendChild(separator);
      appendItems(listFixed, fixedList);
    }

    const delBtn = document.getElementById("stch-bl-del-sel");
    if (delBtn) { delBtn.classList.add("disabled"); delBtn.classList.remove("stch-btn-danger"); }
    const cleanupBtn = document.getElementById("stch-bl-cleanup");
    if (cleanupBtn) { cleanupBtn.classList.add("disabled"); cleanupBtn.classList.remove("stch-btn-danger"); }

    const allCbs = [...list.querySelectorAll(".stch-bl-cb")];
    if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb"));
    allCbs.forEach(cb => {
      cb.addEventListener("change", () => {
        const delBtn2 = document.getElementById("stch-bl-del-sel");
        const anyChecked = [...list.querySelectorAll(".stch-bl-cb:checked")].length > 0
          || (listFixed && [...listFixed.querySelectorAll(".stch-bl-cb:checked")].length > 0);
        if (delBtn2) {
          if (anyChecked) { delBtn2.classList.remove("disabled"); delBtn2.classList.add("stch-btn-danger"); }
          else { delBtn2.classList.add("disabled"); delBtn2.classList.remove("stch-btn-danger"); }
        }
        updateBlRow();
      });
    });

    if (cleanupBtn) {
      const hasExpired = bl.some(a => !fixed[a] && dates[a] && (Date.now() - dates[a] > 7 * 86400000));
      if (hasExpired) { cleanupBtn.classList.remove("disabled"); cleanupBtn.classList.add("stch-btn-danger"); }
    }
  }

  let _stopTimeout = null;

  function requestStop() {
    if (state.scanning) {
      state.stopRequested = true;
      state.queue?.stop();
      log("已请求停止...", "warn");

      _stopTimeout = setTimeout(() => {
        if (state.scanning) {
          state.scanning = false;
          state.stopRequested = false;
          if (state.queue) {
            state.queue.clear();
            state.queue = null;
          }
          hideProgress();
          document.getElementById("stch-scan-btn").classList.remove("disabled");
          document.getElementById("stch-skip-btn").classList.add("disabled");
          document.getElementById("stch-stop-btn").classList.add("disabled");
          setScanPhase("done");
        }
      }, 5000);
    }
  }

  // ============================================================
  // Init
  // ============================================================
  const pageUrl = window.location.href;
  const initWhenReady = callback => {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  };

  if (pageUrl.includes("/market/multibuy")) {
    initWhenReady(initMultibuyAutoFill);
  } else {
    initWhenReady(injectEntryBtn);
  }

})();
