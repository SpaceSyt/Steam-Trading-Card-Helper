import { MARKET_STEAM_FEE_RATE, MARKET_PUBLISHER_FEE_RATE, GEM_SACK_SIZE } from "../constants.js";
import { getActiveCurrencyContext, resolveCurrencyContext } from "../services/currency.js";

function firstFinite(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function normalizeRate(value, fallback) {
  const number = firstFinite(value);
  if (number == null || number < 0) return fallback;
  return number > 1 ? number / 100 : number;
}

function normalizeMinimum(value, fallback) {
  const number = firstFinite(value);
  return number != null && number >= 0 ? Math.floor(number) : fallback;
}

function resolveFeeConfig(currencyContextOrWalletInfo) {
  const activeOrSupplied = currencyContextOrWalletInfo ?? getActiveCurrencyContext();
  if (!activeOrSupplied) {
    return {
      steamFeeRate: MARKET_STEAM_FEE_RATE,
      publisherFeeRate: MARKET_PUBLISHER_FEE_RATE,
      steamFeeMinimumMinor: 1,
      publisherFeeMinimumMinor: 1,
      steamFeeBaseMinor: 0,
    };
  }

  const context = resolveCurrencyContext(activeOrSupplied);
  const walletInfo = activeOrSupplied?.walletInfo
    || (Object.hasOwn(activeOrSupplied, "wallet_currency") ? activeOrSupplied : {});
  return {
    steamFeeRate: normalizeRate(firstFinite(
      activeOrSupplied.steamFeeRate,
      walletInfo.wallet_fee_percent,
      context.steamFeeRate,
    ), MARKET_STEAM_FEE_RATE),
    publisherFeeRate: normalizeRate(firstFinite(
      activeOrSupplied.publisherFeeRate,
      walletInfo.wallet_publisher_fee_percent_default,
      context.publisherFeeRate,
    ), MARKET_PUBLISHER_FEE_RATE),
    steamFeeMinimumMinor: normalizeMinimum(firstFinite(
      activeOrSupplied.steamFeeMinimumMinor,
      walletInfo.wallet_fee_minimum,
      walletInfo.wallet_market_minimum,
      context.steamFeeMinimumMinor,
    ), 1),
    publisherFeeMinimumMinor: normalizeMinimum(firstFinite(
      activeOrSupplied.publisherFeeMinimumMinor,
      walletInfo.wallet_publisher_fee_minimum,
      walletInfo.wallet_fee_minimum,
      walletInfo.wallet_market_minimum,
      context.publisherFeeMinimumMinor,
    ), 1),
    steamFeeBaseMinor: normalizeMinimum(firstFinite(
      activeOrSupplied.steamFeeBaseMinor,
      walletInfo.wallet_fee_base,
      context.steamFeeBaseMinor,
    ), 0),
  };
}

function getMarketFeesWithConfig(received, config) {
  const steamFee = Math.floor(Math.max(
    received * config.steamFeeRate,
    config.steamFeeMinimumMinor,
  ) + config.steamFeeBaseMinor);
  const publisherFee = Math.floor(Math.max(
    received * config.publisherFeeRate,
    config.publisherFeeMinimumMinor,
  ));
  return {
    steamFee,
    publisherFee,
    totalFees: steamFee + publisherFee,
    buyerCents: received + steamFee + publisherFee,
  };
}

function getBuyerPriceWithConfig(sellerCents, config) {
  const received = Math.max(0, Math.floor(Number(sellerCents) || 0));
  return received > 0
    ? getMarketFeesWithConfig(received, config).buyerCents
    : 0;
}

export function getMarketFeesForSellerReceive(sellerCents, currencyContextOrWalletInfo) {
  const received = Math.max(0, Math.floor(Number(sellerCents) || 0));
  if (received <= 0) {
    return { steamFee: 0, publisherFee: 0, totalFees: 0, buyerCents: 0 };
  }
  return getMarketFeesWithConfig(received, resolveFeeConfig(currencyContextOrWalletInfo));
}

export function getBuyerPriceForSellerReceive(sellerCents, currencyContextOrWalletInfo) {
  return getMarketFeesForSellerReceive(sellerCents, currencyContextOrWalletInfo).buyerCents;
}

export function getSellerReceiveForBuyerPrice(buyerCents, currencyContextOrWalletInfo) {
  const total = Math.max(0, Math.floor(Number(buyerCents) || 0));
  if (total <= 0) return 0;
  const config = resolveFeeConfig(currencyContextOrWalletInfo);
  let low = 0;
  let high = total;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (getBuyerPriceWithConfig(mid, config) <= total) {
      best = mid;
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
  return sackNet > 0 ? (sackNet * Math.max(0, Number(gems) || 0)) / GEM_SACK_SIZE : 0;
}

export function getGemBreakEvenBuyerPrice(gems, gemSackPriceCents, currencyContextOrWalletInfo) {
  const desiredSellerNet = Math.ceil(
    getGemValueSellerNetCents(gems, gemSackPriceCents, currencyContextOrWalletInfo),
  );
  return desiredSellerNet > 0
    ? getBuyerPriceForSellerReceive(desiredSellerNet, currencyContextOrWalletInfo)
    : 0;
}

// Generic minor-unit aliases. The legacy *Cents names remain valid for CNY/USD.
export const getMarketFeesForSellerReceiveMinor = getMarketFeesForSellerReceive;
export const getBuyerPriceForSellerReceiveMinor = getBuyerPriceForSellerReceive;
export const getSellerReceiveForBuyerPriceMinor = getSellerReceiveForBuyerPrice;
