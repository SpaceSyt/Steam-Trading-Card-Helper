# Steam Trading Card Helper

[简体中文](README.md) | English

Steam Trading Card Helper is a Tampermonkey userscript for scanning Steam trading card prices, estimating badge costs, assisting or automating purchases, managing buy orders, and processing Community items in bulk.

> [!IMPORTANT]
> v2.6.2 brought card price lookups, badge scans, crafting scans, price refreshes, and surplus item detection under shared concurrency controls. **Concurrent HTML requests are disabled by default**; enabling them can greatly speed up scans. Concurrency slightly increases short bursts of load on the browser, network, and Steam servers. Midrange and higher-end devices generally experience no noticeable performance impact.

## Features

| Page | Features |
| --- | --- |
| Price scan | Scan regular or foil badges, remaining drops, owned quantities, card prices, and costs for one set or the maximum badge level |
| Order cards | Save scan results, or add games manually by AppID and recalculate |
| Buy orders | View existing buy orders, remaining quantities, committed funds, and lowest sale prices; cancel orders in bulk |
| Price trends | Save cards or other market items and view current prices, listing quantities, 24-hour sales, and price changes |
| Badge crafting | Scan craftable sets and upgrade one level at a time or directly to the highest currently craftable level |
| Blacklist | Skip games manually, permanently, or automatically by price, with expired-entry cleanup |
| Surplus items | Find surplus cards, backgrounds, and emoticons, compare sale and gem values, and process them in bulk |
| Item favorites | Protect selected item types from being offered for sale or conversion into gems |
| Settings | Global options for concurrency, caching, prediction, personalization, and data import/export |

The sidebar shows the account and a reference price for a Sack of Gems. This can be disabled in settings.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/).
2. Open the [userscript installation link](https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/steam-trading-card-helper.user.js).
3. Go to your Steam badges page, such as `steamcommunity.com/id/xxx/badges/`.
4. Click **Steam Trading Card Helper** on the page.

Instructions appear the first time you open the script. You can view them again under **Settings → Instructions**.

## Basic usage

1. Under **Price scan**, set the price limit per set, purchase logic, and price method, then start scanning.
2. Select scan results. The three totals at the top include only selected games.
3. Click an individual result to open that game's card page. Use “Manual purchase” to open Steam's native multibuy interface, with the required quantities and appropriate prices filled in according to your settings.
4. You can also select results in bulk and submit standing buy orders. Quantities, unit prices, and total committed funds are shown before submission.
5. Items with failed price lookups or incomplete details remain in the results with `-` and can be recalculated later.

In results, buy orders, the blacklist, crafting lists, and item grids, hold and drag the mouse to select or deselect multiple entries.

## Price data

Price lookups first read the Steam Market listing page to obtain the current order book and recent sales in one request. They fall back to `priceoverview` only when required fields are missing. All `priceoverview` requests share a limit of 20 requests per minute.

| Price | Method and use | Possible deviation |
| --- | --- | --- |
| Lowest sale price | The lowest price returned by Steam (the current lowest sell price) | Usually close to the estimate when buying one item at the listed price; may underestimate multiple purchases if cheap stock is insufficient |
| Average price | The median returned by Steam (the median of recent sales) | More stable; may lag below rising prices or above falling prices, and is less useful when trading volume is very low |
| Highest buy order | The current highest buy order | — |

Missing prices are not treated as zero. Currency mismatches, malformed responses, and failed requests remain marked as missing prices.

## Cost estimates

Estimates use only data already collected during the scan. Changing the price method or selecting results does not trigger additional requests.

For a card with `owned` copies currently held and `sets` sets still needed to reach the target level:

| Estimate | Calculation | Tendency |
| --- | --- | --- |
| Completion total | Buy one of each missing card at the lowest sale price | Close to the immediate cost of completing the current set |
| Full-set total | Buy one of every card at the lowest sale price | Close to the current lowest listed cost of a complete set |
| Max-level total | Buy `max(0, sets - owned)` of each card; use the lowest sale price for the first copy and `max(lowest sale price, average price)` for the rest | More conservative than pricing every copy at the lowest price, and usually closer to the cost of buying multiple copies; may be slightly high or still too low if sell-side depth is insufficient |

The three totals at the top include selected entries only. If any selected game has missing prices, the total shows `-` to avoid presenting an apparently precise amount from incomplete data.

In manual mode, estimates include the current “Buy price adjustment” and never fall below the market minimum for the current currency. In smart pricing mode, estimates use the selected strategy's “No-wall adjustment.” The order-wall price can only be determined when generating an actual buy-order plan, so estimates may differ from the final order amount.

## Purchase quantity logic

| Mode | Target quantity per card |
| --- | --- |
| Complete one set | Buy one copy if none is owned; otherwise buy none |
| Complete to level 5 | Use the current badge level and owned cards to obtain the quantity needed for the target level |
| Buy one set | Buy exactly one of every card without subtracting owned quantities |
| Buy five sets | Buy the number of sets corresponding to the target level without subtracting owned quantities |

Foil badges have a maximum level of one, so foil mode uses the complete-one-set logic. When generating standing buy orders, existing buy orders and quantities awaiting submission in the current session are subtracted from the target to avoid duplicate orders.

## Manual pricing

Standing buy orders can use these price bases:

- **Lowest sale price**: The lowest sell price collected during the scan; usually higher, with faster fills.
- **Average price**: The median of recent sales; smoother, but may be low or high depending on the market trend.
- **Highest buy order**: The current highest buy order, fetched before submission; usually lower, requiring a wait for a fill.

The final unit price is “price base + buy price adjustment,” with a floor at Steam's market minimum for the current currency. Orders are not placed if the currency cannot be verified.

Steam multibuy always uses the scanned lowest sale price plus the manual buy price adjustment. It does not use smart pricing strategies for standing buy orders.

## Smart pricing

Smart pricing applies only to standing buy orders. The full buy-order depth is read before submission:

1. Identify isolated high bids at the top using price gaps, nearby price differences, and order proportions to avoid being misled by a few anomalous bids.
2. Near the highest valid buy price, find the nearest continuous region where order volume rises substantially compared with preceding price levels. This is the nearest order wall.
3. Select the wall top, wall bottom, or highest valid buy price according to the strategy, then apply the strategy's offset.
4. Keep the final price at or above the market minimum. When a lowest sale price is available, cap it at “lowest sale price - 0.01.”

| Strategy | With an order wall | Without an order wall | Default tendency |
| --- | --- | --- | --- |
| Conservative | Wall bottom | Highest valid buy price - 0.02 | Lower prices, potentially longer waits |
| Balanced | Wall top | Highest valid buy price - 0.01 | A balance between price and fill speed |
| Aggressive | Wall top + 0.01 | Highest valid buy price + 0.01 | Higher prices, more likely to move ahead in the queue |

The wall anchor and the offsets with and without a wall can be changed separately in advanced settings. If Steam explicitly reports no buy orders or the scan lacks the selected price, the script can fall back to the market minimum for the current currency according to your settings. Network errors, parsing failures, and currency conflicts still cause the item to be safely skipped.

## Scanning and filtering

- Supports regular and foil cards, a maximum number of badge pages, and an option to include games with remaining card drops.
- Skips sets exceeding the price limit. Early prediction reduces further requests when a small number of valid samples already clearly exceeds the limit.
- Scan results can be cached under “Order cards,” with manual AppID entry, recalculation, and configurable cache duration in days.
- The automatic blacklist can record full price lookups or early prediction results. Permanent blacklist entries are not removed by expiry cleanup.
- A green max-level estimate indicates recent sales volume above 1; yellow means 1, red means 0, and gray means prices are missing or estimated.

## Buy orders and price trends

- **Buy orders** reads current Steam buy orders and groups them by game. You can look up the lowest sale price for selected entries, view price differences, and cancel orders in bulk.
- Lowest sale prices are cached for 10 minutes. Cancellations run one at a time and retain their results.
- **Price trends** accepts items from scan results, the order cache, or a manually entered `market_hash_name`.
- Supports 24-hour, 7-day, 30-day, and all-time ranges, showing sparklines, current prices, listing quantities, sales volume, and changes since the previous check.

## Badge crafting

- Scan complete card sets, excluding blacklisted games.
- **Upgrade one level at a time**: Submit each level separately and stop if the result is unclear.
- **Craft to maximum**: Submit all currently available crafts for each game in one operation.
- Set quantities individually, or set all to 1, all to maximum, or all to zero. Confirmation is required before submission.

## Surplus items, selling, and gem conversion

- Surplus card detection reserves the sets still needed for the target badge level, then lists the remaining excess copies.
- Set default quantities to retain for backgrounds and emoticons, and choose whether to include Points Shop items.
- Recommendations compare the after-fee proceeds from selling an item at its current market price with the after-fee value of its gems, converted using the Sack of Gems price.
- Gem conversion is suggested when the after-fee market value is lower, no usable market price is available, or the item cannot be sold. Selling is suggested when the after-fee market value is higher.
- Selling supports the lowest sale price, average price, and highest buy order as price bases, followed by the “Sell price adjustment.”
- Gem conversion cannot be undone. Actual sales and gem conversions always run sequentially after confirmation.

Adding an item to **Item favorites** excludes that item type from sale and gem-conversion candidates. Favorites use an item-type identifier rather than an individual inventory asset ID.

## Concurrency and performance

| Setting | Default | Purpose |
| --- | --- | --- |
| Concurrent HTML requests | Disabled, concurrency 4 | Listing-page price lookups, price scans, crafting scans, price refreshes, surplus item detection, and more; enabling this provides the largest speedup |
| Other concurrent requests | Enabled, concurrency 8 | Reading gem values for items such as backgrounds and emoticons |

Concurrency can be set from 1–20. Higher values increase short bursts of network traffic, page parsing, CPU usage, and memory usage, and may make temporary Steam errors more likely. Midrange and higher-end devices generally experience only a minor impact. Paginated reads and write operations such as placing or canceling orders, selling, converting to gems, and crafting do not run in parallel.

Regardless of which feature triggers it, `priceoverview` uses the same counter of 20 requests per minute. The Sack of Gems price is fetched automatically once each time the script panel opens. Clicking refresh forces a new lookup.

## Personalization and data

- Drag the top tabs to reorder them. Changes are saved automatically.
- Under **Settings → Personalization**, set a six-digit HEX label color for each tab. Leave it empty to restore the default.
- Drag the log area's border to resize its height.
- At the bottom of settings, export a JSON file or import data, including settings, caches, price history, favorites, and interface state.
- If an import fails, the script attempts to restore the original data. Backups do not include your Steam login session.
- You can clear caches or restore default settings.

## Usage notes

- Market prices, order depth, and inventories can change at any time. Estimates are not final transaction amounts.
- If requests fail repeatedly or return `429`, reduce concurrency or pause before retrying.
- Check the confirmation dialog before placing or canceling orders, selling, converting to gems, or crafting. Gem conversion cannot be undone, and sales may require confirmation through the Steam mobile app.

## Development

### Choosing and building a version

The standard edition focuses on badges, cards, buy orders, price estimates, crafting, and surplus item processing. **Plus** includes all standard features and will gradually add more modifications and enhancements to Steam's native pages, extending beyond the script's original small panel. It currently supports valuation on the native trade offer page, showing each side's unique item count, total quantity, estimated total value, and the difference.

Language and edition are selected at build time. Plus offers two builds:

- **Compatibility edition (default)**: Removes some conflicts or duplicate displays with other extensions. Currently supports only Steam Economy Enhancer (SEE) and Augmented Steam. It hides SEE's trade summaries, itemized name lists, and total counts, as well as Augmented Steam's yellow item count bars. Unit price labels, select-all controls, and Steam's native trade confirmations and risk notices are preserved.
- **Standalone edition (`--standalone`)**: Does not include the compatibility rules above.

The compatibility edition does not disable other extensions' background requests. The standard edition does not enhance Steam's native content pages, so it has no separate compatibility build. All versions require Tampermonkey. Enable only one version of this project in the same browser, and disable the old version before switching.

After installing Node.js and npm, install build dependencies from the repository root, then choose a build command:

```sh
npm ci
```

| Version | Build command | Output file |
| --- | --- | --- |
| Standard · Chinese | `npm run build` | `steam-trading-card-helper.user.js` |
| Plus · Chinese · Compatibility | `npm run build:plus` | `steam-trading-card-helper-plus.user.js` |
| Plus · English · Compatibility | `npm run build:plus:en` | `steam-trading-card-helper-plus-en.user.js` |
| Standard · English | `npm run build:en` | `build/steam-trading-card-helper-en.user.js` |
| Plus · Chinese · Standalone | `npm run build:plus:standalone` | `build/steam-trading-card-helper-plus-standalone.user.js` |
| Plus · English · Standalone | `npm run build:plus:standalone:en` | `build/steam-trading-card-helper-plus-standalone-en.user.js` |

You can also build the Plus English compatibility edition with `npm run build -- --plus --en` or `node scripts/build.mjs --plus --en`. Add `--standalone` to generate the standalone edition. `--standalone` must be used with `--plus`.

After building, import the full contents of your chosen `.user.js` file into a new Tampermonkey script and save it. Plus compatibility builds use the default name; standalone builds include “独立版” or `(Standalone)` in the name.

- `npm test`: Run standard-edition unit tests.
- `npm run test:plus`: Run Plus tests.
- `npm run test:locales`: Check English translations.
- `npm run check`: Run the tests above, then build and validate all versions.

## Disclaimer

This script is not an official Valve or Steam product. Users assume the risks associated with transactions, item processing, account restrictions, and market fluctuations.

## License

[MIT](LICENSE)
