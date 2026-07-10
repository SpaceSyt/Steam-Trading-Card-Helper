import { state } from "../state.js";

import { getProfileUrl } from "../utils/steam.js";

import { getGameCardsUrl, getBadgeTargetLevel } from "../utils/badge.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { priceCard, estimateMissingLevel5Cost } from "../parsers/price.js";

import { formatCNY } from "../utils/format.js";

  export function getResultKey(info) {
    return `${info.appid}_${info.isFoil ? 1 : 0}`;
  }

  export function getSelectedResults() {
    return state.results.filter(info => state.selectedResults.has(getResultKey(info)));
  }

  export function getSelectedOrderResults() {
    return state.orderResults.filter(info => state.selectedOrderResults.has(getResultKey(info)));
  }

  export async function refreshResultInfo(existing, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("未找到 Profile URL");

    const res = await queue.fetch(
      getGameCardsUrl(profileUrl, existing.appid, existing, { language: "english" })
    );
    if (!res?.text?.includes("badge_card_set_card")) {
      throw new Error("未找到卡牌套组");
    }

    const info = parseGameCardsHtml(res.text, existing.appid, existing.isFoil);
    info.appid = existing.appid;
    info.isFoil = existing.isFoil;
    info.targetLevel = getBadgeTargetLevel(info);
    info.gameName = existing.gameName || info.gameName || "";
    info.cardPrices = [];
    info.cheapestSetCostCents = 0;
    info.fullSetCostCents = 0;
    info.level5CostCents = 0;

    let setCostCents = 0;
    let fullSetCostCents = 0;
    let level5CostCents = 0;
    let minVolume = Infinity;
    const setsToTarget = Math.max(0, info.targetLevel - info.level);
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
      const need5 = Math.max(0, setsToTarget - card.owned);
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
      const formulaEstimate = estimateMissingLevel5Cost(noPriceCards, info.cardPrices, setsToTarget);
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
