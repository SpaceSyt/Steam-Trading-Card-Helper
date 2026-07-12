# Test Assets

- `scripts/`: userscripts, browser harnesses, and the local static server.
- `fixtures/`: saved Steam pages and generated fixture payloads. This directory is intentionally ignored because fixtures may contain account-specific page data.

Run the local server from any working directory:

```powershell
node test/scripts/static-server.mjs
```

Then open `http://127.0.0.1:8765/test/scripts/craft-harness.html`.

Add `?order=1` to the craft harness URL to seed a two-card synthetic order-cache result. Its completion total is ¥0.70 at the default adjustment and ¥0.80 after applying +¥0.05 per missing card.

The rate-limit harness is available at `http://127.0.0.1:8765/test/scripts/rate-limit-harness.html`. It intercepts every request locally and returns two 200 responses followed by one 429 response, so it is safe for UI and tuning regression tests.

The request-queue harness is available at `http://127.0.0.1:8765/test/scripts/request-queue-harness.html`. It verifies that stopping immediately after the final `priceoverview` request prevents an active-cooldown countdown from reappearing after the caller clears its status.

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
