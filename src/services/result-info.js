import { state } from "../state.js";

import { getProfileUrl } from "../utils/steam.js";

import { getGameCardsUrl, getBadgeTargetLevel } from "../utils/badge.js";

import { parseGameCardsHtml } from "../parsers/gamecards.js";

import { priceCard } from "../parsers/price.js";

import { persistMarketObservations } from "./market-observations.js";

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
    info.currencyId = state.currencyContext?.currencyId || state.cfg.currencyId || 23;
    info.cheapestSetCostCents = 0;
    info.fullSetCostCents = 0;
    info.level5CostCents = 0;

    let setCostCents = 0;
    let fullSetCostCents = 0;
    let level5CostCents = 0;
    let minVolume = Infinity;
    const setsToTarget = Math.max(0, info.targetLevel - info.level);
    const noPriceCards = [];
    const marketRecords = [];
    let failedPriceCount = 0;

    try {
      for (const card of info.cards) {
        if (!card.marketHashName) {
          throw new Error(`卡牌“${card.name}”缺少 market hash name`);
        }
        const pk = await priceCard(card.marketHashName, queue, { persistMarketCache: false });
        if (pk?.record) marketRecords.push(pk.record);
        if (!pk) {
          card.priceSource = "failed";
          card.currencyId = info.currencyId;
          failedPriceCount++;
          continue;
        }
        if (pk.noPriceData) {
          card.priceSource = "none";
          card.currencyId = pk.currencyId;
          card.marketRecord = pk.record;
          noPriceCards.push(card);
          continue;
        }

        card.lowestCents = pk.lowestSellCents;
        card.medianCents = pk.medianCents;
        card.volume = pk.volume;
        card.priceSource = pk.priceSource;
        card.currencyId = pk.currencyId;
        card.observedAt = pk.observedAt;
        card.marketRecord = pk.record;
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
      }
    } finally {
      persistMarketObservations(marketRecords);
    }

    info.noPriceDataCount = noPriceCards.length;
    info.failedPriceCount = failedPriceCount;
    info.hasIncompletePricing = noPriceCards.length + failedPriceCount > 0;
    info.cheapestSetCostCents = info.hasIncompletePricing ? null : setCostCents;
    info.fullSetCostCents = info.hasIncompletePricing ? null : fullSetCostCents;
    info.level5CostCents = info.hasIncompletePricing ? null : level5CostCents;
    info.minVolume = minVolume === Infinity ? 0 : minVolume;
    return info;
  }
