import { getActiveCurrencyContext, resolveCurrencyContext } from "../services/currency.js";
import { decodeHtmlEntities } from "./format.js";

const unsafeWindow = typeof globalThis !== "undefined"
  ? (globalThis.unsafeWindow || globalThis.window || globalThis)
  : {};

  export function getProfileUrl() {
    const url = unsafeWindow.g_strProfileURL
      || document.querySelector("#global_actions a.user_avatar")?.href
      || document.querySelector(".user_avatar[href*='/id/'], .user_avatar[href*='/profiles/']")?.href
      || null;
    return url ? url.replace(/\/$/, "") : null;
  }

  export function getSteamId() {
    const direct = String(unsafeWindow.g_steamID || "").trim();
    if (/^\d{17}$/.test(direct)) return direct;

    const config = document.getElementById("application_config");
    const userInfoRaw = config?.getAttribute("data-userinfo") || "";
    if (userInfoRaw) {
      try {
        const userInfo = JSON.parse(decodeHtmlEntities(userInfoRaw));
        if (/^\d{17}$/.test(String(userInfo?.steamid || ""))) {
          return String(userInfo.steamid);
        }
      } catch (_) {}
    }

    const profileUrl = getProfileUrl() || "";
    const profileMatch = profileUrl.match(/\/profiles\/(\d{17})(?:\/|$)/);
    if (profileMatch) return profileMatch[1];

    const htmlMatch = document.documentElement.innerHTML.match(/g_steamID\s*=\s*["'](\d{17})["']/);
    return htmlMatch ? htmlMatch[1] : "";
  }

  export function isInventoryPage() {
    return location.hostname === "steamcommunity.com"
      && /\/inventory\/?$/i.test(location.pathname);
  }

  export function parseSteamIdFromText(text) {
    const direct = String(text || "").match(/(?:g_steamID\s*=\s*["']|"steamid"\s*:\s*")(\d{17})/);
    if (direct) return direct[1];
    return "";
  }

  export function parseSteamIdFromProfileUrl(profileUrl) {
    const match = String(profileUrl || "").match(/\/profiles\/(\d{17})(?:\/|$)/);
    return match ? match[1] : "";
  }

  export function getMarketMinimumPriceMinor(currencyContextOrWalletInfo) {
    const suppliedWalletInfo = currencyContextOrWalletInfo?.walletInfo
      || (
        currencyContextOrWalletInfo
        && typeof currencyContextOrWalletInfo === "object"
        && Object.hasOwn(currencyContextOrWalletInfo, "wallet_market_minimum")
          ? currencyContextOrWalletInfo
          : null
      );
    const walletInfo = suppliedWalletInfo
      || (currencyContextOrWalletInfo == null ? unsafeWindow.g_rgWalletInfo : null);
    const walletMinimum = Number(walletInfo?.wallet_market_minimum);
    if (Number.isFinite(walletMinimum) && walletMinimum > 0) {
      return Math.floor(walletMinimum) * 3;
    }

    const activeContext = currencyContextOrWalletInfo == null
      ? getActiveCurrencyContext()
      : currencyContextOrWalletInfo;
    if (activeContext || walletInfo) {
      const context = resolveCurrencyContext(activeContext || walletInfo);
      const minimum = Number(
        context.minimumBuyerMinor
        ?? context.marketMinimumBuyerMinor
        ?? (Number(context.marketMinimumMinor) * 3),
      );
      if (Number.isFinite(minimum) && minimum > 0) return Math.floor(minimum);
    }

    // Preserve the historical no-argument CNY behavior until initialization.
    return 21;
  }

  export function getMarketMinimumPriceCents(currencyContextOrWalletInfo) {
    return getMarketMinimumPriceMinor(currencyContextOrWalletInfo);
  }

  export function getSessionId() {
    if (unsafeWindow.g_sessionID) return unsafeWindow.g_sessionID;
    const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }
