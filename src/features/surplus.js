import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { getBadgeTargetLevel, getGameCardsUrl } from "../utils/badge.js";

import { formatCNY, formatInt } from "../utils/format.js";

import { createTextSpan } from "../utils/dom.js";

import { getProfileUrl, getSteamId } from "../utils/steam.js";

import { loadCommunityInventoryCards } from "../services/inventory.js";

import { findInventoryCardForBadgeCard, selectSurplusAssets, summarizeAssetIds } from "../parsers/inventory.js";

import { updateAllActionStates, updateSurplusActionState } from "../ui/action-state.js";

import { surplusStatus } from "../status-controllers.js";

const { log: surplusLog, setStatus: setSurplusStatus, setProgress: setSurplusProgress, hideProgress: hideSurplusProgress } = surplusStatus;

export { updateSurplusActionState };

  export async function resolveSurplusForBadge(group, profileUrl, queue) {
    const response = await queue.fetch(
      getGameCardsUrl(profileUrl, group.appid, group, { language: "english" })
    );
    if (!response?.text?.includes("badge_card_set_card")) {
      throw new Error("未找到卡牌套组");
    }

    const info = parseGameCardsHtml(response.text, group.appid, group.isFoil);
    info.appid = group.appid;
    info.isFoil = group.isFoil;
    info.gameName = info.gameName || group.gameName || "";

    const targetLevel = group.isFoil ? 1 : 5;
    const level = Math.max(0, Number(info.level) || 0);
    const badgeMaxed = level >= targetLevel;
    const reservePerCard = Math.max(0, targetLevel - level);
    const results = [];

    for (const badgeCard of info.cards) {
      const inventoryCard = findInventoryCardForBadgeCard(group, badgeCard);
      if (!inventoryCard) continue;

      const surplusCount = Math.max(0, inventoryCard.totalCount - reservePerCard);
      if (surplusCount <= 0) continue;

      const surplusAssets = selectSurplusAssets(inventoryCard.assets, surplusCount);
      const marketableCount = surplusAssets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.selectedAmount : 0),
        0
      );
      const tradableCount = surplusAssets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.selectedAmount : 0),
        0
      );
      const assetSummary = summarizeAssetIds(surplusAssets);
      results.push({
        appid: group.appid,
        isFoil: group.isFoil,
        gameName: info.gameName || group.gameName || "",
        level,
        targetLevel,
        badgeMaxed,
        cardName: badgeCard.name || inventoryCard.name,
        marketHashName: badgeCard.marketHashName || inventoryCard.marketHashName,
        inventoryCount: inventoryCard.totalCount,
        reservedCount: reservePerCard,
        surplusCount,
        marketableCount,
        tradableCount,
        assets: surplusAssets,
        assetText: assetSummary.text,
        assetTitle: assetSummary.title,
      });
    }

    return results;
  }

  export function getVisibleSurplusResults() {
    const all = state.surplusResults || [];
    if (!state.cfg.surplusOnlyMaxed) return all;
    return all.filter(result => result.badgeMaxed);
  }

  export function updateSurplusSummary() {
    const row = document.getElementById("stch-surplus-summary-row");
    const summary = document.getElementById("stch-surplus-summary");
    if (!row || !summary) return;

    const visible = getVisibleSurplusResults();
    if (visible.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }

    const badgeCount = new Set(visible.map(result => `${result.appid}_${result.isFoil ? 1 : 0}`)).size;
    const surplusTotal = visible.reduce((sum, result) => sum + result.surplusCount, 0);
    const marketableTotal = visible.reduce((sum, result) => sum + result.marketableCount, 0);
    const tradableTotal = visible.reduce((sum, result) => sum + result.tradableCount, 0);
    summary.innerHTML =
      `共 <b>${badgeCount}</b> 个徽章 · ` +
      `<b>${visible.length}</b> 种卡牌 · ` +
      `多余 <b>${surplusTotal}</b> 张 · ` +
      `可出售 <b>${marketableTotal}</b> 张 · ` +
      `可交易 <b>${tradableTotal}</b> 张`;
    row.style.display = "";
  }

  export function renderSurplusResults() {
    const list = document.getElementById("stch-surplus-list");
    if (!list) return;
    list.innerHTML = "";

    const visible = getVisibleSurplusResults();
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-game-row";
      empty.textContent = state.surplusScanning
        ? "正在检测多余卡牌..."
        : state.surplusResults.length > 0
          ? "当前筛选下没有多余卡牌"
          : "尚未检测到多余卡牌";
      list.appendChild(empty);
      updateSurplusSummary();
      updateSurplusActionState();
      return;
    }

    const header = document.createElement("div");
    header.className = "stch-game-row stch-surplus-row stch-row-header";
    header.innerHTML = `
      <span class="stch-appid">游戏ID</span>
      <span class="stch-name">游戏名</span>
      <span class="stch-surplus-badge">徽章</span>
      <span class="stch-surplus-card">卡牌</span>
      <span class="stch-surplus-num">库存</span>
      <span class="stch-surplus-num">预留</span>
      <span class="stch-surplus-extra">多余</span>
      <span class="stch-surplus-num">可售</span>
      <span class="stch-surplus-num">可交易</span>
      <span class="stch-surplus-assets">资产ID</span>
    `;
    list.appendChild(header);

    for (const result of visible) {
      const row = document.createElement("div");
      row.className = "stch-game-row stch-surplus-row";
      row.style.cursor = "pointer";
      row.dataset.appid = result.appid;
      row.dataset.foil = result.isFoil ? 1 : 0;

      const appid = createTextSpan("stch-appid", `${result.appid}${result.isFoil ? "(箔)" : ""}`);
      const gameName = createTextSpan("stch-name", result.gameName || "(未知)");
      gameName.title = result.gameName || "";
      const badge = createTextSpan(
        "stch-surplus-badge",
        `Lv${result.level}/${result.targetLevel}`
      );
      const card = createTextSpan("stch-surplus-card", result.cardName || result.marketHashName);
      card.title = result.marketHashName || result.cardName || "";
      const inventory = createTextSpan("stch-surplus-num", result.inventoryCount);
      const reserved = createTextSpan("stch-surplus-num", result.reservedCount);
      const surplus = createTextSpan("stch-surplus-extra", result.surplusCount);
      const marketable = createTextSpan("stch-surplus-num", result.marketableCount);
      const tradable = createTextSpan("stch-surplus-num", result.tradableCount);
      const assets = createTextSpan("stch-surplus-assets", result.assetText || "—");
      assets.title = result.assetTitle || "";
      row.append(appid, gameName, badge, card, inventory, reserved, surplus, marketable, tradable, assets);

      row.addEventListener("click", event => {
        if (event.target.closest("a")) return;
        const profileUrl = getProfileUrl();
        if (profileUrl) {
          const suffix = result.isFoil ? "?border=1" : "";
          window.open(`${profileUrl}/gamecards/${result.appid}/${suffix}`, "_blank");
        }
      });
      list.appendChild(row);
    }

    updateSurplusSummary();
    updateSurplusActionState();
  }

  export async function startSurplusScan() {
    if (
      state.surplusScanning
      || state.scanning
      || state.bulkActionRunning
      || state.orderActionRunning
      || state.craftScanning
      || state.craftActionRunning
      || state.seasonalActionRunning
      || state.grindScanning
    ) {
      return;
    }

    if (location.hostname !== "steamcommunity.com") {
      surplusLog("请在 Steam 社区徽章页或库存页使用多余卡牌检测", "warn");
      return;
    }

    const profileUrl = getProfileUrl();
    const steamId = getSteamId();
    if (!profileUrl || !steamId) {
      surplusLog("未找到 Steam 个人资料地址或 SteamID", "err");
      return;
    }

    state.surplusScanning = true;
    state.surplusStopRequested = false;
    state.surplusResults = [];
    const logBox = document.getElementById("stch-surplus-log");
    if (logBox) logBox.innerHTML = "";
    renderSurplusResults();
    updateAllActionStates();

    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setSurplusStatus,
      surplusLog,
      cfg.scanInterval
    );
    state.surplusQueue = queue;

    try {
      surplusLog("【阶段 1/2】正在读取 Steam 社区库存");
      setSurplusProgress(0, 1, "阶段1: 读取库存");
      const inventory = await loadCommunityInventoryCards(steamId, queue);
      if (state.surplusStopRequested) {
        surplusLog("已停止检测", "warn");
        return;
      }

      if (inventory.groups.length === 0) {
        surplusLog("库存中没有检测到集换式卡牌", "warn");
        renderSurplusResults();
        return;
      }

      surplusLog(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，` +
        `卡牌 ${inventory.totalCards} 张，${inventory.cardTypeCount} 种，` +
        `${inventory.groups.length} 个徽章候选`,
        "ok"
      );
      surplusLog("【阶段 2/2】正在读取徽章等级并计算升满后剩余");

      let scanned = 0;
      let failed = 0;
      for (let index = 0; index < inventory.groups.length; index++) {
        if (state.surplusStopRequested) break;
        const group = inventory.groups[index];
        scanned++;
        const label = `${group.gameName || group.appid}${group.isFoil ? "（闪亮）" : ""}`;
        setSurplusProgress(
          index,
          inventory.groups.length,
          `阶段2: ${index + 1}/${inventory.groups.length} · ${label}`
        );
        setSurplusStatus(`读取徽章: ${label}`);

        try {
          const rows = await resolveSurplusForBadge(group, profileUrl, queue);
          if (rows.length === 0) {
            surplusLog(`[${group.appid}] ${label}: 没有升满后剩余`, "info");
            continue;
          }
          state.surplusResults.push(...rows);
          const surplusCount = rows.reduce((sum, row) => sum + row.surplusCount, 0);
          surplusLog(
            `[${group.appid}] ${label}: ${rows.length} 种卡牌，多余 ${surplusCount} 张`,
            "ok"
          );
          renderSurplusResults();
        } catch (error) {
          if (state.surplusStopRequested) break;
          failed++;
          surplusLog(
            `[${group.appid}] ${label}: 读取失败 ${error?.message || error?.status || error}`,
            "warn"
          );
        }
      }

      state.surplusResults.sort((left, right) => {
        const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
        if (gameCompare) return gameCompare;
        if (left.appid !== right.appid) return Number(left.appid) - Number(right.appid);
        if (left.isFoil !== right.isFoil) return Number(left.isFoil) - Number(right.isFoil);
        return (left.cardName || "").localeCompare(right.cardName || "", "zh-CN");
      });
      renderSurplusResults();

      if (state.surplusStopRequested) {
        surplusLog("已停止检测", "warn");
      } else {
        const totalSurplus = state.surplusResults.reduce((sum, result) => sum + result.surplusCount, 0);
        surplusLog(
          `检测完成：读取 ${scanned} 个徽章，失败 ${failed} 个，` +
          `找到 ${state.surplusResults.length} 种多余卡牌 / ${totalSurplus} 张`,
          failed ? "warn" : "ok"
        );
      }
    } catch (error) {
      if (!state.surplusStopRequested) {
        surplusLog(`检测中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      state.surplusQueue = null;
      state.surplusScanning = false;
      state.surplusStopRequested = false;
      hideSurplusProgress();
      setSurplusStatus(null);
      renderSurplusResults();
      updateAllActionStates();
    }
  }

  export function requestSurplusStop() {
    if (!state.surplusScanning) return;
    state.surplusStopRequested = true;
    state.surplusQueue?.stop();
    surplusLog("已请求停止检测", "warn");
    updateSurplusActionState();
  }
