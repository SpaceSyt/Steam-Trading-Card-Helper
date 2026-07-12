import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { getBadgeTargetLevel, getGameCardsUrl } from "../utils/badge.js";

import { getProfileUrl, getSteamId } from "../utils/steam.js";

import { loadCommunityInventoryCards } from "../services/inventory.js";

import { loadSidebarGemPrice } from "../sidebar/gems.js";

import { priceCard } from "../parsers/price.js";

import { getGemValueSellerNetCents, getSellerReceiveForBuyerPrice } from "../utils/market-fees.js";

import { formatMoney } from "../utils/format.js";

import { findInventoryCardForBadgeCard, selectSurplusAssets, summarizeAssetIds } from "../parsers/inventory.js";

import { updateAllActionStates, updateSurplusActionState } from "../ui/action-state.js";

import { surplusStatus } from "../status-controllers.js";

const { log: surplusLog, setStatus: setSurplusStatus, setProgress: setSurplusProgress, hideProgress: hideSurplusProgress } = surplusStatus;

export { updateSurplusActionState };

  export function getSurplusReservePolicy(info) {
    const targetLevel = getBadgeTargetLevel(info);
    const level = Math.max(0, Number(info?.level) || 0);
    if (info?.isUnlimitedLevelBadge) {
      const eligible = level >= 1;
      return {
        targetLevel,
        level,
        eligible,
        badgeMaxed: eligible,
        reservePerCard: 0,
      };
    }
    return {
      targetLevel,
      level,
      eligible: true,
      badgeMaxed: level >= targetLevel,
      reservePerCard: Math.max(0, targetLevel - level),
    };
  }

  function applySurplusMarketInfo(result, price, gemSackPriceCents) {
    result.priceCents = price && !price.noPriceData ? price.lowestSellCents || 0 : 0;
    result.medianCents = price && !price.noPriceData ? price.medianCents || 0 : 0;
    result.volume = price ? price.volume : null;
    result.priceSource = price?.priceSource || (price?.noPriceData ? "none" : "failed");
    result.marketNetCents = result.priceCents
      ? getSellerReceiveForBuyerPrice(result.priceCents)
      : 0;
    result.gemValueNetCents = getGemValueSellerNetCents(
      result.gemValue,
      gemSackPriceCents
    );
    result.gemBetter = result.marketNetCents > 0
      && result.gemValueNetCents > result.marketNetCents;
  }

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

    const policy = getSurplusReservePolicy(info);
    const { targetLevel, level, badgeMaxed, reservePerCard } = policy;
    if (!policy.eligible) return [];
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
      const totalGems = surplusAssets.reduce(
        (sum, asset) => sum + (asset.selectedAmount || 0) * (asset.gemValue || inventoryCard.gemValue || 0),
        0
      );
      results.push({
        appid: group.appid,
        isFoil: group.isFoil,
        gameName: info.gameName || group.gameName || "",
        level,
        targetLevel,
        badgeMaxed,
        isUnlimitedLevelBadge: !!info.isUnlimitedLevelBadge,
        cardName: badgeCard.name || inventoryCard.name,
        marketHashName: badgeCard.marketHashName || inventoryCard.marketHashName,
        imageUrl: inventoryCard.imageUrl || "",
        nameColor: inventoryCard.nameColor || "",
        backgroundColor: inventoryCard.backgroundColor || "",
        gemValue: inventoryCard.gemValue || 0,
        totalGems,
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
    return (state.surplusResults || []).filter(result => {
      if (state.cfg.surplusOnlyMaxed && !result.badgeMaxed) return false;
      if (state.cfg.surplusOnlyTradable && result.tradableCount <= 0) return false;
      return true;
    });
  }

  export function getSurplusResultKey(result) {
    const assetKey = (result.assets || [])
      .map(asset => `${asset.assetid || ""}x${asset.selectedAmount || asset.amount || 1}`)
      .join(",");
    return [
      "card",
      result.appid || "",
      result.isFoil ? 1 : 0,
      result.marketHashName || result.cardName || "",
      assetKey,
    ].join("|");
  }

  export function getSelectedSurplusResults() {
    const selected = state.selectedSurplusResults || new Set();
    return (state.surplusResults || []).filter(result =>
      selected.has(getSurplusResultKey(result))
    );
  }

  export function setAllVisibleSurplusSelection(selected) {
    if (!state.selectedSurplusResults) state.selectedSurplusResults = new Set();
    const visible = getVisibleSurplusResults();
    for (const result of visible) {
      const key = getSurplusResultKey(result);
      if (selected) state.selectedSurplusResults.add(key);
      else state.selectedSurplusResults.delete(key);
    }
    renderSurplusResults();
  }

  function pruneSelectedSurplusResults(visible) {
    const selected = state.selectedSurplusResults || new Set();
    const visibleKeys = new Set(visible.map(getSurplusResultKey));
    for (const key of [...selected]) {
      if (!visibleKeys.has(key)) selected.delete(key);
    }
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
    const selected = state.selectedSurplusResults || new Set();
    const selectedCount = visible.reduce(
      (count, result) => count + Number(selected.has(getSurplusResultKey(result))),
      0
    );
    summary.innerHTML =
      `共 <b>${badgeCount}</b> 个徽章 · ` +
      `<b>${visible.length}</b> 种卡牌 · ` +
      `多余 <b>${surplusTotal}</b> 张 · ` +
      `可出售 <b>${marketableTotal}</b> 张 · ` +
      `可交易 <b>${tradableTotal}</b> 张 · ` +
      `已选择 <b>${selectedCount}</b> 项`;
    row.style.display = "";
  }

  export function renderSurplusResults() {
    const list = document.getElementById("stch-surplus-list");
    if (!list) return;
    list.innerHTML = "";
    list.classList.add("stch-inventory-grid");

    const visible = getVisibleSurplusResults();
    pruneSelectedSurplusResults(visible);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-inventory-empty";
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

    for (const result of visible) {
      const key = getSurplusResultKey(result);
      const tile = document.createElement("div");
      tile.className = "stch-inv-tile";
      const volumeZero = result.volume === 0;
      tile.classList.toggle("stch-volume-zero", volumeZero);
      tile.classList.toggle(
        "stch-gem-better",
        state.cfg.surplusCompareGems && result.gemBetter
      );
      tile.dataset.key = key;
      tile.classList.toggle("selected", state.selectedSurplusResults?.has(key));
      tile.title = [
        `${result.gameName || "未知游戏"} · ${result.cardName || result.marketHashName || "未知卡牌"}`,
        result.isUnlimitedLevelBadge
          ? `特卖徽章 Lv${result.level}（Lv1 后可处理多余卡牌）`
          : `徽章 Lv${result.level}/${result.targetLevel}`,
        `库存 ${result.inventoryCount}，预留 ${result.reservedCount}，多余 ${result.surplusCount}`,
        `可出售 ${result.marketableCount}，可交易 ${result.tradableCount}`,
        result.volume === 0
          ? "市场成交量 0"
          : Number.isFinite(result.volume)
            ? `市场成交量 ${result.volume}`
            : "市场价格尚未读取",
        result.priceCents
          ? `市场参考 ${formatMoney(result.priceCents)}，出售税后约 ${formatMoney(result.marketNetCents)}`
          : "",
        result.gemValueNetCents
          ? `${result.gemValue} 宝石/张，税后折算约 ${formatMoney(result.gemValueNetCents)}`
          : "",
        state.cfg.surplusCompareGems && result.gemBetter
          ? "宝石价值高于出售税后到手价"
          : "",
        result.assetTitle ? `资产ID:\n${result.assetTitle}` : "",
      ].filter(Boolean).join("\n");
      if (result.nameColor) tile.style.borderColor = result.nameColor;
      if (result.backgroundColor) tile.style.backgroundColor = result.backgroundColor;

      if (result.imageUrl) {
        const image = document.createElement("img");
        image.src = result.imageUrl;
        image.alt = result.cardName || result.marketHashName || "";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "stch-inv-placeholder";
        placeholder.textContent = result.cardName || "?";
        tile.appendChild(placeholder);
      }

      const count = document.createElement("span");
      count.className = "stch-inv-badge";
      count.textContent = `x${result.surplusCount}`;
      count.title = "多余数量";
      tile.appendChild(count);

      if (result.marketableCount > 0) {
        const market = document.createElement("span");
        market.className = "stch-inv-badge stch-inv-badge-left";
        market.textContent = `可售 ${result.marketableCount}`;
        tile.appendChild(market);
      }

      const name = document.createElement("div");
      name.className = "stch-inv-name";
      name.textContent = result.cardName || result.marketHashName || "未知卡牌";
      tile.appendChild(name);

      tile.addEventListener("click", () => {
        if (!state.selectedSurplusResults) state.selectedSurplusResults = new Set();
        if (state.selectedSurplusResults.has(key)) {
          state.selectedSurplusResults.delete(key);
          tile.classList.remove("selected");
        } else {
          state.selectedSurplusResults.add(key);
          tile.classList.add("selected");
        }
        updateSurplusSummary();
        updateSurplusActionState();
      });
      list.appendChild(tile);
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
      || state.surplusActionRunning
      || state.grindScanning
    ) {
      return;
    }

    if (location.hostname !== "steamcommunity.com") {
      surplusLog("请在 Steam 社区徽章页或库存页使用多余物品处理", "warn");
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
    state.selectedSurplusResults = new Set();
    state.surplusGemPrice = null;
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
      surplusLog
    );
    state.surplusQueue = queue;

    try {
      surplusLog("【阶段 1/3】正在读取 Steam 社区库存");
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
      surplusLog("【阶段 2/3】正在读取徽章等级并计算升满后剩余");

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
            if (state.cfg.showNoResultLogs) {
              surplusLog(`[${group.appid}] ${label}: 没有升满后剩余`, "info");
            }
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

      let priceFailed = 0;
      let zeroVolume = 0;
      if (!state.surplusStopRequested && state.surplusResults.length > 0) {
        surplusLog("【阶段 3/3】正在查询市场成交量并计算宝石价值");
        try {
          state.surplusGemPrice = await loadSidebarGemPrice(queue);
          if (state.surplusGemPrice.priceCents) {
            surplusLog(
              `宝石袋 ${state.surplusGemPrice.source} ${formatMoney(state.surplusGemPrice.priceCents)}`,
              "info"
            );
          }
        } catch (error) {
          surplusLog(`宝石袋价格读取失败: ${error?.message || error}`, "warn");
        }

        const priceCache = new Map();
        for (let index = 0; index < state.surplusResults.length; index++) {
          if (state.surplusStopRequested) break;
          const result = state.surplusResults[index];
          setSurplusProgress(
            index,
            state.surplusResults.length,
            `阶段3: ${index + 1}/${state.surplusResults.length} · ${result.cardName || result.marketHashName}`
          );
          setSurplusStatus(`查询市场: ${result.cardName || result.marketHashName}`);

          let price = null;
          if (result.marketHashName) {
            if (priceCache.has(result.marketHashName)) {
              price = priceCache.get(result.marketHashName);
            } else {
              price = await priceCard(result.marketHashName, queue);
              priceCache.set(result.marketHashName, price);
            }
          }
          applySurplusMarketInfo(
            result,
            price,
            state.surplusGemPrice?.priceCents || 0
          );
          if (!price) priceFailed++;
          if (result.volume === 0) zeroVolume++;
          renderSurplusResults();
        }

        if (!state.surplusStopRequested) {
          surplusLog(
            `市场比较完成：成交量为 0 的卡牌 ${zeroVolume} 种，查价失败 ${priceFailed} 种`,
            priceFailed ? "warn" : "ok"
          );
        }
      }

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
