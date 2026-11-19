import { state } from "../state.js";
import { createCurrencyContext, detectCurrencyContext, getActiveCurrencyContext, getCurrencyContextById, setActiveCurrencyContext } from "./currency.js";
import { getSteamId } from "../utils/steam.js";

let pending;

async function readMarketWallet(queue, account) {
  const { text } = await queue.fetch("https://steamcommunity.com/market/", { cache: "no-store" });
  let owner, embedded;
  for (const [, script] of (text || "").matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    owner ??= script.match(/(?:^|;)\s*(?:(?:var|let|const)\s+|window\.)?g_steamID\s*=\s*['"](\d{17})['"]/m)?.[1];
    embedded ??= script.match(/(?:^|;)\s*(?:(?:var|let|const)\s+|window\.)?g_rgWalletInfo\s*=\s*(\{[^{}]*\})\s*;/m)?.[1];
    if (owner && embedded) break;
  }
  if (owner !== account || getSteamId() !== account) throw new Error("无法确认 Steam 钱包币种");
  const config = text.match(/<div\b[^>]*\bid=["']application_config["'][^>]*>/i)?.[0];
  const attribute = config?.match(/\bdata-walletinfo=(["'])(.*?)\1/i)?.[2];
  const rules = detectCurrencyContext({ walletInfo: embedded, applicationConfigWalletInfo: attribute, document: {}, pageHtml: "", pageText: "" });
  if (!rules.verified || !["walletInfo", "application_config"].includes(rules.source)) throw new Error("无法确认 Steam 钱包币种");
  return rules;
}

async function sharedMarketWallet(queue, account) {
  if (!pending || pending.account !== account) {
    const promise = readMarketWallet(queue, account).finally(() => {
      if (pending?.promise === promise) pending = null;
    });
    pending = { queue, account, promise };
  }
  const read = pending;
  try {
    const rules = await read.promise;
    if (queue.stopped || getSteamId() !== account) throw new Error("无法确认 Steam 钱包币种");
    return rules;
  } catch (error) {
    // Other consumers can finish an authenticated read when its owning queue is cancelled.
    if (error?.error !== "stopped" || read.queue === queue || queue.stopped || getSteamId() !== account) throw error;
    return sharedMarketWallet(queue, account);
  }
}

export async function getWalletForPricing(queue, requireRules = false) {
  const previous = getActiveCurrencyContext();
  const current = previous || getCurrencyContextById(state.cfg.currencyId);
  const page = globalThis.unsafeWindow || globalThis.window;
  const wallet = page?.g_rgWalletInfo;
  if ((!current.verified && (current.currencyId || previous?.source === "walletInfo" || previous?.source === "application_config"))
    || (wallet?.wallet_currency != null && current.currencyId && Number(wallet.wallet_currency) !== current.currencyId)) {
    throw new Error("无法确认 Steam 钱包币种");
  }
  if (current.verified && (!requireRules || current.minimumBuyerMinor > 0)) return current;
  let rules = wallet?.wallet_currency != null ? createCurrencyContext(wallet, { source: "walletInfo" }) : null;
  if (rules && !rules.verified) throw new Error("无法确认 Steam 钱包币种");
  if (!rules || (requireRules && !(rules.minimumBuyerMinor > 0))) {
    const account = queue && getSteamId();
    if (!account) throw new Error("无法确认 Steam 钱包币种");
    rules = await sharedMarketWallet(queue, account);
  }
  if ((current.currencyId && rules.currencyId !== current.currencyId)
    || (previous !== getActiveCurrencyContext() && getActiveCurrencyContext()?.currencyId !== rules.currencyId)) {
    throw new Error("钱包币种已改变，请重新查价");
  }
  if (requireRules && !(rules.minimumBuyerMinor > 0)) throw new Error("无法确认当前币种的 Steam 市场最低价");
  state.currencyContext = setActiveCurrencyContext(rules);
  if (state.loadOrderCache) {
    state.orderResults = state.loadOrderCache(rules.currencyId);
    delete state.loadOrderCache;
  }
  return state.currencyContext;
}
