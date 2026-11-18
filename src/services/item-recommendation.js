import { formatMoney } from "../utils/format.js";
import { invalidateInventoryTile } from "../utils/dom.js";
import {
  getGemBreakEvenBuyerPrice,
  getGemValueSellerNetCents,
  getSellerReceiveForBuyerPrice,
} from "../utils/market-fees.js";

export function applyItemRecommendation(item, gemSackPriceCents) {
  invalidateInventoryTile(item);
  item.gemSackPriceCents = gemSackPriceCents || 0;
  item.gemValueNetCents = getGemValueSellerNetCents(item.totalGems, gemSackPriceCents);
  item.unitGemValueNetCents = getGemValueSellerNetCents(item.gemValue, gemSackPriceCents);
  item.unitGemValueText = formatMoney(item.unitGemValueNetCents, { fractionalMinor: true });
  item.breakEvenPriceCents = getGemBreakEvenBuyerPrice(item.gemValue, gemSackPriceCents);
  item.marketNetCents = item.priceCents ? getSellerReceiveForBuyerPrice(item.priceCents) : 0;

  if (!gemSackPriceCents) {
    item.recommendationKey = "unknown";
    item.recommendationLabel = "缺宝石价";
    item.recommendationClass = "warn";
    item.recommendationReason = "宝石袋价格不可用";
  } else if (!item.gemValue) {
    item.recommendationKey = "unknown";
    item.recommendationLabel = "缺宝石数";
    item.recommendationClass = "warn";
    item.recommendationReason = "物品分解所得宝石数未知";
  } else if (!item.marketHashName || item.marketableCount <= 0) {
    item.recommendationKey = "grind";
    item.recommendationLabel = "分解";
    item.recommendationClass = "ok";
    item.recommendationReason = "不可出售或缺少市场标识";
  } else if (item.priceLookupFailed) {
    item.recommendationKey = "unknown";
    item.recommendationLabel = "缺市场价";
    item.recommendationClass = "warn";
    item.recommendationReason = "市场价格请求失败";
  } else if (!item.priceCents) {
    item.recommendationKey = "grind";
    item.recommendationLabel = "分解";
    item.recommendationClass = "ok";
    item.recommendationReason = "市场暂无可用价格";
  } else if (item.marketNetCents <= item.unitGemValueNetCents) {
    item.recommendationKey = "grind";
    item.recommendationLabel = "分解";
    item.recommendationClass = "ok";
    item.recommendationReason =
      `卖出税后约 ${formatMoney(item.marketNetCents)}，不高于分解宝石税后约 ${item.unitGemValueText}`;
  } else {
    item.recommendationKey = "sell";
    item.recommendationLabel = "出售";
    item.recommendationClass = "info";
    item.recommendationReason =
      `卖出税后约 ${formatMoney(item.marketNetCents)}，高于分解宝石税后约 ${item.unitGemValueText}`;
  }
  return item;
}
