import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { afterEach } from "node:test";

import {
  clearActiveCurrencyContext,
  detectCurrencyContext,
  setActiveCurrencyContext,
} from "../../src/services/currency.js";
import {
  getBuyerPriceForSellerReceive,
  getMarketFeesForSellerReceive,
  getSellerReceiveForBuyerPrice,
} from "../../src/utils/market-fees.js";
import {
  getMarketMinimumPriceCents,
  getMarketMinimumPriceMinor,
} from "../../src/utils/steam.js";

async function readWalletFixture(name) {
  const url = new URL(`../fixtures-public/currency/${name}`, import.meta.url);
  const fixture = JSON.parse(await readFile(url, "utf8"));
  return fixture.walletInfo;
}

afterEach(() => clearActiveCurrencyContext());

test("minimum buyer price is driven by the CNY/USD wallet context", async () => {
  const cnyWallet = await readWalletFixture("cny-wallet.json");
  const usdWallet = await readWalletFixture("usd-wallet.json");
  const cny = detectCurrencyContext({ walletInfo: cnyWallet });
  const usd = detectCurrencyContext({ walletInfo: usdWallet });

  assert.equal(getMarketMinimumPriceMinor(cny), 21);
  assert.equal(getMarketMinimumPriceMinor(cnyWallet), 21);
  assert.equal(getMarketMinimumPriceMinor(usd), 3);
  assert.equal(getMarketMinimumPriceCents(usdWallet), 3);
});

test("fee minimums and rates come from each currency context", async () => {
  const cny = detectCurrencyContext({ walletInfo: await readWalletFixture("cny-wallet.json") });
  const usd = detectCurrencyContext({ walletInfo: await readWalletFixture("usd-wallet.json") });

  assert.deepEqual(getMarketFeesForSellerReceive(7, cny), {
    steamFee: 7,
    publisherFee: 7,
    totalFees: 14,
    buyerCents: 21,
  });
  assert.deepEqual(getMarketFeesForSellerReceive(1, usd), {
    steamFee: 1,
    publisherFee: 1,
    totalFees: 2,
    buyerCents: 3,
  });
  assert.equal(getBuyerPriceForSellerReceive(100, cny), 117);
  assert.equal(getBuyerPriceForSellerReceive(100, usd), 115);
});

test("walletInfo can be passed directly without first creating a context", async () => {
  const cnyWallet = await readWalletFixture("cny-wallet.json");
  assert.deepEqual(
    getMarketFeesForSellerReceive(100, cnyWallet),
    { steamFee: 7, publisherFee: 10, totalFees: 17, buyerCents: 117 },
  );
});

test("context-free minimum lookup fails closed until currency initialization", async () => {
  assert.deepEqual(getMarketFeesForSellerReceive(100), {
    steamFee: 5,
    publisherFee: 10,
    totalFees: 15,
    buyerCents: 115,
  });
  assert.equal(getMarketMinimumPriceCents(), null);

  const cny = detectCurrencyContext({ walletInfo: await readWalletFixture("cny-wallet.json") });
  setActiveCurrencyContext(cny);
  assert.equal(getBuyerPriceForSellerReceive(100), 117);
  assert.equal(getMarketMinimumPriceCents(), 21);
});

test("buyer/seller conversion remains monotonic with a supplied context", async () => {
  const cny = detectCurrencyContext({ walletInfo: await readWalletFixture("cny-wallet.json") });
  const usd = detectCurrencyContext({ walletInfo: await readWalletFixture("usd-wallet.json") });

  assert.equal(getSellerReceiveForBuyerPrice(117, cny), 100);
  assert.equal(getSellerReceiveForBuyerPrice(115, usd), 100);
  assert.ok(getBuyerPriceForSellerReceive(101, cny) > 117);
});

test("wallet fee overrides are applied without treating an unknown ID as CNY", () => {
  const walletInfo = {
    wallet_currency: 77,
    wallet_market_minimum: 2,
    wallet_fee_minimum: 2,
    wallet_fee_percent: "0.10",
    wallet_publisher_fee_percent_default: "0.20",
    wallet_fee_base: 1,
  };
  const context = detectCurrencyContext({ walletInfo });
  assert.equal(context.verified, false);
  assert.deepEqual(getMarketFeesForSellerReceive(10, walletInfo), {
    steamFee: 3,
    publisherFee: 2,
    totalFees: 5,
    buyerCents: 15,
  });
  assert.equal(getMarketMinimumPriceMinor(context), 6);
});

test("inverse fee conversion returns the greatest affordable seller amount", async () => {
  const contexts = [
    detectCurrencyContext({ walletInfo: await readWalletFixture("cny-wallet.json") }),
    detectCurrencyContext({ walletInfo: await readWalletFixture("usd-wallet.json") }),
  ];

  for (const context of contexts) {
    for (let buyer = 0; buyer <= 2000; buyer += 1) {
      const seller = getSellerReceiveForBuyerPrice(buyer, context);
      assert.ok(getBuyerPriceForSellerReceive(seller, context) <= buyer);
      assert.ok(getBuyerPriceForSellerReceive(seller + 1, context) > buyer);
    }
  }
});
