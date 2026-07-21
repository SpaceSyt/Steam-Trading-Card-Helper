"use strict";
import css from "./ui/style.css";
import { $J } from "./globals.js";
import { state } from "./state.js";
import { initializeCurrencyContext } from "./services/currency.js";
import { loadOrderCache, pruneOrderCache } from "./services/order-cache.js";
import { observeEntryBtn } from "./ui/entry.js";
import { injectSidebar } from "./sidebar/sidebar.js";
import { initMultibuyAutoFill } from "./features/multibuy.js";

GM_addStyle(css);

state.currencyContext = initializeCurrencyContext({
  configuredCurrencyId: state.cfg.currencyId,
});
state.orderResults = loadOrderCache();
pruneOrderCache(true);

const pageUrl = window.location.href;
const initWhenReady = callback => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
};

if (pageUrl.includes("/market/multibuy")) {
  initWhenReady(() => {
    if (!$J) {
      console.warn("[STCH] jQuery not found");
      return;
    }
    initMultibuyAutoFill();
  });
} else {
  initWhenReady(() => {
    observeEntryBtn();
    if (!state.cfg.sidebarDisabled) injectSidebar();
  });
}
