import { GEM_SACK_SIZE } from "../constants.js";
import { resolveCurrencyContext, roundMarketAmount } from "../services/currency.js";

function feeForRate(amount, rate, context) {
  if (!context.feesEnabled || rate <= 0) return 0;
  return roundMarketAmount(Math.floor(amount * rate), context);
}

export function getMarketFeesForSellerReceive(sellerCents, currencyContextOrWalletInfo) {
  const received = Math.max(0, Math.floor(Number(sellerCents) || 0));
  if (!received) return { steamFee: 0, publisherFee: 0, totalFees: 0, buyerCents: 0 };
  const context = resolveCurrencyContext(currencyContextOrWalletInfo);
  const base = roundMarketAmount(received, context);
  if (base == null) return { steamFee: null, publisherFee: null, totalFees: null, buyerCents: null };
  const steamFee = feeForRate(received, context.steamFeeRate, context);
  const publisherFee = feeForRate(received, context.publisherFeeRate, context);
  return { steamFee, publisherFee, totalFees: steamFee + publisherFee, buyerCents: base + steamFee + publisherFee };
}

export function getBuyerPriceForSellerReceive(sellerCents, currencyContextOrWalletInfo) {
  return getMarketFeesForSellerReceive(sellerCents, currencyContextOrWalletInfo).buyerCents;
}

export function getSellerReceiveForBuyerPrice(buyerCents, currencyContextOrWalletInfo) {
  const total = Math.max(0, Math.floor(Number(buyerCents) || 0));
  if (total <= 0) return 0;
  const context = resolveCurrencyContext(currencyContextOrWalletInfo);
  const floor = context.marketMinimumMinor;
  if (!context.verified || !floor) return null;
  if (getBuyerPriceForSellerReceive(floor, context) > total) return 0;
  // Search permitted seller amounts so the preview never exceeds the buyer's price.
  let low = Math.ceil(floor / context.incrementMinor);
  let high = Math.floor(total / context.incrementMinor);
  let best = floor;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const seller = mid * context.incrementMinor;
    if (getBuyerPriceForSellerReceive(seller, context) <= total) {
      best = seller;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

export function getGemSackSellerNetCents(priceCents, currencyContextOrWalletInfo) {
  return getSellerReceiveForBuyerPrice(priceCents, currencyContextOrWalletInfo);
}

export function getGemValueSellerNetCents(gems, gemSackPriceCents, currencyContextOrWalletInfo) {
  const sackNet = getGemSackSellerNetCents(gemSackPriceCents, currencyContextOrWalletInfo);
  if (sackNet == null) return null;
  return sackNet > 0 ? (sackNet * Math.max(0, Number(gems) || 0)) / GEM_SACK_SIZE : 0;
}

export function getGemBreakEvenBuyerPrice(gems, gemSackPriceCents, currencyContextOrWalletInfo) {
  const gemValue = getGemValueSellerNetCents(gems, gemSackPriceCents, currencyContextOrWalletInfo);
  if (gemValue == null) return null;
  const desiredSellerNet = Math.ceil(gemValue);
  return desiredSellerNet > 0
    ? getBuyerPriceForSellerReceive(desiredSellerNet, currencyContextOrWalletInfo)
    : 0;
}
