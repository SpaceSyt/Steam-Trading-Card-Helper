# Test Assets

- `scripts/`: userscripts, browser harnesses, and the local static server.
- `fixtures/`: saved Steam pages and generated fixture payloads. This directory is intentionally ignored because fixtures may contain account-specific page data.
- `fixtures-public/`: committed synthetic, sanitized inputs for currency, market-data, and cache migration tests.
- `unit/`: Node.js automated tests for shared infrastructure, including bounded market-history storage and statistics.

Run the automated suite from the repository root:

```powershell
npm test
```

Run the local server from any working directory:

```powershell
node test/scripts/static-server.mjs
```

Then open `http://127.0.0.1:8765/test/scripts/craft-harness.html`.

Add `?order=1` to the craft harness URL to seed a two-card synthetic order-cache result. Its completion total is ¥0.70 at the default adjustment and ¥0.80 after applying +¥0.05 per missing card.

Add `?wallet=usd` to expose a synthetic USD wallet context and USD price strings, or `?wallet=cny` to pin the harness to CNY. This verifies wallet-first currency detection, currency-isolated caches, and money formatting without a Steam request.

Add `?wallet=cny&history=1` to seed two saved market items and local price-history samples. Open the Price Trends tab to verify tab order, the exact manual-input placeholder, one compact sparkline row per item, current metrics, market listing links, hover/focus deletion, and re-adding an item without duplicating it.

The rate-limit harness is available at `http://127.0.0.1:8765/test/scripts/rate-limit-harness.html`. It intercepts every request locally and returns two 200 responses followed by one 429 response, so it is safe for UI and tuning regression tests.

The request-queue harness is available at `http://127.0.0.1:8765/test/scripts/request-queue-harness.html`. It verifies that stopping immediately after the final `priceoverview` request prevents an active-cooldown countdown from reappearing after the caller clears its status.

The v2.1 market harness is available at `http://127.0.0.1:8765/test/scripts/v2.1-market-harness.html`. It uses only synthetic responses and in-memory GM storage to verify CNY and USD price requests, currency-isolated cache records, a successful response without prices, one 429 retry, stopping an active proactive cooldown, and recovery with a fresh queue. It never sends an application request to Steam. The final JSON is shown on the page and is also exposed as `window.__v21MarketHarnessResult`; a successful run reports `passed: true` and `6/6` scenarios.

## Rate Limit Probe

Install `scripts/rate-limit-probe.user.js` separately from the main userscript, then open a Steam badge page. The probe supports:

- Market price, listing, price history, market search, gamecards, badge page, inventory, and mixed targets.
- `fetch`, `XMLHttpRequest`, `jQuery.ajax`, and `GM_xmlhttpRequest` transports.
- A total request limit (`0` runs until stopped), per-batch request count, and longest successful streak tracking.
- Fixed-start scheduling, which dispatches requests at a fixed interval without waiting for the previous response, plus a serial comparison mode.
- Optional batch pauses. Disable them when probing endpoints that may tolerate continuous requests.
- Optional automatic tuning. After two clean batches, `success step` reduces the interval; after a 429, `429 step` increases it. Batch cooldown is only extended when batch pauses are enabled.
- Automatic JSON result generation on stop or completion, with copy, download, and optional automatic-download controls.

Run probes carefully: triggering 429 may temporarily rate-limit the current IP address.
