import { state } from "../state.js";

import { RequestQueue } from "../request/queue.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { getGameCardsUrl } from "../utils/badge.js";

import { getProfileUrl, getSteamId } from "../utils/steam.js";

import { loadCommunityInventoryCards } from "../services/inventory.js";

import { loadSidebarGemPrice } from "../sidebar/gems.js";

import {
  isPriceCardNoPrice,
  isPriceCardPriced,
  priceCard,
} from "../parsers/price.js";
import { persistMarketObservations } from "../services/market-observations.js";

import { formatMoney } from "../utils/format.js";

import { applyItemRecommendation } from "../services/item-recommendation.js";
import { getSurplusReservePolicy } from "../services/surplus-policy.js";
import { isItemCollected } from "../services/item-collection.js";

import { findInventoryCardForBadgeCard, selectSurplusAssets, summarizeAssetIds } from "../parsers/inventory.js";

import {
  isPriceOverviewProbeBlocked,
  updateAllActionStates,
  updateSurplusActionState,
} from "../ui/action-state.js";

import { surplusStatus } from "../status-controllers.js";
import { enableTileDragSelection } from "../ui/checkbox-drag.js";
import {
  createRequestQueuePool,
  getHtmlRequestConcurrency,
  runWithConcurrency,
} from "../utils/concurrency.js";
import { appendInventoryTileText, createInventoryTile } from "../utils/dom.js";
import { countSelected, pruneSelection, setItemsSelected } from "../utils/selection.js";
import { processingModeIncludesCards } from "../services/processing-mode.js";
import { syncProcessingView } from "../ui/processing-view.js";

const { log: surplusLog, setStatus: setSurplusStatus, setProgress: setSurplusProgress, hideProgress: hideSurplusProgress } = surplusStatus;

  function applySurplusMarketInfo(result, price, gemSackPriceCents) {
    const priced = isPriceCardPriced(price);
    const noPrice = isPriceCardNoPrice(price);
    const failed = !priced && !noPrice;
    result.priceCents = priced ? price.lowestSellCents || 0 : 0;
    result.medianCents = priced ? price.medianCents || 0 : 0;
    result.volume = failed ? null : price?.volume ?? null;
    result.priceSource = priced ? price.priceSource : (noPrice ? "none" : "failed");
    result.priceLookupFailed = failed;
    applyItemRecommendation(result, gemSackPriceCents);
  }

  function createCardResult(group, inventoryCard, options = {}) {
    const reservedCount = Math.max(0, Number(options.reservePerCard) || 0);
    const surplusCount = Math.max(0, inventoryCard.totalCount - reservedCount);
    if (surplusCount <= 0) return null;
    const assets = selectSurplusAssets(inventoryCard.assets, surplusCount);
    const assetSummary = summarizeAssetIds(assets);
    return {
      category: "card",
      appid: group.appid,
      isFoil: group.isFoil,
      gameName: options.gameName || group.gameName || "",
      level: options.level || 0,
      targetLevel: options.targetLevel || 0,
      badgeMaxed: !!options.badgeMaxed,
      isUnlimitedLevelBadge: !!options.isUnlimitedLevelBadge,
      keepMaxLevelCards: !!options.keepMaxLevelCards,
      cardName: options.cardName || inventoryCard.name,
      marketHashName: options.marketHashName || inventoryCard.marketHashName,
      imageUrl: inventoryCard.imageUrl || "",
      nameColor: inventoryCard.nameColor || "",
      backgroundColor: inventoryCard.backgroundColor || "",
      gemValue: inventoryCard.gemValue || 0,
      totalGems: assets.reduce(
        (sum, asset) => sum + (asset.selectedAmount || 0) * (asset.gemValue || inventoryCard.gemValue || 0),
        0
      ),
      inventoryCount: inventoryCard.totalCount,
      reservedCount,
      surplusCount,
      marketableCount: assets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.selectedAmount : 0),
        0
      ),
      tradableCount: assets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.selectedAmount : 0),
        0
      ),
      assets,
      assetText: assetSummary.text,
      assetTitle: assetSummary.title,
    };
  }

  function getAllInventoryCardResults(group) {
    return [...group.cardsByHash.values()]
      .map(card => createCardResult(group, card))
      .filter(Boolean);
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

      const result = createCardResult(group, inventoryCard, {
        gameName: info.gameName,
        level,
        targetLevel,
        badgeMaxed,
        isUnlimitedLevelBadge: !!info.isUnlimitedLevelBadge,
        keepMaxLevelCards: true,
        reservePerCard,
        cardName: badgeCard.name,
        marketHashName: badgeCard.marketHashName,
      });
      if (result) results.push(result);
    }

    return results;
  }

  export function getVisibleSurplusResults() {
    if (!processingModeIncludesCards(state.cfg.surplusItemMode)) return [];
    return (state.surplusResults || []).filter(result => {
      if (!state.cfg.surplusIncludeFoil && result.isFoil) return false;
      if (isItemCollected(result, "card")) return false;
      if (state.cfg.surplusOnlyRecommended && result.recommendationKey !== "grind") return false;
      if (state.cfg.surplusOnlyTradable && result.tradableCount <= 0) return false;
      return true;
    });
  }

  export function getSurplusResultKey(result) {
    const assetKey = (result.assets || [])
      .map(asset => `${asset.assetid || ""}x${asset.selectedAmount ?? asset.amount ?? ""}`)
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
    return (state.surplusResults || []).filter(result =>
      state.selectedSurplusResults.has(getSurplusResultKey(result)) && !isItemCollected(result, "card")
    );
  }

  export function setAllVisibleSurplusSelection(selected) {
    setItemsSelected(state.selectedSurplusResults, getVisibleSurplusResults(), getSurplusResultKey, selected);
    renderSurplusResults();
  }

  function pruneSelectedSurplusResults(visible) {
    pruneSelection(state.selectedSurplusResults, visible, getSurplusResultKey);
  }

  function sortSurplusResults() {
    state.surplusResults.sort((left, right) => {
      const recommendationCompare = Number(right.recommendationKey === "grind")
        - Number(left.recommendationKey === "grind");
      if (recommendationCompare) return recommendationCompare;
      const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
      if (gameCompare) return gameCompare;
      if (left.appid !== right.appid) return Number(left.appid) - Number(right.appid);
      if (left.isFoil !== right.isFoil) return Number(left.isFoil) - Number(right.isFoil);
      return (left.cardName || "").localeCompare(right.cardName || "", "zh-CN");
    });
  }

  export function updateSurplusSummary() {
    const row = document.getElementById("stch-surplus-summary-row");
    const summary = document.getElementById("stch-surplus-summary");
    if (!row || !summary) return;

    const visible = getVisibleSurplusResults();
    if (visible.length === 0) {
      summary.textContent = "";
      syncProcessingView();
      return;
    }

    const badgeCount = new Set(visible.map(result => `${result.appid}_${result.isFoil ? 1 : 0}`)).size;
    const surplusTotal = visible.reduce((sum, result) => sum + result.surplusCount, 0);
    const marketableTotal = visible.reduce((sum, result) => sum + result.marketableCount, 0);
    const tradableTotal = visible.reduce((sum, result) => sum + result.tradableCount, 0);
    const selectedCount = countSelected(state.selectedSurplusResults, visible, getSurplusResultKey);
    summary.innerHTML =
      `共 <b>${badgeCount}</b> 个${state.cfg.surplusKeepMaxLevelCards ? "徽章" : "卡牌组"} · ` +
      `<b>${visible.length}</b> 种卡牌 · ` +
      `${state.cfg.surplusKeepMaxLevelCards ? "多余 " : ""}<b>${surplusTotal}</b> 张 · ` +
      `可出售 <b>${marketableTotal}</b> 张 · ` +
      `可交易 <b>${tradableTotal}</b> 张 · ` +
      `已选择 <b>${selectedCount}</b> 项`;
    syncProcessingView();
  }

  export function renderSurplusResults() {
    const list = document.getElementById("stch-surplus-list");
    if (!list) return;
    enableTileDragSelection(list, {
      isSelected: tile => state.selectedSurplusResults?.has(tile.dataset.key),
      setSelected: (tile, selected) => {
        if (selected) state.selectedSurplusResults.add(tile.dataset.key);
        else state.selectedSurplusResults.delete(tile.dataset.key);
      },
      onSelectionChange: () => {
        updateSurplusSummary();
        updateSurplusActionState();
      },
    });
    list.innerHTML = "";

    const visible = getVisibleSurplusResults();
    pruneSelectedSurplusResults(visible);
    if (visible.length === 0) {
      updateSurplusSummary();
      updateSurplusActionState();
      syncProcessingView();
      return;
    }

    for (const result of visible) {
      const key = getSurplusResultKey(result);
      const volumeZero = result.volume === 0;
      const title = [
        `${result.gameName || "未知游戏"} · ${result.cardName || result.marketHashName || "未知卡牌"}`,
        result.keepMaxLevelCards
          ? result.isUnlimitedLevelBadge
            ? `特卖徽章 Lv${result.level}（Lv1 后可处理多余卡牌）`
            : `徽章 Lv${result.level}/${result.targetLevel}`
          : "未预留满级卡牌",
        result.keepMaxLevelCards
          ? `库存 ${result.inventoryCount}，预留 ${result.reservedCount}，多余 ${result.surplusCount}`
          : `库存 ${result.inventoryCount}`,
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
        result.recommendationReason
          ? `建议：${result.recommendationLabel || "—"}，${result.recommendationReason}`
          : "",
        "按住并拖动可连续选择或取消",
        result.assetTitle ? `资产ID:\n${result.assetTitle}` : "",
      ].filter(Boolean).join("\n");
      const label = result.cardName || result.marketHashName;
      const tile = createInventoryTile({
        key,
        selected: state.selectedSurplusResults?.has(key),
        title,
        imageUrl: result.imageUrl,
        label,
        volumeZero,
        nameColor: result.nameColor,
        backgroundColor: result.backgroundColor,
      });
      appendInventoryTileText(tile, "span", "stch-inv-badge", `x${result.surplusCount}`, result.keepMaxLevelCards ? "多余数量" : "数量");
      appendInventoryTileText(tile, "span", `stch-inv-badge stch-inv-badge-left ${result.recommendationClass || ""}`.trim(), result.recommendationLabel || "—", result.recommendationReason || "");
      appendInventoryTileText(tile, "div", "stch-inv-name", label || "未知卡牌");

      list.appendChild(tile);
    }

    updateSurplusSummary();
    updateSurplusActionState();
    syncProcessingView();
  }

  export async function startSurplusScan() {
    if (isPriceOverviewProbeBlocked(state.surplusScanning || state.grindScanning)) return;

    if (location.hostname !== "steamcommunity.com") {
      surplusLog("请在 Steam 社区徽章页或库存页使用多余物品处理", "warn");
      return;
    }

    const profileUrl = getProfileUrl();
    const steamId = getSteamId();
    if (!steamId) {
      surplusLog("未找到 SteamID", "err");
      return;
    }
    if (state.cfg.surplusKeepMaxLevelCards && !profileUrl) {
      surplusLog("未找到 Steam 个人资料地址", "err");
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
    const queue = createRequestQueuePool(
      getHtmlRequestConcurrency(cfg),
      () => new RequestQueue(
        cfg.requestInterval,
        state,
        setSurplusStatus,
        surplusLog,
        { stopPredicate: currentState => Boolean(currentState?.surplusStopRequested) }
      )
    );
    state.surplusQueue = queue;
    const marketRecords = [];

    try {
      surplusLog("【阶段 1/3】正在读取 Steam 社区库存");
      setSurplusProgress(0, 1, "阶段1: 读取库存");
      const inventory = await loadCommunityInventoryCards(steamId, queue);
      const groups = state.cfg.surplusIncludeFoil
        ? inventory.groups
        : inventory.groups.filter(group => !group.isFoil);
      if (state.surplusStopRequested) {
        surplusLog("已停止检测", "warn");
        return;
      }

      if (groups.length === 0) {
        surplusLog("库存中没有检测到集换式卡牌", "warn");
        renderSurplusResults();
        return;
      }

      surplusLog(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，` +
        `卡牌 ${inventory.totalCards} 张，${inventory.cardTypeCount} 种，` +
        `${groups.length} 个${state.cfg.surplusKeepMaxLevelCards ? "徽章候选" : "卡牌组"}`,
        "ok"
      );
      surplusLog(state.cfg.surplusKeepMaxLevelCards
        ? "【阶段 2/3】正在读取徽章等级并计算升满后剩余"
        : "【阶段 2/3】正在整理库存卡牌");

      let scanned = 0;
      let failed = 0;
      let completed = 0;
      await runWithConcurrency(
        groups,
        getHtmlRequestConcurrency(cfg),
        async group => {
          if (state.surplusStopRequested) return;
          scanned++;
          const label = `${group.gameName || group.appid}${group.isFoil ? "（闪亮）" : ""}`;
          setSurplusProgress(
            completed,
            groups.length,
            `阶段2: ${completed + 1}/${groups.length} · ${label}`
          );
          setSurplusStatus(`${state.cfg.surplusKeepMaxLevelCards ? "读取徽章" : "整理卡牌"}: ${label}`);

          try {
            const rows = state.cfg.surplusKeepMaxLevelCards
              ? await resolveSurplusForBadge(group, profileUrl, queue)
              : getAllInventoryCardResults(group);
            if (rows.length === 0) {
              if (state.cfg.showNoResultLogs) {
                surplusLog(
                  `[${group.appid}] ${label}: ${state.cfg.surplusKeepMaxLevelCards ? "没有升满后剩余" : "没有库存卡牌"}`,
                  "info"
                );
              }
              return;
            }
            state.surplusResults.push(...rows);
            const surplusCount = rows.reduce((sum, row) => sum + row.surplusCount, 0);
            surplusLog(
              `[${group.appid}] ${label}: ${rows.length} 种卡牌，${state.cfg.surplusKeepMaxLevelCards ? "多余 " : ""}${surplusCount} 张`,
              "ok"
            );
          } catch (error) {
            if (state.surplusStopRequested) return;
            failed++;
            surplusLog(
              `[${group.appid}] ${label}: 读取失败 ${error?.message || error?.status || error}`,
              "warn"
            );
          } finally {
            completed++;
            setSurplusProgress(
              completed,
              groups.length,
              `阶段2: ${completed}/${groups.length}`
            );
            if (completed === 1 || completed % 5 === 0) renderSurplusResults();
          }
        }
      );

      sortSurplusResults();
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
        let priceCompleted = 0;
        await runWithConcurrency(
          state.surplusResults,
          getHtmlRequestConcurrency(cfg),
          async result => {
            if (state.surplusStopRequested) return;
            setSurplusProgress(
              priceCompleted,
              state.surplusResults.length,
              `阶段3: ${priceCompleted + 1}/${state.surplusResults.length} · ${result.cardName || result.marketHashName}`
            );
            setSurplusStatus(`查询市场: ${result.cardName || result.marketHashName}`);

            let price = null;
            if (result.marketHashName) {
              let pricePromise = priceCache.get(result.marketHashName);
              let created = false;
              if (!pricePromise) {
                created = true;
                pricePromise = priceCard(result.marketHashName, queue, {
                  preferListing: true,
                  requireVolume: true,
                  persistMarketCache: false,
                });
                priceCache.set(result.marketHashName, pricePromise);
              }
              price = await pricePromise;
              if (created && price?.record) marketRecords.push(price.record);
            }
            applySurplusMarketInfo(
              result,
              price,
              state.surplusGemPrice?.priceCents || 0
            );
            if (!isPriceCardPriced(price) && !isPriceCardNoPrice(price)) priceFailed++;
            if (result.volume === 0) zeroVolume++;
            priceCompleted++;
            if (priceCompleted === 1 || priceCompleted % 5 === 0) renderSurplusResults();
          }
        );

        sortSurplusResults();
        renderSurplusResults();

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
          `检测完成：${state.cfg.surplusKeepMaxLevelCards ? "读取" : "整理"} ${scanned} 个${state.cfg.surplusKeepMaxLevelCards ? "徽章" : "卡牌组"}，失败 ${failed} 个，` +
          `找到 ${state.surplusResults.length} 种${state.cfg.surplusKeepMaxLevelCards ? "多余" : ""}卡牌 / ${totalSurplus} 张`,
          failed ? "warn" : "ok"
        );
      }
    } catch (error) {
      if (!state.surplusStopRequested) {
        surplusLog(`检测中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      persistMarketObservations(marketRecords);
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
