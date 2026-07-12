// ==UserScript==
// @name         Steam Card Price Data Collector
// @namespace    https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @version      1.0.0
// @description  Collect all badge card prices for analysis (TSV export)
// @match        *://steamcommunity.com/id/*/badges*
// @match        *://steamcommunity.com/profiles/*/badges*
// @grant        GM_addStyle
// @grant        unsafeWindow
// @license      MIT
// ==/UserScript==

(() => {
  "use strict";

  const $J = unsafeWindow.jQuery || unsafeWindow.$;
  if (!$J) { console.warn("[DCP] jQuery not found"); return; }

  // ============================================================
  // RequestQueue (copied from main script)
  // ============================================================
  class RequestQueue {
    constructor(interval, batchSize, batchPause) {
      this.interval = interval;
      this.batchSize = batchSize;
      this.batchPause = batchPause;
      this.queue = [];
      this.running = false;
      this.stopped = false;
      this._reqCount = 0;
    }

    fetch(url, options = {}) {
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
            const res = await window.fetch(job.url, { credentials: "include", ...job.options });
            if (res.status === 429) {
              this.queue.unshift(job);
              const pauseMs = this.batchPause;
              if (this.onStatus) this.onStatus(`限流冷却中 (${(pauseMs/1000).toFixed(0)}s)`);
              for (let tick = 0; tick < pauseMs / 500; tick++) {
                await new Promise(r => setTimeout(r, 500));
                if (this.stopped) break;
              }
              if (this.stopped) { job.reject({ status: 0, error: "stopped" }); continue; }
              continue;
            }
            if (res.status >= 500) { await new Promise(r => setTimeout(r, this.interval * 3)); }
            const text = await res.text();
            let data = null;
            try { data = JSON.parse(text); } catch (_) {}
            if (!res.ok) { job.reject({ status: res.status, text, data }); }
            else { job.resolve({ status: res.status, text, data }); }
          } catch (e) {
            job.reject({ error: e?.message || String(e) });
          }
          this._reqCount++;
          if (this._reqCount >= this._batchSize) {
            this._reqCount = 0;
            await new Promise(r => setTimeout(r, this.batchPause));
          } else {
            await new Promise(r => setTimeout(r, this.interval));
          }
        }
      } finally { this.running = false; }
      if (this.queue.length > 0 && !this.stopped) this._run();
    }
  }

  // ============================================================
  // Helpers
  // ============================================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function getProfileUrl() {
    try {
      if (unsafeWindow.g_strProfileURL) return unsafeWindow.g_strProfileURL;
      const m = unsafeWindow.location?.href?.match(/(.+?\/)(?:badges)/);
      return m ? m[1].replace(/\/$/, "") : "";
    } catch (_) { return ""; }
  }

  function parsePrice(str) {
    if (!str) return 0;
    const n = parseFloat(str.replace(/[^0-9.,]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }

  // ============================================================
  // parseGameCardsHtml (copied from main script)
  // ============================================================
  function parseGameCardsHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let gameName = "";
    const titleEl = doc.querySelector(".badge_title");
    if (titleEl) {
      gameName = (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent)
        .replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
        .replace(/徽章$/i, "").trim();
    }
    const cardSetCards = doc.querySelectorAll(".badge_card_set_card");
    const cardList = [];
    cardSetCards.forEach(el => {
      const titleNode = el.querySelector(".badge_card_set_title");
      if (!titleNode) return;
      const qtyNode = el.querySelector(".badge_card_set_text_qty");
      const owned = qtyNode ? (parseInt(qtyNode.textContent.replace(/[()（）\[\]]/g, ""), 10) || 0) : 0;
      let name = titleNode.textContent.trim();
      if (qtyNode) name = name.replace(qtyNode.textContent, "").trim();
      cardList.push({ name, owned, marketHashName: "" });
    });
    const multibuyBtn = doc.querySelector('a[href*="multibuy"]');
    if (multibuyBtn) {
      const mbHref = (multibuyBtn.getAttribute("href") || "").replace(/&amp;/g, "&");
      const itemRe = /[?&]items\[\]=([^&]+)/g;
      let im, i = 0;
      while ((im = itemRe.exec(mbHref)) !== null && i < cardList.length) {
        try { cardList[i].marketHashName = decodeURIComponent(im[1]); } catch (_) { cardList[i].marketHashName = im[1]; }
        i++;
      }
    }
    const toCollect = doc.querySelectorAll(".badge_card_to_collect");
    toCollect.forEach(tc => {
      const titleNode = tc.querySelector(".badge_card_set_title");
      const marketLink = tc.querySelector('a[href*="/market/listings/"]');
      if (!titleNode || !marketLink) return;
      const m = (marketLink.getAttribute("href") || "").match(/\/market\/listings\/\d+\/(.+?)(?:\?|$)/);
      if (!m) return;
      let mhn;
      try { mhn = decodeURIComponent(m[1]); } catch (_) { mhn = m[1]; }
      for (const c of cardList) {
        if (c.name === titleNode.textContent.trim() && !c.marketHashName) { c.marketHashName = mhn; break; }
      }
    });
    return { gameName, cards: cardList };
  }

  // ============================================================
  // priceCard (copied from main script)
  // ============================================================
  async function priceCard(marketHashName, queue) {
    try {
      const url = `https://steamcommunity.com/market/priceoverview/?appid=753&currency=23&market_hash_name=${encodeURIComponent(marketHashName)}`;
      const res = await queue.fetch(url);
      if (!res?.data?.success) return null;
      const lowestCents = parsePrice(res.data.lowest_price);
      if (!lowestCents) return null;
      const medianCents = parsePrice(res.data.median_price);
      const volume = parseInt(res.data.volume, 10) || 0;
      return { lowestCents, medianCents, volume };
    } catch (e) { return null; }
  }

  // ============================================================
  // CSS
  // ============================================================
  GM_addStyle(`
    #dcp-entry {
      display: inline-block; padding: 6px 12px; margin-left: 10px;
      background: rgba(120, 180, 80, 0.85); color: #fff;
      border-radius: 3px; cursor: pointer; font-size: 13px;
    }
    #dcp-entry:hover { background: rgba(140, 200, 100, 1); }
    #dcp-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      z-index: 10000; display: none;
    }
    #dcp-modal {
      position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
      width: 620px; max-width: 95vw; height: 80vh;
      background: #1b2838; color: #c6d4df;
      z-index: 10001; border-radius: 4px; overflow: hidden;
      display: flex; flex-direction: column;
      font-family: "Motiva Sans", Arial, sans-serif; font-size: 14px;
    }
    #dcp-modal .dcp-header {
      padding: 10px 16px; border-bottom: 1px solid #45556b;
      display: flex; align-items: center; background: #171a21;
    }
    #dcp-modal .dcp-header h2 { margin: 0; font-size: 18px; flex: 1; color: #fff; }
    #dcp-modal .dcp-close { cursor: pointer; font-size: 22px; color: #8f98a0; }
    #dcp-modal .dcp-close:hover { color: #fff; }
    #dcp-modal .dcp-body {
      flex: 1; overflow-y: auto; padding: 12px 16px;
      display: flex; flex-direction: column; min-height: 0;
    }
    .dcp-btn {
      padding: 6px 14px; border: none;
      background: linear-gradient(to bottom, #75b022 5%, #588a1b 95%);
      color: #fff; border-radius: 2px; cursor: pointer; font-size: 14px;
    }
    .dcp-btn:hover { background: linear-gradient(to bottom, #8ed629 5%, #6aa621 95%); }
    .dcp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .dcp-btn.stop { background: linear-gradient(to bottom, #c04040 5%, #8b2020 95%); }
    .dcp-row { display: flex; gap: 10px; align-items: center; margin: 8px 0; }
    .dcp-status { color: #8db7d7; font-size: 13px; padding: 4px 0; }
    .dcp-progress {
      height: 18px; background: #0e1621; border-radius: 2px;
      overflow: hidden; margin: 4px 0; position: relative;
    }
    .dcp-progress-bar {
      height: 100%; background: linear-gradient(to right, #78b450, #8ec864);
      transition: width 0.2s;
    }
    .dcp-progress-text {
      position: absolute; inset: 0; text-align: center;
      font-size: 12px; line-height: 18px; color: #fff;
    }
    #dcp-log {
      flex: 1; min-height: 60px; overflow-y: auto;
      background: #0e1621; border-radius: 3px; padding: 8px;
      font-family: "Courier New", monospace; font-size: 12px;
      line-height: 1.5; color: #b0c3d9;
      white-space: pre-wrap; word-break: break-all; margin-top: 6px;
    }
    #dcp-log .ok { color: #75b022; }
    #dcp-log .warn { color: #ffc902; }
    #dcp-log .err { color: #c04040; }
    #dcp-log .info { color: #67c1f5; }
    #dcp-output {
      flex: 1; min-height: 50px; max-height: 120px; overflow-y: auto;
      background: #0e1621; border: 1px solid #2a3f5a;
      border-radius: 3px; padding: 8px; margin-top: 6px;
      font-family: "Courier New", monospace; font-size: 11px;
      color: #c6d4df; white-space: pre-wrap; word-break: break-all;
    }
  `);

  // ============================================================
  // State + UI refs
  // ============================================================
  let running = false;
  let results = [];
  let modalEl = null;

  function log(msg, cls = "") {
    const box = document.getElementById("dcp-log");
    if (!box) { console.log("[DCP]", msg); return; }
    const line = document.createElement("div");
    line.textContent = msg;
    if (cls) line.className = cls;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
  }

  function updateOutput() {
    const lines = ["appid\tgameName\tcardIdx\ttotalCards\tcardName\tlowestCNY\tmedianCNY\tvolume\tmarketHashName"];
    results.forEach(r => {
      r.cards.forEach((c, i) => {
        lines.push([
          r.appid, `"${r.gameName}"`, i + 1, r.cards.length,
          `"${c.name}"`, (c.lowestCents / 100).toFixed(2),
          (c.medianCents / 100).toFixed(2), c.volume, c.marketHashName
        ].join("\t"));
      });
    });
    document.getElementById("dcp-output").textContent = lines.join("\n");
  }

  // ============================================================
  // Main collect flow
  // ============================================================
  async function startCollect() {
    if (running) return;
    running = true;
    results = [];

    document.getElementById("dcp-start").disabled = true;
    document.getElementById("dcp-stop").disabled = false;
    document.getElementById("dcp-output").textContent = "";
    document.getElementById("dcp-log").innerHTML = "";

    const profileUrl = getProfileUrl();
    if (!profileUrl) { log("无法获取 Profile URL", "err"); stopCollect(); return; }

    log("=== 开始收集 (本页) ===", "info");

    // Scan current badge page
    const badges = [];
    const seen = new Set();
    const rows = document.querySelectorAll(".badge_row");
    rows.forEach(row => {
      const link = row.querySelector('a[href*="/gamecards/"]');
      if (!link) return;
      const m = (link.getAttribute("href") || "").match(/\/gamecards\/(\d+)/);
      if (!m || seen.has(m[1])) return;
      seen.add(m[1]);
      const nameEl = row.querySelector(".badge_title");
      badges.push({ appid: m[1], gameName: nameEl ? nameEl.textContent.replace(/徽章$/i, "").trim() : "" });
    });
    log(`本页找到 ${badges.length} 个徽章`, "ok");
    if (badges.length === 0) { stopCollect(); return; }

    const queue = new RequestQueue(450, 20, 45000);

    for (let i = 0; i < badges.length; i++) {
      if (!running) break;
      const b = badges[i];
      document.getElementById("dcp-status").textContent = `${i + 1}/${badges.length}: ${b.gameName || b.appid}`;
      document.getElementById("dcp-progress-bar").style.width = ((i / badges.length) * 100).toFixed(0) + "%";
      document.getElementById("dcp-progress-text").textContent = `${i + 1}/${badges.length}`;

      try {
        const res = await queue.fetch(`${profileUrl}/gamecards/${b.appid}/`);
        if (!res || !res.text?.includes("badge_card_set_card")) continue;
        const parsed = parseGameCardsHtml(res.text);

        const pricedCards = [];
        for (const card of parsed.cards) {
          if (!running) break;
          if (!card.marketHashName) continue;
          const pk = await priceCard(card.marketHashName, queue);
          pricedCards.push({
            name: card.name,
            marketHashName: card.marketHashName,
            lowestCents: pk ? pk.lowestCents : 0,
            medianCents: pk ? pk.medianCents : 0,
            volume: pk ? pk.volume : 0,
          });
        }

        if (pricedCards.length > 0) {
          results.push({ appid: b.appid, gameName: b.gameName || parsed.gameName, cards: pricedCards });
          updateOutput();
          log(`[${b.appid}] ${b.gameName || parsed.gameName}: ${pricedCards.length} 张卡`, "ok");
        }
      } catch (e) {
        log(`[${b.appid}] 错误: ${e?.message || e}`, "err");
      }
    }

    document.getElementById("dcp-progress-bar").style.width = "100%";
    document.getElementById("dcp-progress-text").textContent = "完成";
    document.getElementById("dcp-status").textContent = `完成: ${results.length} 套已收集`;
    log(`=== 完成: ${results.length} 套, 复制上方 TSV 数据给我 ===`, "ok");
    stopCollect();
  }

  function stopCollect() {
    running = false;
    document.getElementById("dcp-start").disabled = false;
    document.getElementById("dcp-stop").disabled = true;
  }

  // ============================================================
  // UI
  // ============================================================
  function injectBtn() {
    const target = document.querySelector(".profile_xp_block") || document.querySelector(".badges_header");
    if (!target) { setTimeout(injectBtn, 500); return; }
    const btn = document.createElement("span");
    btn.id = "dcp-entry";
    btn.textContent = "Price Collector";
    btn.addEventListener("click", openModal);
    target.appendChild(btn);
  }

  function openModal() {
    if (modalEl) { modalEl.style.display = ""; document.getElementById("dcp-backdrop").style.display = "block"; return; }
    buildModal();
  }

  function closeModal() {
    if (running) { if (!confirm("收集未完成，确定关闭？")) return; stopCollect(); }
    document.getElementById("dcp-backdrop")?.remove();
    modalEl?.remove();
    modalEl = null;
  }

  function buildModal() {
    const backdrop = document.createElement("div");
    backdrop.id = "dcp-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);

    const modal = document.createElement("div");
    modal.id = "dcp-modal";
    modal.addEventListener("click", e => e.stopPropagation());
    modal.innerHTML = `
      <div class="dcp-header">
        <h2>卡牌价格数据收集器</h2>
        <span class="dcp-close">&times;</span>
      </div>
      <div class="dcp-body">
        <div class="dcp-row">
          <div class="dcp-btn" id="dcp-start">开始收集 (本页)</div>
          <div class="dcp-btn stop" id="dcp-stop" disabled>停止</div>
        </div>
        <div class="dcp-status" id="dcp-status">就绪</div>
        <div class="dcp-progress">
          <div class="dcp-progress-bar" id="dcp-progress-bar" style="width:0"></div>
          <div class="dcp-progress-text" id="dcp-progress-text">0/0</div>
        </div>
        <div style="color:#8f98a0;font-size:12px">TSV 输出 (全选 → 复制 → 发给我):</div>
        <div id="dcp-output"></div>
        <div style="color:#8f98a0;font-size:12px;margin-top:4px">日志:</div>
        <div id="dcp-log"></div>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;

    modal.querySelector(".dcp-close").addEventListener("click", closeModal);
    document.getElementById("dcp-start").addEventListener("click", startCollect);
    document.getElementById("dcp-stop").addEventListener("click", stopCollect);
  }

  // ============================================================
  // Init (wait for jQuery + DOM)
  // ============================================================
  function init() {
    const target = document.querySelector(".profile_xp_block") || document.querySelector(".badges_header");
    if (target) { injectBtn(); return; }
    setTimeout(init, 300);
  }
  window.addEventListener("load", init);
})();
