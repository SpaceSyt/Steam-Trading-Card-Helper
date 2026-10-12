# v2.7.1

Develop source commit: ce31eeeb435497c972270fbf55d1b8154ad17132

This is an artifact-only release from develop. The master branch retains its historical source tree and package metadata; build this release from the develop commit above, not from master's package version.

The patch supports both Steam listing SSR data envelopes, preserves item/currency/full-depth validation, and improves order-planning diagnostics and explicit zero-buy fallback handling. The public anonymous Sack of Gems page and a sanitized fixture were verified. This does not establish that every reported ordering failure has the same cause.

Validation: 256 checks passed (223 unit, 12 Plus, 7 localization, 14 build/publication); all six variants and the legacy Plus alias were generated. No live orders, cancellations, login or payments were performed.

## Installation paths

| Path | Edition |
| --- | --- |
| steam-trading-card-helper.user.js | Chinese Plus compatibility (legacy alias) |
| steam-trading-card-helper-plus.user.js | Chinese Plus compatibility |
| steam-trading-card-helper-plus-en.user.js | English Plus compatibility |
| steam-trading-card-helper-standard.user.js | Chinese standard |
| steam-trading-card-helper-en.user.js | English standard |

Each published script uses its own master path for both updateURL and downloadURL. The historical generic path remains Chinese Plus compatibility with the same name and namespace. Standalone remains an optional local build and is not included in this release file set.

## 发布说明

本次 master 仅同步五个脚本产物、中英文安装说明及本发布说明。历史通用入口继续提供 Plus 中文兼容版；普通中英文及 Plus 中英文使用各自更新地址。master 的旧源码与 package 版本不代表本次产物的构建来源，请使用上方 develop 提交复现构建。
