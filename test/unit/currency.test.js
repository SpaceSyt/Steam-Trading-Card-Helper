import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import {
  clearActiveCurrencyContext,
  detectCurrencyContext,
  formatMinorAmount,
  formatMoney,
  getActiveCurrencyContext,
  getCurrencyContextById,
  getCurrencyStatus,
  initializeCurrencyContext,
  parseCurrencyAmount,
} from "../../src/services/currency.js";
import { formatCNY } from "../../src/utils/format.js";

async function readFixture(name) {
  const url = new URL(`../fixtures-public/currency/${name}`, import.meta.url);
  return JSON.parse(await readFile(url, "utf8"));
}

afterEach(() => clearActiveCurrencyContext());

test("walletInfo has priority over application config, page clues, and configured fallback", async () => {
  const cny = await readFixture("cny-wallet.json");
  const usd = await readFixture("usd-wallet.json");
  const document = {
    getElementById() {
      return { getAttribute: () => usd.applicationConfigWalletInfo };
    },
    body: { textContent: "$99.99 USD" },
  };

  const context = detectCurrencyContext({
    walletInfo: cny.walletInfo,
    document,
    pageText: "$88.88 USD",
    configuredCurrencyId: 1,
  });

  assert.equal(context.currencyId, 23);
  assert.equal(context.code, "CNY");
  assert.equal(context.source, "walletInfo");
  assert.equal(context.isFallback, false);
  assert.equal(context.verified, true);
});

test("application_config data-walletinfo is decoded before page clues", async () => {
  const usd = await readFixture("usd-wallet.json");
  const element = { getAttribute: name => name === "data-walletinfo" ? usd.applicationConfigWalletInfo : null };
  const document = {
    getElementById: id => id === "application_config" ? element : null,
    body: { textContent: "¥88.88 CNY" },
  };

  const context = detectCurrencyContext({
    walletInfo: null,
    document,
    configuredCurrencyId: 23,
  });

  assert.equal(context.currencyId, 1);
  assert.equal(context.code, "USD");
  assert.equal(context.source, "application_config");
  assert.equal(context.isFallback, false);
});

test("page clues precede configured fallback, which is marked as fallback", () => {
  const pageContext = detectCurrencyContext({
    walletInfo: null,
    pageText: "Starting at: $1.25 USD",
    configuredCurrencyId: 23,
  });
  assert.equal(pageContext.currencyId, 1);
  assert.equal(pageContext.source, "page");
  assert.equal(pageContext.isFallback, false);

  const configuredContext = detectCurrencyContext({
    walletInfo: null,
    pageText: "No market price available",
    configuredCurrencyId: 23,
  });
  assert.equal(configuredContext.currencyId, 23);
  assert.equal(configuredContext.source, "configured");
  assert.equal(configuredContext.isFallback, true);
  assert.equal(configuredContext.status, "fallback");
});

test("escaped HK market SSR data overrides the configured CNY fallback", async () => {
  const hkd = await readFixture("hkd-page.json");
  const context = detectCurrencyContext({
    walletInfo: null,
    pageHtml: hkd.pageHtml,
    configuredCurrencyId: 23,
  });

  assert.equal(context.currencyId, 29);
  assert.equal(context.code, "HKD");
  assert.equal(context.symbol, "HK$");
  assert.equal(context.symbolSpacing, true);
  assert.equal(context.source, "page");
  assert.equal(context.isFallback, false);
  assert.equal(context.verified, true);
  assert.equal(formatMoney(26, context), "HK$\u00a00.26");
  assert.equal(parseCurrencyAmount("HK$ 1,234.56", context), 123456);
});

test("HK account country is used when the page exposes no numeric currency", () => {
  const context = detectCurrencyContext({
    walletInfo: null,
    pageHtml: "UserConfig={\\\"country_code\\\":\\\"HK\\\"}",
    configuredCurrencyId: 23,
  });

  assert.equal(context.currencyId, 29);
  assert.equal(context.code, "HKD");
  assert.equal(context.source, "page");
});

test("an unknown numeric wallet currency remains generic and unverified", async () => {
  const fixture = await readFixture("unknown-wallet.json");
  const context = detectCurrencyContext({
    walletInfo: {
      ...fixture.walletInfo,
      wallet_currency_code: "CNY",
      wallet_currency_symbol: "¥",
      wallet_currency_decimal_places: 0,
    },
    configuredCurrencyId: 23,
  });

  assert.equal(context.currencyId, 77);
  assert.equal(context.code, "STEAM-77");
  assert.equal(context.symbol, "¤");
  assert.equal(context.decimalDigits, 2);
  assert.equal(context.verified, false);
  assert.equal(context.verification, "unverified");
  assert.equal(context.status, "unverified");
  assert.notEqual(context.code, "CNY");
});

test("missing detection data stays unresolved instead of assuming CNY", () => {
  const context = detectCurrencyContext({ walletInfo: null });
  assert.equal(context.currencyId, null);
  assert.equal(context.code, "UNRESOLVED");
  assert.equal(context.verified, false);
  assert.equal(context.isFallback, true);
});

test("active context can be initialized, read, and cleared", async () => {
  const usd = await readFixture("usd-wallet.json");
  const initialized = initializeCurrencyContext({ walletInfo: usd.walletInfo });
  assert.strictEqual(getActiveCurrencyContext(), initialized);
  assert.equal(getActiveCurrencyContext().currencyId, 1);

  clearActiveCurrencyContext();
  assert.equal(getActiveCurrencyContext(), null);
});

test("CNY and USD fixtures format integer minor amounts and parse 1,234.56", async () => {
  for (const [fixtureName, currencyId] of [["cny-wallet.json", 23], ["usd-wallet.json", 1]]) {
    const fixture = await readFixture(fixtureName);
    const context = detectCurrencyContext({ walletInfo: fixture.walletInfo });
    assert.equal(context.currencyId, currencyId);
    assert.equal(formatMinorAmount(123456, context), "1,234.56");
    assert.equal(parseCurrencyAmount("1,234.56", context), 123456);

    for (const sample of fixture.amounts) {
      assert.equal(parseCurrencyAmount(sample.display, context), sample.minor);
      assert.equal(formatMoney(sample.minor, context), sample.display);
    }
  }
});

test("formatting includes signs and symbols while the CNY alias keeps its old shape", () => {
  const usd = getCurrencyContextById(1);
  assert.equal(formatMoney(-123, usd), "-$1.23");
  assert.equal(parseCurrencyAmount("-$1.23", usd), -123);
  assert.equal(formatCNY(123456), "1234.56");
  assert.equal(formatMinorAmount(12.5, usd), "?");
});

test("currency parsing rejects malformed grouping and excess precision", () => {
  const context = getCurrencyContextById(23);
  assert.equal(parseCurrencyAmount("12,34.56", context), null);
  assert.equal(parseCurrencyAmount("1.234", context), null);
  assert.equal(parseCurrencyAmount("not a price", context), null);
});

test("currency status exposes verification, source, and fallback state", () => {
  const context = detectCurrencyContext({ walletInfo: null, configuredCurrencyId: 1 });
  assert.deepEqual(getCurrencyStatus(context), {
    currencyId: 1,
    code: "USD",
    status: "fallback",
    verified: true,
    isFallback: true,
    source: "configured",
    label: "USD (fallback)",
  });
});
