import { formatMinorAmount, getCurrencyContextById } from "../services/currency.js";

// Retained for a future consumer of preformatted order-cache fields.
export function formatCNY(cents) {
  return formatMinorAmount(cents, 23, { useGrouping: false });
}

export function applyOrderCacheFormatting(copy) {
  const currencyContext = getCurrencyContextById(copy.currencyId);
  copy.cheapestSetFormatted = copy.hasIncompletePricing
    ? "-" : formatMinorAmount(copy.cheapestSetCostCents, currencyContext);
  copy.fullSetFormatted = copy.hasIncompletePricing
    ? "-" : formatMinorAmount(copy.fullSetCostCents, currencyContext);
  copy.level5Formatted = copy.hasIncompletePricing
    ? "-" : formatMinorAmount(copy.level5CostCents, currencyContext);
  copy.cheapestSetCNY = copy.hasIncompletePricing
    ? "-" : copy.cheapestSetCNY || formatCNY(copy.cheapestSetCostCents);
  copy.fullSetCNY = copy.hasIncompletePricing
    ? "-" : copy.fullSetCNY || formatCNY(copy.fullSetCostCents);
  copy.level5CNY = copy.hasIncompletePricing
    ? "-" : copy.level5CNY || formatCNY(copy.level5CostCents);
  return copy;
}
