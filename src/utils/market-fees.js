import { MARKET_STEAM_FEE_RATE, MARKET_PUBLISHER_FEE_RATE, GEM_SACK_SIZE } from "../constants.js";

  export function getMarketFeesForSellerReceive(sellerCents) {
    const received = Math.max(0, Math.floor(Number(sellerCents) || 0));
    if (received <= 0) {
      return { steamFee: 0, publisherFee: 0, totalFees: 0, buyerCents: 0 };
    }
    const steamFee = Math.max(1, Math.floor(received * MARKET_STEAM_FEE_RATE));
    const publisherFee = Math.max(1, Math.floor(received * MARKET_PUBLISHER_FEE_RATE));
    return {
      steamFee,
      publisherFee,
      totalFees: steamFee + publisherFee,
      buyerCents: received + steamFee + publisherFee,
    };
  }

  export function getBuyerPriceForSellerReceive(sellerCents) {
    return getMarketFeesForSellerReceive(sellerCents).buyerCents;
  }

  export function getSellerReceiveForBuyerPrice(buyerCents) {
    const total = Math.max(0, Math.floor(Number(buyerCents) || 0));
    let low = 0;
    let high = total;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (getBuyerPriceForSellerReceive(mid) <= total) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }

  export function getGemSackSellerNetCents(priceCents) {
    return getSellerReceiveForBuyerPrice(priceCents);
  }

  export function getGemValueSellerNetCents(gems, gemSackPriceCents) {
    const sackNet = getGemSackSellerNetCents(gemSackPriceCents);
    return sackNet > 0 ? (sackNet * Math.max(0, Number(gems) || 0)) / GEM_SACK_SIZE : 0;
  }

  export function getGemBreakEvenBuyerPrice(gems, gemSackPriceCents) {
    const desiredSellerNet = Math.ceil(getGemValueSellerNetCents(gems, gemSackPriceCents));
    return desiredSellerNet > 0 ? getBuyerPriceForSellerReceive(desiredSellerNet) : 0;
  }
