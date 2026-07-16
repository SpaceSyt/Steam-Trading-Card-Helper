import { state } from "../state.js";

import { DEFAULT_CONFIG } from "../config.js";

import { EARLY_PREDICTION_MARGIN } from "../constants.js";

import { getProfileUrl } from "../utils/steam.js";

import { RequestQueue } from "../request/queue.js";

import { scanBadgePages } from "../services/badge-pages.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { priceCard, predictFullSetLowerBound, estimateMissingLevel5Cost } from "../parsers/price.js";

import { formatMoney } from "../utils/format.js";

import { getBadgeModeLabel, getGameCardsUrl, getBadgeTargetLevel } from "../utils/badge.js";

import { getCachedOrderResult, getOrderCacheAgeDays } from "../services/order-cache.js";

import { persistMarketObservations } from "../services/market-observations.js";

import { addToBlacklist } from "./blacklist.js";

import { renderGameRow, setSummary, setSummaryVisibility, updateSummary } from "../ui/render.js";

import { updateAllActionStates, updateSurplusActionState, updateGrindActionState, isSharedActionBusy } from "../ui/action-state.js";

import { scanStatus } from "../status-controllers.js";

const { log, setStatus, setProgress, hideProgress } = scanStatus;

  export function skipCurrentBadge() {
    state.skipCurrent = true;
    log("跳过当前徽章...", "warn");
  }

  export function setScanPhase(phase) {
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

  export function updateResultColumns() {
    const showDrops = state.cfg.includeDrops
      && state.results.some(info => Number(info.dropsRemaining) > 0);
    document.getElementById("stch-list")?.classList.toggle("stch-show-drops", showDrops);
  }

  export function applyScanModeTheme() {
    const enabled = !!state.cfg.foilScanMode;
    document.getElementById("stch-tab-scan")?.classList.toggle("stch-foil-mode", enabled);
    const foilLabel = document.getElementById("stch-foil-mode-label");
    const foilInput = document.getElementById("stch-foil-scan-mode");
    const buyMode = document.getElementById("stch-buy-mode");
    const buyModeLabel = document.getElementById("stch-buy-mode-label");
    foilLabel?.classList.toggle("active", enabled);
    foilLabel?.classList.toggle("disabled", state.scanning);
    if (foilInput) foilInput.disabled = !!state.scanning;
    if (buyMode) {
      if (enabled) {
        if (!buyMode.dataset.normalValue && buyMode.value !== "complete1") {
          buyMode.dataset.normalValue = buyMode.value;
        }
        buyMode.value = "complete1";
        buyMode.disabled = true;
      } else {
        buyMode.disabled = false;
        buyMode.value = buyMode.dataset.normalValue || state.cfg.buyMode || DEFAULT_CONFIG.buyMode;
        delete buyMode.dataset.normalValue;
      }
    }
    buyModeLabel?.classList.toggle("stch-control-disabled", enabled);
  }

  export async function startScan() {
    if (isSharedActionBusy()) return;
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
    updateAllActionStates();
    applyScanModeTheme();
    setScanPhase("scanning");
    setStatus("正在扫描徽章页");

    const cfg = {
      ...state.cfg,
      foilScanMode: !!state.cfg.foilScanMode,
      buyMode: state.cfg.foilScanMode ? "complete1" : state.cfg.buyMode
    };
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setStatus,
      log
    );


    state.queue = queue;
    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      log("未找到 Profile URL", "err");
      queue.stop();
      state.scanning = false;
      state.queue = null;
      hideProgress();
      setStatus(null);
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      updateSurplusActionState();
      updateGrindActionState();
      applyScanModeTheme();
      return;
    }

    const marketRecords = [];
    try {
      const scanModeLabel = getBadgeModeLabel(cfg.foilScanMode);
      log(`【阶段 1/3】正在扫描徽章页 (${scanModeLabel}模式，找候选游戏)...`);
      setProgress(0, 1, "阶段1: 扫描徽章页列表中...");
      setScanPhase("phase1");
      const badges = await scanBadgePages(cfg, msg => log(msg, "info"), queue);

      if (badges.length === 0) {
        log(`未找到任何${scanModeLabel}候选徽章`, "warn");
        setStatus(null);
        setScanPhase("done");
        return;
      }

      log(`找到 ${badges.length} 个${scanModeLabel}候选徽章，开始逐个获取卡牌详情`);
      log("【阶段 2/3】逐个获取卡牌页 + 查价中...");
      setProgress(0, badges.length, `阶段2: 获取卡牌详情 0/${badges.length}`);
      setScanPhase("phase2");
      setStatus("扫描卡牌价格中");

      let processed = 0;
      let skipped = 0;
      const getThresholdCents = () => Math.round((Number(state.cfg.threshold) || 0) * 100);
      let blacklistSource = null;
      let blacklistedAppids = new Set();
      const getBlacklistedAppids = () => {
        const source = cfg.blacklist || "";
        if (source !== blacklistSource) {
          blacklistSource = source;
          blacklistedAppids = new Set(
            source.split(",").map(value => value.trim()).filter(Boolean)
          );
        }
        return blacklistedAppids;
      };

      for (const b of badges) {
        if (state.stopRequested) { log("已手动停止", "warn"); break; }
        if (state.skipCurrent) {
          state.skipCurrent = false;
          log(`[${b.appid}] 跳过 (手动)`, "warn");
          skipped++;
          continue;
        }
        // blacklist check
        if (getBlacklistedAppids().has(String(b.appid))) {
          log(`[${b.appid}] ${b.gameName || ""}: 在游戏/AppID黑名单中, 跳过`, "info");
          skipped++;
          continue;
        }
        if (cfg.skipCachedOrderResults) {
          const cached = getCachedOrderResult(b);
          if (cached) {
            log(
              `[${b.appid}] ${b.gameName || cached.gameName || ""}: 订购缓存内已有结果 ` +
              `(${getOrderCacheAgeDays(cached.cachedAt)} 天)，跳过扫描`,
              "info"
            );
            skipped++;
            continue;
          }
        }
        processed++;
        setProgress(processed, badges.length,
          `阶段2: 获取卡牌详情 ${processed}/${badges.length} · ${b.gameName || b.appid}`);

        try {
          const url = getGameCardsUrl(profileUrl, b.appid, b, { language: "english" });
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
          info.targetLevel = getBadgeTargetLevel(info);
          info.gameName = b.gameName || info.gameName || "";
          info.cardPrices = [];
          info.currencyId = state.currencyContext?.currencyId || state.cfg.currencyId || 23;
          info.cheapestSetCostCents = 0;
          info.fullSetCostCents = 0;
          info.level5CostCents = 0;

          if (info.totalInSet === 0 || info.need === 0) {
            log(`[${b.appid}] ${info.gameName}: Lv${info.level}, 套卡完整或无卡牌`, "info");
            skipped++;
            continue;
          }

          if (!state.cfg.includeDrops && info.dropsRemaining > 0) {
            log(`[${b.appid}] ${info.gameName}: 还有 ${info.dropsRemaining} 张掉落，跳过 (可勾选“包含掉落”来扫描)`, "info");
            skipped++;
            continue;
          }

          if (info.level >= info.targetLevel) {
            log(`[${b.appid}] ${info.gameName}: 已满级 Lv${info.level}/${info.targetLevel}`, "info");
            skipped++;
            continue;
          }

          log(`[${b.appid}] ${info.gameName} ${scanModeLabel} Lv${info.level}/${info.targetLevel} 缺 ${info.need}/${info.totalInSet} 张, 正在查价...`);

          // Phase 3: price each card type
          let setCostCents = 0;
          let fullSetCostCents = 0;
          let level5CostCents = 0;
          let minVolume = Infinity;
          const setsToTarget = Math.max(0, info.targetLevel - info.level);
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

            const pk = await priceCard(card.marketHashName, queue, { persistMarketCache: false });
            if (pk?.record) marketRecords.push(pk.record);
            if (!pk) {
              log(`  ⚠ 卡牌 "${card.name}" (market: ${card.marketHashName}) 查价失败, 跳过此卡`, "warn");
              failedPriceCount++;
              info.hasEstimated = true;
              continue;
            }
            if (pk.noPriceData) {
              log(`  ⚠ 卡牌 "${card.name}" Steam 仅返回 success，无可用价格`, "warn");
              card.priceSource = "none";
              card.currencyId = pk.currencyId;
              card.marketRecord = pk.record;
              noPriceCards.push(card);
              info.hasEstimated = true;
              continue;
            }

            card.lowestCents = pk.lowestSellCents;
            card.medianCents = pk.medianCents;
            card.volume = pk.volume;
            card.priceSource = pk.priceSource;
            card.currencyId = pk.currencyId;
            card.observedAt = pk.observedAt;
            card.marketRecord = pk.record;
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
              currencyId: pk.currencyId,
              observedAt: pk.observedAt,
            });

            const need1 = Math.max(0, 1 - card.owned);
            const need5 = Math.max(0, setsToTarget - card.owned);
            setCostCents += pk.lowestSellCents * need1;
            fullSetCostCents += pk.lowestSellCents;
            level5CostCents += need5 > 0
              ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents)
              : 0;

            if (fullSetCostCents > getThresholdCents()) {
              log(`  → 已查${info.cardPrices.length}/${info.totalInSet}张, 全套 ${formatMoney(fullSetCostCents)} > ${formatMoney(getThresholdCents())}，跳过`, "info");
              allPriced = false;
              thresholdSkip = true;
              break;
            }

            if (state.cfg.earlyPricePrediction) {
              const prediction = predictFullSetLowerBound(
                info.cardPrices,
                info.totalInSet,
                fullSetCostCents
              );
              const predictionLimit = Math.ceil(getThresholdCents() * EARLY_PREDICTION_MARGIN);
              if (prediction && prediction.predictedCents > predictionLimit) {
                const predictionAutoBlacklistCents = Math.round(
                  (state.cfg.autoBlackThreshold || 0) * 100
                );
                const shouldAutoBlacklistPrediction =
                  state.cfg.earlyPredictionAutoBlacklist
                  && state.cfg.autoBlackEnabled
                  && predictionAutoBlacklistCents > 0
                  && prediction.predictedCents > predictionAutoBlacklistCents;
                log(
                  `  → 已查${prediction.sampleCount}/${info.totalInSet}张, ` +
                  `保守预测全套≥${formatMoney(prediction.predictedCents)} > ` +
                  `安全线${formatMoney(predictionLimit)}，提前跳过 ` +
                  `(样本${formatMoney(prediction.minPrice)}-${formatMoney(prediction.maxPrice)})`,
                  "info"
                );
                if (shouldAutoBlacklistPrediction) {
                  addToBlacklist(b.appid, info.gameName || b.gameName || "", 1);
                  blacklistedAppids.add(String(b.appid));
                  log(
                    `  → 价格预测自动加入游戏黑名单: ` +
                    `预测全套≥${formatMoney(prediction.predictedCents)} > ` +
                    formatMoney(predictionAutoBlacklistCents),
                    "info"
                  );
                }
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
            if (!thresholdSkip) {
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
              setsToTarget
            );
            if (formulaEstimate) {
              level5CostCents += formulaEstimate.estimatedCostCents;
              info.hasEstimated = true;
              info.hasFormulaEstimate = true;
              info.formulaEstimatedCards = noPriceCards.length;
              info.formulaEstimateUnitCents = formulaEstimate.estimatedUnitCents;
              log(
                `  → ${noPriceCards.length}/${info.totalInSet}张无价格，` +
                `按已知卡牌几何均价 ${formatMoney(formulaEstimate.estimatedUnitCents)} ` +
                `补充满级估算 ${formatMoney(formulaEstimate.estimatedCostCents)}`,
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
          const autoBlCents = Math.round((state.cfg.autoBlackThreshold || 0) * 100);
          if (state.cfg.autoBlackEnabled && autoBlCents > 0 && fullSetCostCents > autoBlCents) {
            addToBlacklist(b.appid, info.gameName || b.gameName || "", 1);
            blacklistedAppids.add(String(b.appid));
            log(`  → 自动加入游戏黑名单: 全套 ${formatMoney(fullSetCostCents)} > ${formatMoney(autoBlCents)}`, "info");
            skipped++;
            continue;
          }

          if (fullSetCostCents > getThresholdCents()) {
            log(`  → 整套卡牌价格已大于上限(${formatMoney(fullSetCostCents)} > ${formatMoney(getThresholdCents())})，跳过`, "info");
            skipped++;
            continue;
          }

          state.results.push(info);
          renderGameRow(info);
          log(
            `  ✓ [${b.appid}] ${info.gameName}: ` +
            `补全 ${formatMoney(setCostCents)} | ` +
            `全套 ${formatMoney(fullSetCostCents)} | ` +
            `满级 ${formatMoney(level5CostCents)}`,
            "ok"
          );

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
      queue.stop();
      persistMarketObservations(marketRecords);
      if (_stopTimeout) {
        clearTimeout(_stopTimeout);
        _stopTimeout = null;
      }
      state.scanning = false;
      state.stopRequested = false;
      state.skipCurrent = false;
      state.queue = null;
      hideProgress();
      setStatus(null);
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      updateAllActionStates();
      applyScanModeTheme();
    }
  }

  let _stopTimeout = null;

  export function requestStop() {
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
          applyScanModeTheme();
          setScanPhase("done");
        }
      }, 5000);
    }
  }
