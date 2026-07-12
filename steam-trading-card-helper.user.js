// ==UserScript==
// @name         Steam Trading Card Helper
// @name:zh-CN   Steam 卡牌助手
// @namespace    https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @version      2.0.5
// @description  Scan card prices, estimate badge costs, streamline purchases, craft badges, buy seasonal badge levels, find surplus cards, and process surplus items
// @description:zh-CN 扫描卡牌价格、估算徽章成本、辅助批量购买、自动合成徽章、购买季节徽章等级，并检测和处理多余卡牌/背景/表情
// @author       SpaceSyt
// @homepageURL  https://github.com/SpaceSyt/Steam-Trading-Card-Helper
// @supportURL   https://github.com/SpaceSyt/Steam-Trading-Card-Helper/issues
// @downloadURL  https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/steam-trading-card-helper.user.js
// @updateURL    https://raw.githubusercontent.com/SpaceSyt/Steam-Trading-Card-Helper/master/steam-trading-card-helper.user.js
// @match        *://steamcommunity.com/*/badges*
// @match        *://steamcommunity.com/id/*/badges*
// @match        *://steamcommunity.com/profiles/*/badges*
// @match        *://steamcommunity.com/*/inventory*
// @match        *://steamcommunity.com/id/*/inventory*
// @match        *://steamcommunity.com/profiles/*/inventory*
// @match        *://steamcommunity.com/market/multibuy*
// @match        *://store.steampowered.com/points/shop*
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      store.steampowered.com
// @connect      steamcommunity.com
// @connect      api.steampowered.com
// @license      MIT
// ==/UserScript==

"use strict";
(() => {
  // src/ui/style.css
  var style_default = '    .stch-btn-entry {\n      display: inline-block;\n      padding: 6px 12px;\n      margin-left: 10px;\n      background: rgba(67, 137, 179, 0.85);\n      color: #fff;\n      border-radius: 3px;\n      cursor: pointer;\n      font-size: 13px;\n    }\n    .stch-btn-entry:hover { background: rgba(87, 157, 199, 1); }\n    .stch-store-entry-wrap {\n      margin-top: 8px;\n    }\n    .stch-store-entry-wrap .stch-btn-entry {\n      margin-left: 0;\n    }\n    .inventory_rightnav .stch-btn-entry.stch-inventory-entry {\n      margin: 0 12px 0 0;\n      padding: 0 12px;\n      height: 30px;\n      line-height: 30px;\n      vertical-align: top;\n    }\n\n    #stch-sidebar {\n      position: fixed;\n      left: 0;\n      top: 122px;\n      width: 304px;\n      max-height: calc(100vh - 170px);\n      min-height: 360px;\n      transform: translateX(-272px);\n      transition: transform 160ms ease;\n      z-index: 10002;\n      color: #c7d5e0;\n      font-family: "Motiva Sans", Arial, sans-serif;\n      font-size: 13px;\n      filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.45));\n    }\n    #stch-sidebar:hover,\n    #stch-sidebar.pinned {\n      transform: translateX(0);\n    }\n    .stch-sidebar-panel {\n      width: 272px;\n      min-height: 360px;\n      max-height: calc(100vh - 170px);\n      overflow: hidden;\n      background: #172435;\n      border: 1px solid #31445b;\n      border-left: 0;\n      border-radius: 0 4px 4px 0;\n      display: flex;\n      flex-direction: column;\n    }\n    .stch-sidebar-handle {\n      position: absolute;\n      top: 0;\n      right: 0;\n      width: 32px;\n      height: 100%;\n      background: linear-gradient(180deg, #25445d, #1a2d40);\n      border: 1px solid #3f617b;\n      border-left: 0;\n      border-radius: 0 5px 5px 0;\n      color: #66c0f4;\n      cursor: pointer;\n      writing-mode: vertical-rl;\n      text-orientation: mixed;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      letter-spacing: 0;\n      user-select: none;\n      font-weight: bold;\n    }\n    .stch-sidebar-head {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      padding: 12px;\n      background: #202f43;\n      border-bottom: 1px solid #31445b;\n    }\n    .stch-sidebar-avatar {\n      width: 46px;\n      height: 46px;\n      object-fit: cover;\n      border: 1px solid #66c0f4;\n      background: #0b141f;\n      flex-shrink: 0;\n    }\n    .stch-sidebar-title {\n      min-width: 0;\n      flex: 1;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n    .stch-sidebar-name {\n      color: #fff;\n      font-size: 15px;\n      font-weight: bold;\n      line-height: 1.25;\n      text-align: center;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-sidebar-pin {\n      margin-left: auto;\n      background: #0e1621;\n      border: 1px solid #45556b;\n      color: #c7d5e0;\n      border-radius: 2px;\n      padding: 4px 7px;\n      cursor: pointer;\n      font-size: 12px;\n      flex-shrink: 0;\n    }\n    .stch-sidebar-pin:hover,\n    #stch-sidebar.pinned .stch-sidebar-pin {\n      color: #fff;\n      border-color: #66c0f4;\n    }\n    .stch-sidebar-body {\n      padding: 10px 12px 12px;\n      overflow-y: auto;\n      min-height: 0;\n    }\n    .stch-sidebar-row {\n      display: flex;\n      justify-content: space-between;\n      gap: 10px;\n      padding: 7px 0;\n      border-bottom: 1px solid rgba(69, 85, 107, 0.55);\n    }\n    .stch-sidebar-row:last-child {\n      border-bottom: 0;\n    }\n    .stch-sidebar-key {\n      color: #8f98a0;\n      white-space: nowrap;\n    }\n    .stch-sidebar-value {\n      color: #fff;\n      text-align: right;\n      min-width: 0;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    #stch-sidebar-gem-price { font-size: 12px; }\n    .stch-sidebar-price-rise { color: #d85c5c; }\n    .stch-sidebar-price-fall { color: #68b86b; }\n    .stch-sidebar-price-flat { color: #8f98a0; }\n    .stch-sidebar-progress {\n      height: 6px;\n      background: #0e1621;\n      border-radius: 6px;\n      overflow: hidden;\n      margin-top: 4px;\n      border: 1px solid #31445b;\n    }\n    .stch-sidebar-progress-bar {\n      height: 100%;\n      width: 0;\n      background: linear-gradient(90deg, #75b022, #66c0f4);\n    }\n    .stch-sidebar-status {\n      color: #8f98a0;\n      font-size: 12px;\n      margin-top: 9px;\n      line-height: 1.4;\n    }\n    .stch-sidebar-actions {\n      display: flex;\n      justify-content: flex-end;\n      margin-top: 10px;\n    }\n    .stch-sidebar-refresh {\n      background: linear-gradient(to bottom, #67c1f5 5%, #417a9b 95%);\n      color: #fff;\n      border: 0;\n      border-radius: 2px;\n      cursor: pointer;\n      padding: 5px 10px;\n      font-size: 12px;\n    }\n    .stch-sidebar-refresh:disabled {\n      opacity: 0.55;\n      cursor: not-allowed;\n    }\n\n    #stch-backdrop {\n      position: fixed;\n      inset: 0;\n      background: rgba(0,0,0,0.6);\n      z-index: 10000;\n      display: none;\n    }\n    #stch-modal {\n      position: fixed;\n      left: 50%; top: 20px;\n      transform: translateX(-50%);\n      width: 1060px; max-width: 95vw;\n      height: 92vh;\n      background: #1b2838;\n      color: #c6d4df;\n      z-index: 10001;\n      border-radius: 4px;\n      overflow: hidden;\n      display: flex;\n      flex-direction: column;\n      font-family: "Motiva Sans", Arial, sans-serif;\n      font-size: 14px;\n      box-shadow: 0 0 30px rgba(0,0,0,0.6);\n    }\n    #stch-modal .stch-header {\n      padding: 10px 16px;\n      border-bottom: 1px solid #45556b;\n      display: flex;\n      align-items: center;\n      background: #171a21;\n    }\n    #stch-modal .stch-header h2 {\n      margin: 0; font-size: 20px; flex: 1; color: #fff;\n    }\n    #stch-modal .stch-close {\n      cursor: pointer; font-size: 22px; color: #8f98a0;\n    }\n    #stch-modal .stch-close:hover { color: #fff; }\n    #stch-modal .stch-body {\n      flex: 1; overflow-y: hidden; padding: 12px 16px;\n      display: flex; flex-direction: column;\n      min-height: 0;\n    }\n    #stch-modal .stch-footer {\n      padding: 10px 16px;\n      background: #171a21;\n      border-top: 1px solid #45556b;\n      display: flex;\n      gap: 10px;\n      align-items: center;\n      flex-wrap: wrap;\n      font-size: 13px;\n    }\n    .stch-settings-page-actions {\n      margin-top: 20px;\n      padding-top: 12px;\n      border-top: 1px solid #45556b;\n      display: flex;\n      align-items: center;\n      justify-content: flex-end;\n      gap: 6px;\n    }\n    .stch-settings-page-actions .stch-footer-status { margin-right: auto; }\n    .stch-settings-page-actions .stch-btn {\n      padding: 6px 11px;\n      font-size: 13px;\n    }\n    .stch-footer-status {\n      color: #8db7d7;\n      min-height: 16px;\n    }\n    #stch-tab-settings {\n      overflow-y: auto;\n      padding-right: 4px;\n    }\n    .stch-input {\n      background: #0e1621;\n      color: #fff;\n      border: 1px solid #45556b;\n      padding: 5px 8px;\n      border-radius: 2px;\n      width: 80px;\n      font-size: 14px;\n    }\n    .stch-input:focus { border-color: #66c0f4; outline: none; }\n    .stch-label { font-size: 14px; color: #8f98a0; }\n    .stch-btn {\n      padding: 8px 16px;\n      background: linear-gradient(to bottom, #75b022 5%, #588a1b 95%);\n      color: #fff;\n      border-radius: 2px;\n      cursor: pointer;\n      font-size: 15px;\n      user-select: none;\n    }\n    .stch-btn:hover { background: linear-gradient(to bottom, #8ed629 5%, #6aa621 95%); }\n    .stch-btn.disabled {\n      background: #2a3f5a;\n      color: #667;\n      cursor: not-allowed;\n      opacity: 0.6;\n    }\n    .stch-btn.alt {\n      background: linear-gradient(to bottom, #67c1f5 5%, #417a9b 95%);\n    }\n    .stch-btn.alt:hover {\n      background: linear-gradient(to bottom, #8ed8ff 5%, #5297b7 95%);\n    }\n    .stch-btn.stch-btn-danger {\n      background: linear-gradient(to bottom, #c04040 5%, #8b2020 95%);\n    }\n    .stch-btn.stch-btn-danger:hover {\n      background: linear-gradient(to bottom, #e05050 5%, #a03030 95%);\n    }\n\n    .stch-game-list {\n      max-height: 30vh;\n      overflow-y: auto;\n      border: 1px solid #2a3f5a;\n      border-radius: 3px;\n      background: rgba(0,0,0,0.2);\n    }\n    #stch-tab-scan.stch-foil-mode {\n      background: linear-gradient(180deg, rgba(70, 31, 82, 0.46), rgba(27, 40, 56, 0.98) 260px);\n      box-shadow: inset 0 0 0 1px rgba(193, 91, 196, 0.24);\n      border-radius: 3px;\n    }\n    #stch-tab-scan.stch-foil-mode .stch-game-list {\n      border-color: rgba(193, 91, 196, 0.42);\n      background: rgba(20, 11, 27, 0.34);\n    }\n    #stch-tab-scan.stch-foil-mode #stch-log {\n      background: #120d1b;\n      border: 1px solid rgba(193, 91, 196, 0.22);\n    }\n    #stch-tab-scan.stch-foil-mode .stch-progress-bar {\n      background: linear-gradient(to right, #8f55c2, #cf73c9);\n    }\n    #stch-tab-scan.stch-foil-mode .stch-cost,\n    #stch-tab-scan.stch-foil-mode .stch-appid {\n      color: #d78be8;\n    }\n    .stch-game-row {\n      padding: 6px 14px;\n      border-bottom: 1px solid rgba(69,85,107,0.4);\n      display: flex;\n      align-items: center;\n      gap: 12px;\n      font-size: 14px;\n      line-height: 1.4;\n    }\n    .stch-row-header {\n      color: #8f98a0;\n      font-size: 12px;\n      font-weight: bold;\n      border-bottom: 2px solid #45556b;\n      padding-bottom: 6px;\n      margin-bottom: 2px;\n    }\n    .stch-game-row:hover { background: rgba(103,193,245,0.08); }\n    .stch-game-row .stch-appid {\n      width: 56px;\n      flex-shrink: 0;\n      color: #66c0f4;\n      font-family: monospace;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-name {\n      flex: 1;\n      color: #e2e2e2;\n      font-size: 13px;\n      min-width: 0;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-game-row .stch-level {\n      width: 42px;\n      flex-shrink: 0;\n      color: #a1b053;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-cards {\n      width: 36px;\n      flex-shrink: 0;\n      color: #c6d4df;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-cost {\n      width: 68px;\n      flex-shrink: 0;\n      color: #75b022;\n      font-weight: bold;\n      font-size: 13px;\n      text-align: center;\n    }\n    .stch-game-row .stch-full {\n      width: 68px;\n      flex-shrink: 0;\n      color: #ffc902;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-lv5 {\n      width: 84px;\n      flex-shrink: 0;\n      color: #e74c3c;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-drops {\n      width: 36px;\n      flex-shrink: 0;\n      color: #8db7d7;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-order-cache-age {\n      width: 38px;\n      flex-shrink: 0;\n      color: #8f98a0;\n      font-size: 12px;\n      text-align: center;\n    }\n    .stch-game-row .stch-buy {\n      width: 60px;\n      flex-shrink: 0;\n      text-align: center;\n    }\n    .stch-game-row .stch-check {\n      width: 24px;\n      flex-shrink: 0;\n      text-align: center;\n      position: relative;\n      align-self: stretch;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      overflow: visible;\n    }\n    .stch-game-list:not(.stch-show-drops) .stch-drops { display: none; }\n    .stch-result-cb {\n      margin: 0;\n      cursor: pointer;\n      accent-color: #75b022;\n    }\n    .stch-check-hit {\n      position: absolute;\n      left: 50%;\n      top: 50%;\n      width: 36px;\n      height: 32px;\n      transform: translate(-50%, -50%);\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      cursor: pointer;\n      z-index: 1;\n    }\n    .stch-check-hit .stch-result-cb {\n      position: relative;\n      z-index: 2;\n    }\n    .stch-craft-list {\n      flex: 1;\n      min-height: 0;\n      max-height: none;\n    }\n    .stch-order-page-list {\n      flex: 1;\n      min-height: 0;\n      max-height: none;\n      width: 100%;\n      box-sizing: border-box;\n    }\n    .stch-order-tools {\n      margin-left: auto;\n    }\n    .stch-craft-row .stch-craft-available {\n      width: 64px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #ffc902;\n      font-size: 12px;\n    }\n    .stch-craft-row .stch-craft-count {\n      width: 74px;\n      flex-shrink: 0;\n      text-align: center;\n    }\n    .stch-craft-row .stch-craft-count input {\n      width: 48px;\n      box-sizing: border-box;\n      text-align: center;\n      padding: 4px;\n    }\n    .stch-craft-row .stch-craft-target {\n      width: 54px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #a1b053;\n      font-size: 12px;\n    }\n    .stch-craft-row .stch-craft-status {\n      width: 72px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #8f98a0;\n      font-size: 12px;\n    }\n    .stch-craft-row .stch-craft-status.ok { color: #75b022; }\n    .stch-craft-row .stch-craft-status.warn { color: #ffc902; }\n    .stch-craft-row .stch-craft-status.err { color: #c04040; }\n    .stch-craft-actions {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      margin-left: auto;\n    }\n    .stch-surplus-list {\n      flex: 1;\n      min-height: 0;\n      max-height: none;\n    }\n    .stch-surplus-main-toolbar {\n      gap: 12px;\n      flex-wrap: nowrap;\n    }\n    .stch-surplus-action-row {\n      gap: 12px;\n      flex-wrap: wrap;\n      align-items: center;\n    }\n    .stch-surplus-action-spacer {\n      flex: 1 1 auto;\n      min-width: 16px;\n    }\n    .stch-surplus-action-row .stch-processing-selected-count {\n      margin-left: 0;\n    }\n    .stch-processing-selected-count {\n      width: auto;\n      min-width: 78px;\n      margin-left: auto;\n      margin-right: 0;\n      justify-content: flex-end;\n    }\n    .stch-surplus-action-buttons {\n      display: flex;\n      align-items: center;\n      gap: 8px;\n    }\n    .stch-surplus-action-buttons .stch-btn {\n      padding: 7px 12px;\n      font-size: 13px;\n      min-width: 56px;\n      text-align: center;\n      box-sizing: border-box;\n    }\n    .stch-surplus-mode-panel {\n      display: none;\n      flex-direction: column;\n      flex: 1;\n      min-height: 0;\n    }\n    .stch-surplus-mode-panel.active {\n      display: flex;\n    }\n    .stch-inventory-grid {\n      display: grid;\n      grid-template-columns: repeat(auto-fill, 88px);\n      grid-auto-rows: 88px;\n      gap: 4px;\n      padding: 4px;\n      align-content: start;\n      justify-content: start;\n      box-sizing: border-box;\n    }\n    .stch-inventory-empty {\n      grid-column: 1 / -1;\n      min-height: 120px;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      color: #8f98a0;\n      font-size: 13px;\n    }\n    .stch-inv-tile {\n      position: relative;\n      aspect-ratio: 1 / 1;\n      min-width: 0;\n      background: #20252d;\n      border: 1px solid #3a3a3a;\n      cursor: pointer;\n      overflow: hidden;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n      box-shadow: inset 0 0 12px rgba(0, 0, 0, 0.32);\n      user-select: none;\n    }\n    .stch-inv-tile:hover {\n      border-color: #66c0f4;\n      box-shadow: inset 0 0 14px rgba(102, 192, 244, 0.22), 0 0 0 1px rgba(102, 192, 244, 0.22);\n    }\n    .stch-inv-tile.selected {\n      border-color: #66c0f4 !important;\n      box-shadow: inset 0 0 0 2px rgba(102, 192, 244, 0.85), 0 0 0 1px rgba(102, 192, 244, 0.55);\n      background: #23384a;\n    }\n    .stch-inv-tile.stch-volume-zero::after,\n    .stch-inv-tile.stch-gem-better::after {\n      content: "";\n      position: absolute;\n      inset: 0;\n      z-index: 1;\n      pointer-events: none;\n    }\n    .stch-inv-tile.stch-volume-zero::after {\n      background: rgba(217, 166, 24, 0.28);\n      box-shadow: inset 0 0 0 2px rgba(255, 201, 2, 0.68);\n    }\n    .stch-inv-tile.stch-gem-better::after {\n      background: rgba(60, 153, 72, 0.30);\n      box-shadow: inset 0 0 0 2px rgba(117, 176, 34, 0.76);\n    }\n    .stch-inv-tile img {\n      width: 100%;\n      height: 100%;\n      object-fit: contain;\n      display: block;\n      pointer-events: none;\n    }\n    .stch-inv-placeholder {\n      padding: 8px;\n      color: #c7d5e0;\n      font-size: 12px;\n      line-height: 1.3;\n      text-align: center;\n      word-break: break-word;\n    }\n    .stch-inv-badge {\n      position: absolute;\n      right: 0;\n      top: 0;\n      max-width: calc(100% - 8px);\n      padding: 2px 5px;\n      background: rgba(52, 122, 166, 0.92);\n      color: #fff;\n      font-size: 12px;\n      line-height: 1.25;\n      font-weight: bold;\n      text-shadow: 0 1px 1px #000;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      z-index: 2;\n    }\n    .stch-inv-badge-left {\n      left: 0;\n      right: auto;\n      background: rgba(20, 27, 35, 0.86);\n      color: #8db7d7;\n    }\n    .stch-inv-badge-left.ok { color: #75b022; }\n    .stch-inv-badge-left.warn { color: #ffc902; }\n    .stch-inv-badge-left.info { color: #66c0f4; }\n    .stch-inv-gems {\n      position: absolute;\n      left: 0;\n      right: 0;\n      bottom: 20px;\n      color: #c7d5e0;\n      background: rgba(0, 0, 0, 0.42);\n      font-size: 11px;\n      line-height: 17px;\n      text-align: center;\n      text-shadow: 0 1px 1px #000;\n      z-index: 2;\n    }\n    .stch-inv-name {\n      position: absolute;\n      left: 0;\n      right: 0;\n      bottom: 0;\n      height: 20px;\n      padding: 2px 4px;\n      box-sizing: border-box;\n      color: #dfe3e6;\n      background: linear-gradient(180deg, rgba(10, 14, 20, 0.2), rgba(10, 14, 20, 0.88));\n      font-size: 11px;\n      line-height: 16px;\n      text-align: center;\n      white-space: nowrap;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      text-shadow: 0 1px 1px #000;\n      z-index: 2;\n    }\n    .stch-surplus-row .stch-name {\n      flex: 0 0 190px;\n    }\n    .stch-surplus-row .stch-surplus-card {\n      flex: 1;\n      min-width: 120px;\n      color: #e2e2e2;\n      font-size: 13px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-surplus-row .stch-surplus-badge {\n      width: 72px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #a1b053;\n      font-size: 12px;\n    }\n    .stch-surplus-row .stch-surplus-num {\n      width: 48px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #c6d4df;\n      font-size: 12px;\n    }\n    .stch-surplus-row .stch-surplus-extra {\n      width: 70px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #75b022;\n      font-size: 12px;\n      font-weight: bold;\n    }\n    .stch-surplus-row .stch-surplus-assets {\n      width: 150px;\n      flex-shrink: 0;\n      color: #8db7d7;\n      font-family: "Courier New", monospace;\n      font-size: 11px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-grind-list {\n      flex: 1;\n      min-height: 0;\n      max-height: none;\n    }\n    .stch-grind-row .stch-name {\n      flex: 0 0 150px;\n    }\n    .stch-grind-row .stch-grind-type {\n      width: 66px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #8db7d7;\n      font-size: 12px;\n    }\n    .stch-grind-row .stch-grind-item {\n      flex: 1;\n      min-width: 120px;\n      color: #e2e2e2;\n      font-size: 13px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-grind-row .stch-grind-num {\n      width: 48px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #c6d4df;\n      font-size: 12px;\n    }\n    .stch-grind-row .stch-grind-price {\n      width: 70px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #ffc902;\n      font-size: 12px;\n    }\n    .stch-grind-row .stch-grind-action {\n      width: 72px;\n      flex-shrink: 0;\n      text-align: center;\n      color: #8f98a0;\n      font-size: 12px;\n      font-weight: bold;\n    }\n    .stch-grind-row .stch-grind-action.ok { color: #75b022; }\n    .stch-grind-row .stch-grind-action.warn { color: #ffc902; }\n    .stch-grind-row .stch-grind-action.info { color: #66c0f4; }\n    .stch-grind-row .stch-grind-assets {\n      width: 132px;\n      flex-shrink: 0;\n      color: #8db7d7;\n      font-family: "Courier New", monospace;\n      font-size: 11px;\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-seasonal-panel {\n      border: 1px solid #2a3f5a;\n      border-radius: 3px;\n      background: rgba(0,0,0,0.2);\n      padding: 12px;\n      margin-bottom: 10px;\n      color: #c6d4df;\n      line-height: 1.6;\n    }\n    .stch-seasonal-panel b { color: #fff; }\n    .stch-seasonal-note {\n      color: #8f98a0;\n      font-size: 12px;\n      margin-top: 8px;\n    }\n    .stch-seasonal-warning {\n      color: #ffc902;\n      font-size: 12px;\n      margin-top: 4px;\n    }\n    .stch-scan-actions {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      margin-bottom: 8px;\n    }\n    .stch-bulk-actions {\n      display: flex;\n      align-items: center;\n      gap: 10px;\n      margin-left: auto;\n    }\n    .stch-selected-count {\n      color: #8f98a0;\n      margin-left: auto;\n      width: 24px;\n      margin-right: 14px;\n      flex-shrink: 0;\n      display: flex;\n      justify-content: center;\n      white-space: nowrap;\n    }\n    .stch-selected-count.stch-processing-selected-count {\n      width: auto;\n      min-width: 78px;\n      margin-left: auto;\n      margin-right: 0;\n      justify-content: flex-end;\n    }\n    .stch-help {\n      cursor: help;\n      color: #8f98a0;\n      font-size: 12px;\n    }\n    .stch-sortable {\n      cursor: pointer;\n      user-select: none;\n    }\n    .stch-sortable:hover { color: #fff; }\n    .stch-sort-arrow { font-size: 10px; }\n    .stch-toolbar {\n      display: flex;\n      gap: 14px;\n      align-items: center;\n      margin-bottom: 8px;\n      flex-wrap: wrap;\n      font-size: 14px;\n      color: #8f98a0;\n    }\n    .stch-toolbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }\n    .stch-settings-hint {\n      color: #697887;\n      font-size: 12px;\n    }\n    .stch-settings-hint::before { content: "* "; }\n    .stch-settings-hint-block { margin-top: 4px; }\n    .stch-primary-label { color: #fff !important; font-weight: bold; }\n    .stch-foil-mode-label {\n      color: #d9a4e8;\n      font-weight: bold;\n    }\n    .stch-foil-mode-label input {\n      accent-color: #b75ac7;\n    }\n    .stch-foil-mode-label.active {\n      color: #f0c4f7;\n      text-shadow: 0 0 10px rgba(207, 115, 201, 0.35);\n    }\n    .stch-control-disabled {\n      color: #687682 !important;\n      font-weight: normal !important;\n    }\n    .stch-control-disabled .stch-input,\n    .stch-input:disabled {\n      color: #687682;\n      background: #111a25;\n      border-color: #2f3f51;\n      cursor: not-allowed;\n      opacity: 0.75;\n    }\n    .stch-foil-mode-label.disabled {\n      color: #7d6685;\n      text-shadow: none;\n      cursor: not-allowed;\n    }\n\n    .stch-status-text { color: #8db7d7; font-size: 13px; padding: 6px 0; min-height: 20px; }\n\n    .stch-tabs {\n      display: flex;\n      gap: 2px;\n      margin-bottom: 10px;\n      border-bottom: 1px solid #45556b;\n    }\n    .stch-tab {\n      padding: 6px 16px;\n      background: rgba(0,0,0,0.3);\n      color: #8f98a0;\n      cursor: pointer;\n      border-radius: 3px 3px 0 0;\n      font-size: 14px;\n      user-select: none;\n    }\n    .stch-tab:hover { color: #fff; background: rgba(103,193,245,0.1); }\n    .stch-tab.active { color: #fff; background: #1b2838; border: 1px solid #45556b; border-bottom-color: #1b2838; }\n    .stch-tab-disabled { color: #555; cursor: not-allowed; opacity: 0.5; pointer-events: none; }\n    .stch-tab-right { margin-left: auto; }\n    .stch-tab-content { display: none; position: relative; }\n    .stch-tab-content.active { display: flex; flex-direction: column; flex: 1; min-height: 0; }\n\n    .stch-onboarding {\n      position: absolute;\n      inset: 0;\n      z-index: 10;\n      display: flex;\n      flex-direction: column;\n      overflow-y: auto;\n      background: #1b2838;\n      padding: 24px 28px;\n    }\n    .stch-onboarding h3 {\n      margin: 0 0 8px;\n      color: #fff;\n      font-size: 22px;\n    }\n    .stch-onboarding-intro {\n      margin: 0 0 20px;\n      color: #8db7d7;\n      line-height: 1.7;\n    }\n    .stch-onboarding-step {\n      padding: 12px 0;\n      border-top: 1px solid #2a3f5a;\n      line-height: 1.65;\n    }\n    .stch-onboarding-step b {\n      display: block;\n      margin-bottom: 2px;\n      color: #fff;\n      font-size: 15px;\n    }\n    .stch-onboarding-note {\n      margin-top: 8px;\n      padding: 10px 12px;\n      border-left: 3px solid #ffc902;\n      background: rgba(0,0,0,0.2);\n      color: #c6d4df;\n      line-height: 1.6;\n    }\n    .stch-onboarding-actions {\n      display: flex;\n      justify-content: flex-end;\n      margin-top: auto;\n      padding-top: 20px;\n    }\n\n    .stch-bl-form {\n      display: flex;\n      gap: 10px;\n      align-items: center;\n      margin-bottom: 10px;\n      flex-wrap: wrap;\n    }\n    .stch-bl-list {\n      flex: 1;\n      min-height: 0;\n      overflow-y: auto;\n      border: 1px solid #2a3f5a;\n      border-radius: 3px;\n      background: rgba(0,0,0,0.2);\n    }\n    .stch-bl-row {\n      padding: 6px 14px;\n      border-bottom: 1px solid rgba(69,85,107,0.4);\n      display: flex;\n      align-items: center;\n      gap: 12px;\n      font-size: 14px;\n    }\n    .stch-bl-row:hover { background: rgba(103,193,245,0.08); }\n    .stch-bl-row .stch-bl-id { width: 70px; color: #66c0f4; font-family: monospace; }\n    .stch-bl-row .stch-bl-name { flex: 1; color: #e2e2e2; }\n    .stch-bl-row .stch-bl-source { width: 50px; color: #8f98a0; font-size: 12px; text-align: center; }\n    .stch-bl-row .stch-bl-fixed-col { width: 40px; color: #75b022; font-size: 12px; text-align: center; }\n    .stch-bl-row .stch-bl-days { width: 45px; color: #8f98a0; font-size: 12px; text-align: center; }\n    .stch-bl-row .stch-bl-cb-hd { width: 24px; flex-shrink: 0; text-align: center; }\n    .stch-bl-cb { cursor: pointer; accent-color: #75b022; }\n    .stch-bl-count { color: #8f98a0; font-size: 12px; margin-top: 6px; }\n    .stch-bl-sep { color: #45556b; font-size: 12px; margin: 4px 0; padding-left: 8px; }\n    .stch-bl-fixed { color: #75b022; }\n\n    .stch-bl-result { color: #75b022; font-size: 14px; }\n\n    .stch-log-resizer {\n      flex: 0 0 9px;\n      height: 9px;\n      margin: 6px 0 4px;\n      cursor: row-resize;\n      position: relative;\n      border-radius: 3px;\n    }\n    .stch-log-resizer::before {\n      content: "";\n      position: absolute;\n      left: 0;\n      right: 0;\n      top: 4px;\n      height: 1px;\n      background: #45556b;\n    }\n    .stch-log-resizer::after {\n      content: "";\n      position: absolute;\n      left: 50%;\n      top: 2px;\n      width: 42px;\n      height: 5px;\n      transform: translateX(-50%);\n      border-top: 1px solid #66c0f4;\n      border-bottom: 1px solid #66c0f4;\n      opacity: 0.55;\n    }\n    .stch-log-resizer:hover,\n    .stch-log-resizer.dragging {\n      background: rgba(103, 193, 245, 0.08);\n    }\n    body.stch-log-resizing {\n      cursor: row-resize;\n      user-select: none;\n    }\n\n    #stch-log,\n    #stch-craft-log,\n    #stch-seasonal-log,\n    #stch-surplus-log,\n    #stch-grind-log {\n      margin-top: 0;\n      flex: 1;\n      min-height: 0;\n      overflow-y: auto;\n      background: #0e1621;\n      border-radius: 3px;\n      padding: 10px;\n      font-family: "Courier New", monospace;\n      font-size: 13px;\n      line-height: 1.5;\n      color: #b0c3d9;\n      white-space: pre-wrap;\n      word-break: break-all;\n    }\n    #stch-craft-log,\n    #stch-seasonal-log,\n    #stch-surplus-log,\n    #stch-grind-log {\n      flex: 0 0 19vh;\n    }\n    #stch-log .ok, #stch-craft-log .ok, #stch-seasonal-log .ok, #stch-surplus-log .ok, #stch-grind-log .ok { color: #75b022; }\n    #stch-log .warn, #stch-craft-log .warn, #stch-seasonal-log .warn, #stch-surplus-log .warn, #stch-grind-log .warn { color: #ffc902; }\n    #stch-log .warn-ip, #stch-craft-log .warn-ip, #stch-seasonal-log .warn-ip, #stch-surplus-log .warn-ip, #stch-grind-log .warn-ip { color: #fff; }\n    #stch-log .err, #stch-craft-log .err, #stch-seasonal-log .err, #stch-surplus-log .err, #stch-grind-log .err { color: #c04040; }\n    #stch-log .info, #stch-craft-log .info, #stch-seasonal-log .info, #stch-surplus-log .info, #stch-grind-log .info { color: #67c1f5; }\n\n    .stch-progress {\n      height: 20px;\n      background: #0e1621;\n      border-radius: 2px;\n      overflow: hidden;\n      margin: 8px 0;\n      position: relative;\n    }\n    .stch-progress-bar {\n      height: 100%;\n      background: linear-gradient(to right, #75b022, #8ed629);\n      transition: width 0.2s;\n    }\n    .stch-progress-text {\n      position: absolute;\n      inset: 0;\n      text-align: center;\n      font-size: 13px;\n      line-height: 20px;\n      color: #fff;\n    }\n\n    .stch-summary {\n      font-size: 14px;\n      color: #8f98a0;\n      margin: 8px 0;\n      display: flex;\n      align-items: center;\n      gap: 12px;\n    }\n    .stch-summary-text { min-width: 0; }\n    .stch-summary b { color: #fff; }\n\n    #stch-order-dialog-backdrop {\n      position: fixed;\n      inset: 0;\n      z-index: 10020;\n      background: rgba(0,0,0,0.65);\n      display: flex;\n      align-items: center;\n      justify-content: center;\n    }\n    .stch-order-dialog {\n      width: 620px;\n      max-width: 92vw;\n      max-height: 82vh;\n      display: flex;\n      flex-direction: column;\n      background: #1b2838;\n      border: 1px solid #45556b;\n      border-radius: 4px;\n      box-shadow: 0 12px 40px rgba(0,0,0,0.7);\n      color: #c6d4df;\n    }\n    .stch-order-dialog h3 {\n      margin: 0;\n      padding: 14px 16px;\n      color: #fff;\n      font-size: 18px;\n      border-bottom: 1px solid #45556b;\n    }\n    .stch-order-summary {\n      padding: 12px 16px;\n      line-height: 1.7;\n    }\n    .stch-order-summary b { color: #fff; }\n    .stch-order-list {\n      margin: 0 16px;\n      max-height: 42vh;\n      overflow-y: auto;\n      border: 1px solid #2a3f5a;\n      background: #0e1621;\n    }\n    .stch-order-item {\n      display: grid;\n      grid-template-columns: minmax(0, 1fr) 55px 70px;\n      gap: 10px;\n      padding: 7px 10px;\n      border-bottom: 1px solid rgba(69,85,107,0.4);\n      font-size: 12px;\n    }\n    .stch-order-item span:first-child {\n      overflow: hidden;\n      text-overflow: ellipsis;\n      white-space: nowrap;\n    }\n    .stch-processing-dialog-item.sell {\n      grid-template-columns: minmax(0, 1fr) 58px 95px 95px;\n    }\n    .stch-processing-dialog-item.gem {\n      grid-template-columns: minmax(0, 1fr) 115px 78px;\n    }\n    .stch-craft-dialog-item {\n      grid-template-columns: minmax(0, 1fr) 70px 70px 70px;\n    }\n    .stch-order-note {\n      padding: 10px 16px;\n      color: #ffc902;\n      font-size: 12px;\n    }\n    .stch-order-dialog-actions {\n      display: flex;\n      justify-content: flex-end;\n      gap: 10px;\n      padding: 12px 16px;\n      border-top: 1px solid #45556b;\n    }\n';

  // src/globals.js
  var unsafeWindow = typeof globalThis.unsafeWindow !== "undefined" ? globalThis.unsafeWindow : window;
  var $J = unsafeWindow.jQuery || unsafeWindow.$ || window.jQuery || window.$ || null;

  // src/config.js
  var DEFAULT_CONFIG = {
    configVersion: 18,
    threshold: 5,
    requestInterval: 330,
    batchSize: 20,
    batchPause: 53e3,
    showNoResultLogs: false,
    includeDrops: false,
    foilScanMode: false,
    orderCacheDays: 3,
    skipCachedOrderResults: false,
    maxBadgePages: 1,
    blacklist: "",
    blacklistNames: "{}",
    blacklistSources: "{}",
    blacklistDates: "{}",
    blacklistFixed: "{}",
    autoBlackThreshold: 10,
    autoBlackEnabled: false,
    buyMode: "complete5",
    orderPriceSource: "lowest",
    priceAdjustment: 0,
    earlyPricePrediction: true,
    earlyPredictionAutoBlacklist: false,
    craftInterval: 500,
    craftMode: "step",
    seasonalTargetLevel: 40,
    seasonalInterval: 200,
    surplusOnlyMaxed: false,
    surplusOnlyTradable: false,
    surplusCompareGems: false,
    surplusItemMode: "card",
    surplusSellPriceSource: "lowest",
    surplusSellPriceAdjustment: 0,
    grindOnlyRecommended: true,
    grindIncludeSurplusCards: true,
    grindReserveCopies: 1,
    grindIncludePointsShopItems: false
  };
  function loadConfig() {
    const defaults = { ...DEFAULT_CONFIG };
    const currentVersion = defaults.configVersion;
    try {
      const raw = GM_getValue("stch_config", null);
      if (raw) {
        const saved = JSON.parse(raw);
        const merged = { ...defaults, ...saved };
        let pruned = false;
        for (const key of Object.keys(merged)) {
          if (!Object.prototype.hasOwnProperty.call(defaults, key)) {
            delete merged[key];
            pruned = true;
          }
        }
        const savedVersion = Number(saved?.configVersion) || 0;
        if (savedVersion < currentVersion) {
          merged.configVersion = currentVersion;
          saveConfig(merged);
        } else if (pruned) {
          saveConfig(merged);
        }
        return merged;
      }
    } catch (e) {
      console.warn("[STCH] Config load failed:", e);
    }
    return defaults;
  }
  function saveConfig(cfg) {
    GM_setValue("stch_config", JSON.stringify(cfg));
  }

  // src/state.js
  var state = {
    cfg: loadConfig(),
    results: [],
    scanning: false,
    stopRequested: false,
    skipCurrent: false,
    queue: null,
    sortKey: null,
    sortAsc: true,
    selectedResults: /* @__PURE__ */ new Set(),
    bulkActionRunning: false,
    pendingOrderQuantities: /* @__PURE__ */ new Map(),
    highestBuyPrices: /* @__PURE__ */ new Map(),
    craftResults: [],
    craftScanning: false,
    craftActionRunning: false,
    craftStopRequested: false,
    craftQueue: null,
    seasonalActionRunning: false,
    seasonalStopRequested: false,
    surplusResults: [],
    selectedSurplusResults: /* @__PURE__ */ new Set(),
    surplusScanning: false,
    surplusStopRequested: false,
    surplusQueue: null,
    surplusActionRunning: false,
    surplusGemPrice: null,
    grindResults: [],
    selectedGrindResults: /* @__PURE__ */ new Set(),
    grindScanning: false,
    grindStopRequested: false,
    grindQueue: null,
    grindGemPrice: null,
    orderResults: [],
    selectedOrderResults: /* @__PURE__ */ new Set(),
    orderSortKey: "cached",
    orderSortAsc: false,
    orderActionRunning: false,
    blLookupAppid: "",
    blLookupName: ""
  };

  // src/constants.js
  var SEASONAL_BADGE_NAME = "2026 夏季徽章";
  var SEASONAL_BADGE_DEFID = 3094368;
  var SEASONAL_BADGE_MAX_LEVEL = 40;
  var SEASONAL_BADGE_DEFAULT_COST = 1e3;
  var SEASONAL_POINTS_SHOP_URL = "https://store.steampowered.com/points/shop/c/steambadge";
  var SIDEBAR_PINNED_KEY = "stch_sidebar_pinned";
  var SIDEBAR_GEM_PRICE_KEY = "stch_sidebar_gem_price";
  var ORDER_CACHE_KEY = "stch_order_cache";
  var SIDEBAR_GEM_SACK_HASH = "753-Sack of Gems";
  var GEM_SACK_SIZE = 1e3;
  var MARKET_STEAM_FEE_RATE = 0.05;
  var MARKET_PUBLISHER_FEE_RATE = 0.1;
  var EARLY_PREDICTION_MARGIN = 1.05;
  var EARLY_PREDICTION_STAGES = {
    2: { factor: 0.78, highWeight: 0.2 },
    3: { factor: 0.8, highWeight: 0.3 },
    4: { factor: 0.84, highWeight: 0.25 }
  };
  var ONBOARDING_SEEN_KEY = "stch_onboarding_seen";
  var MULTIBUY_DATA_KEY = "stch_multibuy_data";
  var MULTIBUY_DATA_TTL = 5 * 60 * 1e3;
  var MULTIBUY_FILL_TIMEOUT = 3e4;

  // src/utils/badge.js
  function isFoilBadge(value) {
    return typeof value === "boolean" ? value : !!value?.isFoil;
  }
  function isUnlimitedLevelBadge(value) {
    if (!value || typeof value !== "object") return false;
    if (value.isUnlimitedLevelBadge) return true;
    const text = [
      value.appid,
      value.gameName,
      value.badgeName,
      value.metaDescription
    ].filter(Boolean).join(" ");
    return /(?:summer|winter|spring|autumn|fall)\s+sale|steam\s+(?:sale|awards)|(?:夏季|夏日|冬季|秋季|春季|农历新年|春节).{0,8}(?:特卖|促销|徽章)|(?:特卖|促销).{0,8}徽章/i.test(text);
  }
  function getBadgeTargetLevel(value) {
    if (!isFoilBadge(value) && isUnlimitedLevelBadge(value)) {
      return Math.max(0, Number(value.level) || 0) + 5;
    }
    return isFoilBadge(value) ? 1 : 5;
  }
  function getBadgeUrlSuffix(value, options = {}) {
    const params = new URLSearchParams();
    if (isFoilBadge(value)) params.set("border", "1");
    if (options.language) params.set("l", options.language);
    const query = params.toString();
    return query ? `?${query}` : "";
  }
  function getGameCardsUrl(profileUrl, appid, value, options = {}) {
    const base = String(profileUrl || "").replace(/\/+$/, "");
    return `${base}/gamecards/${appid}/${getBadgeUrlSuffix(value, options)}`;
  }
  function getBadgeModeLabel(value) {
    return isFoilBadge(value) ? "闪卡" : "普通卡";
  }

  // src/utils/format.js
  function formatCNY(cents) {
    if (cents == null || isNaN(cents)) return "?";
    return (cents / 100).toFixed(2);
  }
  function formatInt(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("zh-CN") : "—";
  }
  function parseIntLoose(value) {
    const number = parseInt(String(value || "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(number) ? number : 0;
  }
  function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }
  function clampNumber(value, min, max, fallback) {
    const parsed = parseInt(value, 10);
    const usable = Number.isFinite(parsed) ? parsed : fallback;
    return Math.max(min, Math.min(max, usable));
  }
  function decodeHtmlEntities(value) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(value || "");
    return textarea.value;
  }

  // src/utils/steam.js
  function getProfileUrl() {
    const url = unsafeWindow.g_strProfileURL || document.querySelector("#global_actions a.user_avatar")?.href || document.querySelector(".user_avatar[href*='/id/'], .user_avatar[href*='/profiles/']")?.href || null;
    return url ? url.replace(/\/$/, "") : null;
  }
  function getSteamId() {
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
      } catch (_) {
      }
    }
    const profileUrl = getProfileUrl() || "";
    const profileMatch = profileUrl.match(/\/profiles\/(\d{17})(?:\/|$)/);
    if (profileMatch) return profileMatch[1];
    const htmlMatch = document.documentElement.innerHTML.match(/g_steamID\s*=\s*["'](\d{17})["']/);
    return htmlMatch ? htmlMatch[1] : "";
  }
  function isPointsShopPage() {
    return location.hostname === "store.steampowered.com" && location.pathname.startsWith("/points/shop");
  }
  function isInventoryPage() {
    return location.hostname === "steamcommunity.com" && /\/inventory\/?$/i.test(location.pathname);
  }
  function parseSteamIdFromText(text) {
    const direct = String(text || "").match(/(?:g_steamID\s*=\s*["']|"steamid"\s*:\s*")(\d{17})/);
    if (direct) return direct[1];
    return "";
  }
  function parseSteamIdFromProfileUrl(profileUrl) {
    const match = String(profileUrl || "").match(/\/profiles\/(\d{17})(?:\/|$)/);
    return match ? match[1] : "";
  }
  function getMarketMinimumPriceCents() {
    const walletMinimum = Number(unsafeWindow.g_rgWalletInfo?.wallet_market_minimum);
    return Number.isFinite(walletMinimum) && walletMinimum > 0 ? walletMinimum * 3 : 21;
  }
  function getSessionId() {
    if (unsafeWindow.g_sessionID) return unsafeWindow.g_sessionID;
    const match = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  // src/parsers/gamecards.js
  function parseGameCardsHtml(html, appid, isFoil) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    let gameName = "";
    const titleEl = doc.querySelector(".badge_title");
    if (titleEl) {
      gameName = (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent).replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "").replace(/\s*(?:徽章|Badge)\s*$/i, "").trim();
    }
    let level = 0;
    const metaDesc = doc.querySelector('meta[name="Description"]')?.content || "";
    const lm = metaDesc.match(/(?:徽章[（(](\d+)\s*级|Badge\s*\(Level\s*(\d+)\)|Level\s*(\d+)\b)/i);
    if (lm) level = parseInt(lm[1] || lm[2] || lm[3], 10);
    const isUnlimitedLevelBadgeValue = !isFoil && isUnlimitedLevelBadge({
      appid,
      gameName,
      level,
      metaDescription: metaDesc
    });
    const targetLevel = getBadgeTargetLevel({
      isFoil,
      level,
      gameName,
      appid,
      metaDescription: metaDesc,
      isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue
    });
    let dropsRemaining = 0;
    const progressBold = doc.querySelector(".progress_info_bold");
    if (progressBold) {
      const txt = progressBold.textContent;
      const dm = txt.match(/(\d+)\s*card drops?\s*remaining/i) || txt.match(/(\d+)\s*张剩余卡牌掉落/);
      if (dm) dropsRemaining = parseInt(dm[1], 10);
    }
    const cardSetCards = doc.querySelectorAll(".badge_card_set_card");
    const cardList = [];
    cardSetCards.forEach((el, idx) => {
      const titleNode = el.querySelector(".badge_card_set_title");
      if (!titleNode) return;
      const qtyNode = el.querySelector(".badge_card_set_text_qty");
      const owned = qtyNode ? parseInt(qtyNode.textContent.replace(/[()（）\[\]]/g, ""), 10) || 0 : 0;
      let name = titleNode.textContent.trim();
      if (qtyNode) {
        name = name.replace(qtyNode.textContent, "").trim();
      }
      let marketHashName = "";
      const marketLink = el.querySelector('a[href*="/market/listings/"]');
      const href = marketLink?.getAttribute("href") || "";
      const marketMatch = href.match(/\/market\/listings\/\d+\/(.+?)(?:\?|#|$)/);
      if (marketMatch) {
        try {
          marketHashName = decodeURIComponent(marketMatch[1]);
        } catch (_) {
          marketHashName = marketMatch[1];
        }
      }
      cardList.push({ name, owned, marketHashName, idx });
    });
    const multibuyBtn = doc.querySelector('a[href*="multibuy"]');
    if (multibuyBtn) {
      const mbHref = multibuyBtn.getAttribute("href") || "";
      let items = [];
      try {
        const mbUrl = new URL(mbHref, window.location.origin);
        items = mbUrl.searchParams.getAll("items[]");
      } catch (_) {
        const m = mbHref.match(/[?&]items\[\]=([^&]+)/g) || [];
        items = m.map((s) => {
          try {
            return decodeURIComponent(s.replace(/[?&]items\[\]=/, "").replace(/&$/, ""));
          } catch (_2) {
            return s;
          }
        });
      }
      for (let i = 0; i < Math.min(items.length, cardList.length); i++) {
        cardList[i].marketHashName = items[i];
      }
    }
    const toCollect = doc.querySelectorAll(".badge_card_to_collect");
    toCollect.forEach((tc) => {
      const titleNode = tc.querySelector(".badge_card_set_title");
      const marketLink = tc.querySelector('a[href*="/market/listings/"]');
      if (!titleNode || !marketLink) return;
      const name = titleNode.textContent.trim();
      const href = marketLink.getAttribute("href") || "";
      const m = href.match(/\/market\/listings\/\d+\/(.+?)(?:\?|$)/);
      if (!m) return;
      let mhn = "";
      try {
        mhn = decodeURIComponent(m[1]);
      } catch (_) {
        mhn = m[1];
      }
      for (const card of cardList) {
        if (card.name === name && !card.marketHashName) {
          card.marketHashName = mhn;
          break;
        }
      }
    });
    cardList.forEach((card) => {
      if (!card.marketHashName && appid && card.name) {
        card.marketHashName = `${appid}-${card.name}`;
      }
    });
    const totalInSet = cardList.length;
    if (totalInSet === 0) {
      return {
        gameName,
        level,
        isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue,
        totalInSet: 0,
        dropsRemaining,
        cards: cardList,
        need: 0,
        setsToLevel5: 0,
        targetLevel
      };
    }
    const cappedOwned = cardList.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const need = Math.max(0, totalInSet - cappedOwned);
    const setsToLevel5 = Math.max(0, targetLevel - level);
    return {
      gameName,
      level,
      isUnlimitedLevelBadge: isUnlimitedLevelBadgeValue,
      totalInSet,
      dropsRemaining,
      cards: cardList,
      need,
      setsToLevel5,
      targetLevel
    };
  }
  function parseCraftCandidatesHtml(html) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    doc.querySelectorAll(".badge_row").forEach((row) => {
      const craftLink = row.querySelector(
        ".badge_progress_info a.badge_craft_button[href*='/gamecards/']"
      );
      if (!craftLink) return;
      const href = craftLink.getAttribute("href") || "";
      const match = href.match(/\/gamecards\/(\d+)\/?/);
      if (!match) return;
      const appid = match[1];
      const isFoil = /[?&]border=1(?:&|$)/.test(href);
      const key = `${appid}_${isFoil ? 1 : 0}`;
      if (seen.has(key)) return;
      seen.add(key);
      const titleEl = row.querySelector(".badge_title");
      const gameName = (titleEl?.textContent || "").replace(/(?:View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "").trim();
      candidates.push({ appid, isFoil, gameName, href });
    });
    return candidates;
  }
  function parseCraftableGameCardsHtml(html, candidate) {
    const info = parseGameCardsHtml(html, candidate.appid, candidate.isFoil);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const craftButton = doc.querySelector(
      ".gamecard_badge_craftbtn_ctn .badge_craft_button"
    );
    const multicraftButton = doc.querySelector(
      ".gamecard_badge_craftbtn_ctn .badge_craft_button.multicraft"
    );
    const multicraftOnclick = multicraftButton?.getAttribute("onclick") || "";
    const multicraftMatch = multicraftOnclick.match(
      /Profile_CraftGameBadge\([^)]*,\s*(\d+)\s*\)\s*;?\s*$/
    );
    const nativeMaxLevels = multicraftMatch ? Math.max(1, parseInt(multicraftMatch[1], 10) || 1) : craftButton ? 1 : 0;
    const availableSets = info.cards.length > 0 ? Math.min(...info.cards.map((card) => Math.max(0, Number(card.owned) || 0))) : 0;
    const maxCraftable = info.isUnlimitedLevelBadge && nativeMaxLevels > 0 ? availableSets : Math.min(availableSets, nativeMaxLevels);
    return {
      ...candidate,
      gameName: candidate.gameName || info.gameName || "",
      level: info.level,
      cards: info.cards,
      totalInSet: info.totalInSet,
      isUnlimitedLevelBadge: info.isUnlimitedLevelBadge,
      availableSets,
      nativeMaxLevels,
      maxCraftable,
      craftCount: maxCraftable,
      selected: maxCraftable > 0,
      status: maxCraftable > 0 ? "待合成" : "不可合成"
    };
  }

  // src/parsers/price.js
  function parsePrice(str) {
    if (!str) return 0;
    const n = parseFloat(str.replace(/[^0-9.,]/g, "").replace(",", "."));
    return isNaN(n) ? 0 : Math.round(n * 100);
  }
  async function priceCard(marketHashName, queue) {
    try {
      const url = `https://steamcommunity.com/market/priceoverview/?appid=753&currency=23&market_hash_name=${encodeURIComponent(marketHashName)}`;
      const res = await queue.fetch(url);
      const lowestCents = parsePrice(res?.data?.lowest_price);
      const medianCents = parsePrice(res?.data?.median_price);
      const sellCents = lowestCents || medianCents;
      if (!sellCents) {
        return res?.data?.success ? { noPriceData: true, volume: 0 } : null;
      }
      const volume = parseInt(String(res?.data?.volume || "").replace(/[^\d]/g, ""), 10) || 0;
      return {
        lowestSellCents: sellCents,
        medianCents,
        volume,
        estimated: !lowestCents,
        priceSource: lowestCents ? "lowest" : "median"
      };
    } catch (e) {
      return null;
    }
  }
  function predictFullSetLowerBound(cardPrices, totalCards, knownTotalCents) {
    const sampleCount = cardPrices.length;
    const stage = EARLY_PREDICTION_STAGES[sampleCount];
    if (!stage || totalCards <= sampleCount) return null;
    const prices = cardPrices.map((card) => card.lowestCents);
    if (cardPrices.some((card) => card.volume <= 0) || prices.some((price) => !Number.isFinite(price) || price <= 0)) {
      return null;
    }
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    if (maxPrice / minPrice >= 2) return null;
    const representativePrice = minPrice + stage.highWeight * (maxPrice - minPrice);
    const remainingAverage = representativePrice * stage.factor;
    return {
      sampleCount,
      minPrice,
      maxPrice,
      predictedCents: Math.ceil(
        knownTotalCents + (totalCards - sampleCount) * remainingAverage
      )
    };
  }
  function geometricMeanCents(values) {
    const usable = values.filter((value) => Number.isFinite(value) && value > 0);
    if (usable.length === 0) return null;
    const meanLog = usable.reduce((sum, value) => sum + Math.log(value), 0) / usable.length;
    return Math.round(Math.exp(meanLog));
  }
  function estimateMissingLevel5Cost(noPriceCards, cardPrices, setsTo5) {
    const knownUnitPrices = cardPrices.map(
      (price) => Math.max(price.lowestCents, price.medianCents || 0)
    );
    const estimatedUnitCents = geometricMeanCents(knownUnitPrices);
    if (estimatedUnitCents == null) return null;
    const estimatedCostCents = noPriceCards.reduce((sum, card) => {
      const need5 = Math.max(0, setsTo5 - card.owned);
      return sum + estimatedUnitCents * need5;
    }, 0);
    return { estimatedUnitCents, estimatedCostCents };
  }

  // src/services/result-info.js
  function getResultKey(info) {
    return `${info.appid}_${info.isFoil ? 1 : 0}`;
  }
  function getSelectedResults() {
    return state.results.filter((info) => state.selectedResults.has(getResultKey(info)));
  }
  function getSelectedOrderResults() {
    return state.orderResults.filter((info) => state.selectedOrderResults.has(getResultKey(info)));
  }
  async function refreshResultInfo(existing, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("未找到 Profile URL");
    const res = await queue.fetch(
      getGameCardsUrl(profileUrl, existing.appid, existing, { language: "english" })
    );
    if (!res?.text?.includes("badge_card_set_card")) {
      throw new Error("未找到卡牌套组");
    }
    const info = parseGameCardsHtml(res.text, existing.appid, existing.isFoil);
    info.appid = existing.appid;
    info.isFoil = existing.isFoil;
    info.targetLevel = getBadgeTargetLevel(info);
    info.gameName = existing.gameName || info.gameName || "";
    info.cardPrices = [];
    info.cheapestSetCostCents = 0;
    info.fullSetCostCents = 0;
    info.level5CostCents = 0;
    let setCostCents = 0;
    let fullSetCostCents = 0;
    let level5CostCents = 0;
    let minVolume = Infinity;
    const setsToTarget = Math.max(0, info.targetLevel - info.level);
    const noPriceCards = [];
    let failedPriceCount = 0;
    for (const card of info.cards) {
      if (!card.marketHashName) {
        throw new Error(`卡牌“${card.name}”缺少 market hash name`);
      }
      const pk = await priceCard(card.marketHashName, queue);
      if (!pk) {
        failedPriceCount++;
        info.hasEstimated = true;
        continue;
      }
      if (pk.noPriceData) {
        card.priceSource = "none";
        noPriceCards.push(card);
        info.hasEstimated = true;
        continue;
      }
      card.lowestCents = pk.lowestSellCents;
      card.medianCents = pk.medianCents;
      card.volume = pk.volume;
      card.priceSource = pk.priceSource;
      minVolume = Math.min(minVolume, pk.volume);
      if (pk.estimated) {
        info.hasEstimated = true;
        info.hasMedianFallback = true;
      }
      info.cardPrices.push({
        name: card.name,
        lowestCents: pk.lowestSellCents,
        medianCents: pk.medianCents,
        volume: pk.volume,
        marketHashName: card.marketHashName,
        priceSource: pk.priceSource
      });
      const need1 = Math.max(0, 1 - card.owned);
      const need5 = Math.max(0, setsToTarget - card.owned);
      setCostCents += pk.lowestSellCents * need1;
      fullSetCostCents += pk.lowestSellCents;
      level5CostCents += need5 > 0 ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents) : 0;
    }
    if (info.cardPrices.length === 0) {
      throw new Error("Steam 未返回任何可用价格");
    }
    if (noPriceCards.length / info.totalInSet >= 0.5) {
      const formulaEstimate = estimateMissingLevel5Cost(noPriceCards, info.cardPrices, setsToTarget);
      if (formulaEstimate) {
        level5CostCents += formulaEstimate.estimatedCostCents;
        info.hasEstimated = true;
        info.hasFormulaEstimate = true;
        info.formulaEstimatedCards = noPriceCards.length;
        info.formulaEstimateUnitCents = formulaEstimate.estimatedUnitCents;
      }
    }
    info.noPriceDataCount = noPriceCards.length;
    info.failedPriceCount = failedPriceCount;
    info.cheapestSetCostCents = setCostCents;
    info.fullSetCostCents = fullSetCostCents;
    info.level5CostCents = level5CostCents;
    info.minVolume = minVolume === Infinity ? 0 : minVolume;
    info.cheapestSetCNY = formatCNY(setCostCents);
    info.fullSetCNY = formatCNY(fullSetCostCents);
    info.level5CNY = formatCNY(level5CostCents);
    return info;
  }

  // src/services/order-cache.js
  function getOrderCacheDays() {
    const days = Number(state?.cfg?.orderCacheDays ?? DEFAULT_CONFIG.orderCacheDays);
    return Number.isFinite(days) ? Math.max(0, Math.floor(days)) : DEFAULT_CONFIG.orderCacheDays;
  }
  function getOrderCacheAgeDays(cachedAt) {
    const ts = Number(cachedAt) || Date.now();
    return Math.max(0, Math.floor((Date.now() - ts) / 864e5));
  }
  function normalizeOrderResult(info, cachedAt = Date.now()) {
    if (!info?.appid) return null;
    const copy = JSON.parse(JSON.stringify(info));
    copy.appid = String(copy.appid).trim();
    copy.isFoil = !!copy.isFoil;
    copy.targetLevel = getBadgeTargetLevel(copy);
    copy.cachedAt = Number(copy.cachedAt || cachedAt) || cachedAt;
    copy.cards = Array.isArray(copy.cards) ? copy.cards : [];
    copy.cardPrices = Array.isArray(copy.cardPrices) ? copy.cardPrices : [];
    copy.cheapestSetCostCents = Number(copy.cheapestSetCostCents) || 0;
    copy.fullSetCostCents = Number(copy.fullSetCostCents) || 0;
    copy.level5CostCents = Number(copy.level5CostCents) || 0;
    copy.cheapestSetCNY = copy.cheapestSetCNY || formatCNY(copy.cheapestSetCostCents);
    copy.fullSetCNY = copy.fullSetCNY || formatCNY(copy.fullSetCostCents);
    copy.level5CNY = copy.level5CNY || formatCNY(copy.level5CostCents);
    return copy.appid ? copy : null;
  }
  function isOrderCacheFresh(info) {
    return getOrderCacheAgeDays(info?.cachedAt) <= getOrderCacheDays();
  }
  function loadOrderCache() {
    try {
      const raw = GM_getValue(ORDER_CACHE_KEY, "[]");
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
      return parsed.map((item) => normalizeOrderResult(item, item?.cachedAt)).filter(Boolean).filter(isOrderCacheFresh);
    } catch (error) {
      console.warn("[STCH] Order cache load failed:", error);
      return [];
    }
  }
  function saveOrderCache() {
    GM_setValue(
      ORDER_CACHE_KEY,
      JSON.stringify(state.orderResults.map((item) => normalizeOrderResult(item, item.cachedAt)).filter(Boolean))
    );
  }
  function clearOrderCache() {
    state.orderResults = [];
    state.selectedOrderResults = /* @__PURE__ */ new Set();
    state.pendingOrderQuantities = /* @__PURE__ */ new Map();
    state.highestBuyPrices = /* @__PURE__ */ new Map();
    saveOrderCache();
  }
  function pruneOrderCache(persist = false) {
    const before = state.orderResults.length;
    state.orderResults = state.orderResults.map((item) => normalizeOrderResult(item, item?.cachedAt)).filter(Boolean).filter(isOrderCacheFresh);
    if (persist && state.orderResults.length !== before) {
      saveOrderCache();
      state.selectedOrderResults.forEach((key) => {
        if (!state.orderResults.some((item) => getResultKey(item) === key)) {
          state.selectedOrderResults.delete(key);
        }
      });
    }
    return before - state.orderResults.length;
  }
  function getCachedOrderResult(info) {
    pruneOrderCache(true);
    const key = getResultKey(info);
    return state.orderResults.find((item) => getResultKey(item) === key) || null;
  }
  function upsertOrderResult(info, options = {}) {
    const item = normalizeOrderResult(info, options.cachedAt || Date.now());
    if (!item) return null;
    item.cachedAt = options.cachedAt || Date.now();
    pruneOrderCache(false);
    const key = getResultKey(item);
    const index = state.orderResults.findIndex((existing) => getResultKey(existing) === key);
    if (index >= 0) state.orderResults[index] = item;
    else state.orderResults.push(item);
    if (options.select) state.selectedOrderResults.add(key);
    saveOrderCache();
    return item;
  }
  function removeOrderResultByKey(key, options = {}) {
    const before = state.orderResults.length;
    state.orderResults = state.orderResults.filter((item) => getResultKey(item) !== key);
    state.selectedOrderResults.delete(key);
    if (state.orderResults.length !== before) {
      if (options.persist !== false) saveOrderCache();
    }
  }
  function readRawOrderCache() {
    try {
      const raw = GM_getValue(ORDER_CACHE_KEY, "[]");
      const parsed = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.map((item) => normalizeOrderResult(item, item?.cachedAt)).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  function getExpiredOrderCacheCount() {
    return readRawOrderCache().filter((item) => !isOrderCacheFresh(item)).length;
  }

  // src/request/queue.js
  var RequestQueue = class {
    constructor(interval = 330, batchSize = 20, batchPause = 53e3, state2 = null, onStatus = null, onLog = null) {
      this.interval = interval;
      this.batchSize = batchSize;
      this.batchPause = batchPause;
      this.state = state2;
      this.onStatus = onStatus;
      this.onLog = onLog;
      this.queue = [];
      this.running = false;
      this.stopped = false;
      this._consecutive429 = 0;
      this._429Warned = false;
      this._reqCount = 0;
    }
    async fetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.stopped) {
          reject({ status: 0, error: "stopped" });
          return;
        }
        this.queue.push({ url, options, resolve, reject });
        this._run();
      });
    }
    _cfgNumber(key, fallback, min = 0) {
      const value = Number(this.state?.cfg?.[key]);
      if (!Number.isFinite(value)) return fallback;
      return Math.max(min, value);
    }
    _priceInterval() {
      return this._cfgNumber("requestInterval", this.interval, 0);
    }
    _batchSizeLimit() {
      return Math.max(1, Math.floor(this._cfgNumber("batchSize", this.batchSize, 1)));
    }
    _batchPauseMs() {
      return this._cfgNumber("batchPause", this.batchPause, 0);
    }
    _sleepShouldStop() {
      return this.stopped || this.state?.stopRequested || this.state?.skipCurrent || this.state?.craftStopRequested || this.state?.surplusStopRequested || this.state?.seasonalStopRequested || this.state?.grindStopRequested;
    }
    async _sleep(ms) {
      const endAt = Date.now() + Math.max(0, ms);
      while (Date.now() < endAt) {
        if (this._sleepShouldStop()) {
          return false;
        }
        await new Promise(
          (resolve) => setTimeout(resolve, Math.min(250, endAt - Date.now()))
        );
      }
      return true;
    }
    async _sleepWithCountdown(ms, labelFactory) {
      const endAt = Date.now() + Math.max(0, ms);
      let lastSeconds = null;
      while (Date.now() < endAt) {
        if (this._sleepShouldStop()) {
          return false;
        }
        const remainingMs = Math.max(0, endAt - Date.now());
        const seconds = Math.max(1, Math.ceil(remainingMs / 1e3));
        if (seconds !== lastSeconds && this.onStatus) {
          lastSeconds = seconds;
          this.onStatus(labelFactory(seconds), false);
        }
        await new Promise(
          (resolve) => setTimeout(resolve, Math.min(250, remainingMs))
        );
      }
      return true;
    }
    async _run() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.queue.length > 0 && !this.stopped) {
          const job = this.queue.shift();
          const isPriceOverview = job.url.includes("/market/priceoverview/");
          const requestStartedAt = Date.now();
          try {
            const res = await window.fetch(job.url, {
              credentials: "include",
              ...job.options
            });
            if (res.status === 429) {
              this._consecutive429++;
              this._reqCount = 0;
              const pauseMs = this._batchPauseMs();
              if (this._consecutive429 >= 3 && !this._429Warned && this.onLog) {
                this._429Warned = true;
                this.onLog("Steam 可能已临时限制此 IP 访问价格 API；建议等待至少半小时或者更换 IP 后再继续", "warn-ip");
              }
              await this._sleepWithCountdown(
                pauseMs,
                (seconds) => `429 限流冷却中 (第${this._consecutive429}次, ${seconds}s)`
              );
              if (this.state?.skipCurrent) {
                job.reject({ status: 429, error: "skipped by user" });
                continue;
              }
              if (this.state?.stopRequested || this.state?.craftStopRequested || this.state?.surplusStopRequested || this.state?.seasonalStopRequested || this.state?.grindStopRequested || this.stopped) {
                job.reject({ status: 0, error: "stopped" });
                continue;
              }
              this.queue.unshift(job);
              continue;
            }
            this._consecutive429 = 0;
            if (isPriceOverview && this.onStatus) {
              this.onStatus("扫描卡牌价格中", true);
            }
            if (res.status >= 500) {
              await this._sleep(this._priceInterval() * 3);
            }
            const text = await res.text();
            let data = null;
            try {
              data = JSON.parse(text);
            } catch (_) {
            }
            if (!res.ok) {
              job.reject({ status: res.status, text, data });
            } else {
              job.resolve({ status: res.status, text, data });
            }
          } catch (e) {
            job.reject({ error: e?.message || String(e) });
          }
          if (isPriceOverview) {
            this._reqCount++;
            if (this._reqCount >= this._batchSizeLimit()) {
              this._reqCount = 0;
              const pauseMs = this._batchPauseMs();
              await this._sleepWithCountdown(
                pauseMs,
                (seconds) => `主动冷却中 (${seconds}s)`
              );
              continue;
            }
            const elapsed = Date.now() - requestStartedAt;
            await this._sleep(Math.max(0, this._priceInterval() - elapsed));
          }
        }
      } finally {
        this.running = false;
      }
      if (this.queue.length > 0 && !this.stopped) this._run();
    }
    stop() {
      this.stopped = true;
      for (const job of this.queue) {
        if (job.reject) job.reject({ status: 0, error: "stopped" });
      }
      this.queue = [];
    }
    clear() {
      this.queue = [];
    }
  };

  // src/services/badge-pages.js
  async function scanBadgePages(cfg, onProgress, queue) {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("Profile URL not found");
    const curUrl = new URL(window.location.href);
    const curSort = curUrl.searchParams.get("sort") || "p";
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const perPage = 150;
    const scanModeLabel = cfg.foilScanMode ? "闪卡" : "普通卡";
    for (let page = 1; page <= cfg.maxBadgePages; page++) {
      const rangeStart = (page - 1) * perPage + 1;
      const rangeEnd = page * perPage;
      onProgress?.(`正在扫描${scanModeLabel}候选徽章 ${rangeStart}-${rangeEnd} (页${page})...`);
      const url = `${profileUrl}/badges/?sort=${curSort}&p=${page}`;
      const res = await queue.fetch(url);
      if (!res || !res.text) {
        if (page === 1) throw new Error(`Failed to fetch badges: ${res?.status}`);
        break;
      }
      const doc = new DOMParser().parseFromString(res.text, "text/html");
      const rows = doc.querySelectorAll(".badge_row");
      const actualEnd = Math.min(rangeEnd, rangeStart + rows.length - 1);
      if (rows.length === 0) break;
      let pageCandidateCount = 0;
      for (const row of rows) {
        const overlay = row.querySelector(".badge_row_overlay");
        if (!overlay) continue;
        const href = overlay.getAttribute("href") || "";
        const m = href.match(/\/(?:gamecards|badges)\/(\d+)\/?(\?|$)/);
        if (!m) continue;
        const appid = m[1];
        const sourceIsFoil = href.includes("border=1");
        if (!cfg.foilScanMode && sourceIsFoil) continue;
        const isFoil = cfg.foilScanMode || sourceIsFoil;
        const key = `${appid}_${isFoil ? 1 : 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const progressEl = row.querySelector(".badge_progress_info");
        if (!progressEl) continue;
        const progressText = progressEl.textContent.trim();
        const countMatch = progressText.match(/(\d+)\s*\/\s*(\d+)/);
        if (!countMatch) continue;
        const owned = parseInt(countMatch[1], 10);
        const totalInSet = parseInt(countMatch[2], 10);
        if (!cfg.foilScanMode && (owned === 0 || owned >= totalInSet)) continue;
        const titleEl = row.querySelector(".badge_title");
        let gameName = "";
        if (titleEl) {
          gameName = (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent).replace(/(?:View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "").trim();
        }
        let dropsRemaining = 0;
        const dropsEl = row.querySelector(".progress_info_bold");
        if (dropsEl) {
          const dt = dropsEl.textContent;
          const dm = dt.match(/(\d+)\s*(?:张剩余卡牌掉落|card drops? remaining)/i);
          if (dm) dropsRemaining = parseInt(dm[1], 10);
        }
        candidates.push({ appid, isFoil, gameName, owned, totalInSet, dropsRemaining });
        pageCandidateCount++;
      }
      onProgress?.(`徽章 ${rangeStart}-${actualEnd}: ${pageCandidateCount} 个${scanModeLabel}候选 (共 ${rows.length} 个徽章)`);
      const nextLink = doc.querySelector(`a.pagebtn[href*="p=${page + 1}"]`);
      if (!nextLink) break;
    }
    onProgress?.(`徽章列表扫描完成, 共 ${candidates.length} 个${scanModeLabel}候选`);
    return candidates;
  }

  // src/utils/dom.js
  function createTextSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = String(text);
    return span;
  }
  function createCheckboxHit(checkbox) {
    const hit = document.createElement("span");
    hit.className = "stch-check-hit";
    hit.appendChild(checkbox);
    return hit;
  }
  function getFirstText(root, selectors) {
    for (const selector of selectors) {
      const text = root.querySelector(selector)?.textContent?.trim();
      if (text) return text;
    }
    return "";
  }
  function getFirstAttr(root, selectors, attr) {
    for (const selector of selectors) {
      const value = root.querySelector(selector)?.getAttribute(attr);
      if (value) return value;
    }
    return "";
  }
  function normalizeResourceUrl(value) {
    const raw = String(value || "").trim().replace(/^url\(["']?/, "").replace(/["']?\)$/, "");
    if (!raw) return "";
    try {
      return new URL(raw, location.origin).href;
    } catch (_) {
      return raw;
    }
  }
  function normalizeSteamAvatarUrl(value) {
    const url = normalizeResourceUrl(value);
    if (!url.includes("avatars.fastly.steamstatic.com/")) return url;
    return url.replace(
      /(?:_(?:medium|full))?(\.[a-z0-9]+)(\?.*)?$/i,
      "_full$1$2"
    );
  }
  function getImageUrlFromElement(element) {
    if (!element) return "";
    const direct = element.getAttribute("src") || element.getAttribute("data-src") || element.getAttribute("data-original") || element.getAttribute("data-fullsrc");
    if (direct) return normalizeSteamAvatarUrl(direct);
    const srcset = element.getAttribute("srcset") || element.getAttribute("data-srcset");
    if (srcset) {
      const candidate = srcset.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean).pop();
      if (candidate) return normalizeSteamAvatarUrl(candidate);
    }
    const bg = element.style?.backgroundImage || "";
    if (bg && bg !== "none") return normalizeSteamAvatarUrl(bg);
    return "";
  }
  function getFirstImageUrl(root, selectors) {
    for (const selector of selectors) {
      const element = root.querySelector(selector);
      const url = getImageUrlFromElement(element);
      if (url) return url;
      const nested = element?.querySelector?.("img");
      const nestedUrl = getImageUrlFromElement(nested);
      if (nestedUrl) return nestedUrl;
    }
    return "";
  }

  // src/features/blacklist.js
  function addToBlacklist(appid, name, source, fixedVal = 0) {
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map((s) => s.trim()).filter(Boolean) : [];
    if (bl.includes(appid)) {
      if (fixedVal) {
        let fixed = {};
        try {
          fixed = JSON.parse(state.cfg.blacklistFixed || "{}");
        } catch (_) {
        }
        fixed[appid] = 1;
        state.cfg.blacklistFixed = JSON.stringify(fixed);
        saveConfig(state.cfg);
      }
      return;
    }
    bl.push(appid);
    state.cfg.blacklist = bl.join(",");
    let names = {};
    try {
      names = JSON.parse(state.cfg.blacklistNames || "{}");
    } catch (_) {
    }
    names[appid] = name;
    state.cfg.blacklistNames = JSON.stringify(names);
    let sources = {};
    try {
      sources = JSON.parse(state.cfg.blacklistSources || "{}");
    } catch (_) {
    }
    sources[appid] = source;
    state.cfg.blacklistSources = JSON.stringify(sources);
    let dates = {};
    try {
      dates = JSON.parse(state.cfg.blacklistDates || "{}");
    } catch (_) {
    }
    dates[appid] = Date.now();
    state.cfg.blacklistDates = JSON.stringify(dates);
    if (fixedVal) {
      let fixed = {};
      try {
        fixed = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
      }
      fixed[appid] = 1;
      state.cfg.blacklistFixed = JSON.stringify(fixed);
    }
    saveConfig(state.cfg);
  }
  async function lookupGameName(appid) {
    try {
      const profileUrl = getProfileUrl();
      if (!profileUrl) return null;
      const url = `${profileUrl}/gamecards/${appid}/`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return null;
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, "text/html");
      const titleEl = doc.querySelector(".badge_title");
      if (titleEl) {
        return (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent).replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "").trim().replace(/\s*徽章\s*$/, "").trim() || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }
  function updateBlRow() {
    const add = document.getElementById("stch-bl-add");
    const addF = document.getElementById("stch-bl-add-fixed");
    const del = document.getElementById("stch-bl-del-sel");
    const fix = document.getElementById("stch-bl-fix-sel");
    const unfix = document.getElementById("stch-bl-unfix-sel");
    if (!add) return;
    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const cbs = [...list ? list.querySelectorAll(".stch-bl-cb:checked") : []];
    if (listFixed) cbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
    const anyChecked = cbs.length > 0;
    const hasNormal = cbs.some((cb) => {
      let fixed = {};
      try {
        fixed = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
      }
      return !fixed[cb.dataset.appid];
    });
    const hasFixed = cbs.some((cb) => {
      let fixed = {};
      try {
        fixed = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
      }
      return !!fixed[cb.dataset.appid];
    });
    add.style.display = state.blLookupName && !anyChecked ? "" : "none";
    addF.style.display = state.blLookupName && !anyChecked ? "" : "none";
    del.style.display = anyChecked ? "" : "none";
    fix.style.display = anyChecked && hasNormal ? "" : "none";
    unfix.style.display = anyChecked && hasFixed ? "" : "none";
    if (anyChecked) {
      del.classList.remove("disabled");
      del.classList.add("stch-btn-danger");
    }
    if (fix.style.display !== "none") fix.classList.remove("disabled");
    if (unfix.style.display !== "none") unfix.classList.remove("disabled");
    if (anyChecked) document.getElementById("stch-bl-result").textContent = "";
  }
  function renderBlacklist() {
    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const countEl = document.getElementById("stch-bl-count");
    if (!list) return;
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map((s) => s.trim()).filter(Boolean) : [];
    let names = {};
    try {
      names = JSON.parse(state.cfg.blacklistNames || "{}");
    } catch (_) {
    }
    let sources = {};
    try {
      sources = JSON.parse(state.cfg.blacklistSources || "{}");
    } catch (_) {
    }
    let dates = {};
    try {
      dates = JSON.parse(state.cfg.blacklistDates || "{}");
    } catch (_) {
    }
    let fixed = {};
    try {
      fixed = JSON.parse(state.cfg.blacklistFixed || "{}");
    } catch (_) {
    }
    const sourceLabels = { "0": "手动", "1": "自动" };
    const normal = bl.filter((a) => !fixed[a]);
    const fixedList = bl.filter((a) => fixed[a]);
    const formatDays = (ts) => {
      if (!ts) return "—";
      return String(Math.floor((Date.now() - ts) / 864e5));
    };
    const createHeader = () => {
      const header = document.createElement("div");
      header.className = "stch-bl-row stch-row-header";
      header.appendChild(createTextSpan("stch-bl-id", "游戏ID"));
      header.appendChild(createTextSpan("stch-bl-name", "游戏名"));
      header.appendChild(createTextSpan("stch-bl-fixed-col", ""));
      header.appendChild(createTextSpan("stch-bl-source", "来源"));
      header.appendChild(createTextSpan("stch-bl-days", "天数"));
      header.appendChild(createTextSpan("stch-bl-cb-hd", ""));
      return header;
    };
    const createPlaceholder = (text) => {
      const row = document.createElement("div");
      row.className = "stch-bl-row";
      const span = createTextSpan("", text);
      span.style.color = "#8f98a0";
      row.appendChild(span);
      return row;
    };
    const appendItems = (target, items) => {
      for (const appid of items) {
        const row = document.createElement("div");
        row.className = "stch-bl-row";
        row.appendChild(createTextSpan("stch-bl-id", appid));
        row.appendChild(createTextSpan("stch-bl-name", names[appid] || "—"));
        row.appendChild(createTextSpan("stch-bl-fixed-col", fixed[appid] ? "固定" : ""));
        row.appendChild(createTextSpan("stch-bl-source", sourceLabels[sources[appid]] || "—"));
        row.appendChild(createTextSpan("stch-bl-days", dates[appid] ? formatDays(dates[appid]) : "—"));
        const checkboxCell = document.createElement("span");
        checkboxCell.className = "stch-bl-cb-hd";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "stch-bl-cb";
        checkbox.dataset.appid = appid;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);
        target.appendChild(row);
      }
    };
    list.replaceChildren();
    if (listFixed) listFixed.replaceChildren();
    if (normal.length === 0 && fixedList.length === 0) {
      list.appendChild(createPlaceholder("游戏/AppID黑名单为空"));
      if (countEl) countEl.textContent = "";
    } else {
      list.appendChild(createHeader());
      if (normal.length > 0) appendItems(list, normal);
      else list.appendChild(createPlaceholder("—"));
      if (countEl) countEl.innerHTML = `共 <b>${bl.length}</b> 项（固定 <b>${fixedList.length}</b>）`;
    }
    if (listFixed && fixedList.length > 0) {
      const separator = createTextSpan("stch-bl-sep", "固定游戏黑名单");
      listFixed.appendChild(separator);
      appendItems(listFixed, fixedList);
    }
    const delBtn = document.getElementById("stch-bl-del-sel");
    if (delBtn) {
      delBtn.classList.add("disabled");
      delBtn.classList.remove("stch-btn-danger");
    }
    const cleanupBtn = document.getElementById("stch-bl-cleanup");
    if (cleanupBtn) {
      cleanupBtn.classList.add("disabled");
      cleanupBtn.classList.remove("stch-btn-danger");
    }
    const allCbs = [...list.querySelectorAll(".stch-bl-cb")];
    if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb"));
    allCbs.forEach((cb) => {
      cb.addEventListener("change", () => {
        const delBtn2 = document.getElementById("stch-bl-del-sel");
        const anyChecked = [...list.querySelectorAll(".stch-bl-cb:checked")].length > 0 || listFixed && [...listFixed.querySelectorAll(".stch-bl-cb:checked")].length > 0;
        if (delBtn2) {
          if (anyChecked) {
            delBtn2.classList.remove("disabled");
            delBtn2.classList.add("stch-btn-danger");
          } else {
            delBtn2.classList.add("disabled");
            delBtn2.classList.remove("stch-btn-danger");
          }
        }
        updateBlRow();
      });
    });
    if (cleanupBtn) {
      const hasExpired = bl.some((a) => !fixed[a] && dates[a] && Date.now() - dates[a] > 7 * 864e5);
      if (hasExpired) {
        cleanupBtn.classList.remove("disabled");
        cleanupBtn.classList.add("stch-btn-danger");
      }
    }
  }

  // src/parsers/market-listing.js
  function parseMarketHashNameFromHref(href) {
    const match = String(href || "").match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }
  function parseMarketOrderbookFromListingHtml(listingHtml, marketHashName) {
    const renderContextMatch = String(listingHtml || "").match(
      /window\.SSR\.renderContext=JSON\.parse\(("(?:\\.|[^"\\])*")\);/
    );
    if (!renderContextMatch) return null;
    try {
      const renderContext = JSON.parse(JSON.parse(renderContextMatch[1]));
      const queryData = JSON.parse(renderContext?.queryData || "{}");
      const queries = Array.isArray(queryData?.queries) ? queryData.queries : [];
      const orderbookQuery = queries.find((query) => {
        const key = query?.queryKey;
        return Array.isArray(key) && key[0] === "market" && key[1] === "orderbook" && String(key[2]) === "753" && key[3] === marketHashName;
      }) || queries.find((query) => {
        const data = query?.state?.data;
        return data && Object.prototype.hasOwnProperty.call(data, "amtMaxBuyOrder");
      });
      const orderbook = orderbookQuery?.state?.data;
      const highestBuyCents = Number(orderbook?.amtMaxBuyOrder);
      const currency = Number(orderbook?.eCurrency);
      if (!Number.isFinite(highestBuyCents) || highestBuyCents < 0) return null;
      return {
        highestBuyCents,
        currency: Number.isFinite(currency) ? currency : null
      };
    } catch (_) {
      return null;
    }
  }
  function getMarketHashNameFromLink(link) {
    const href = link?.getAttribute("href") || link?.href || "";
    const match = href.match(/\/market\/listings\/753\/(.+?)(?:\?|#|$)/);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]);
    } catch (_) {
      return match[1];
    }
  }

  // src/status.js
  function createStatusController({
    tag,
    logId = null,
    statusId = null,
    progressWrapId = null,
    progressBarId = null,
    progressTextId = null
  }) {
    let statusTimer = null;
    function log5(msg, type = "") {
      const box = logId ? document.getElementById(logId) : null;
      if (!box) {
        console.log(`[${tag}]`, msg);
        return;
      }
      const line = document.createElement("div");
      if (type) line.className = type;
      line.textContent = `[${(/* @__PURE__ */ new Date()).toLocaleTimeString()}] ${msg}`;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }
    function setStatus4(text, animate = true) {
      if (!statusId) return;
      const el = document.getElementById(statusId);
      if (!el) return;
      if (statusTimer) {
        clearInterval(statusTimer);
        statusTimer = null;
      }
      if (!text) {
        el.textContent = "";
        el.style.display = "none";
        return;
      }
      el.style.display = "";
      el.textContent = text;
      if (!animate) return;
      let dots = 0;
      statusTimer = setInterval(() => {
        dots = (dots + 1) % 4;
        el.textContent = text + " " + ".".repeat(dots);
      }, 500);
    }
    function setProgress2(done, total, text = "") {
      if (!progressWrapId) return;
      const wrap = document.getElementById(progressWrapId);
      const bar = document.getElementById(progressBarId);
      const label = document.getElementById(progressTextId);
      if (!wrap || !bar || !label) return;
      wrap.style.display = "";
      const pct = total > 0 ? Math.min(100, done / total * 100) : 0;
      bar.style.width = `${pct}%`;
      label.textContent = text || `${done}/${total}`;
    }
    function hideProgress2() {
      if (!progressWrapId) return;
      const wrap = document.getElementById(progressWrapId);
      if (wrap) wrap.style.display = "none";
    }
    return { log: log5, setStatus: setStatus4, setProgress: setProgress2, hideProgress: hideProgress2 };
  }

  // src/status-controllers.js
  var scanStatus = createStatusController({ tag: "STCH", logId: "stch-log", statusId: "stch-status", progressWrapId: "stch-progress-wrap", progressBarId: "stch-progress-bar", progressTextId: "stch-progress-text" });
  var orderStatus = createStatusController({ tag: "STCH Order", statusId: "stch-order-status" });
  var craftStatus = createStatusController({ tag: "STCH Craft", logId: "stch-craft-log", statusId: "stch-craft-status", progressWrapId: "stch-craft-progress-wrap", progressBarId: "stch-craft-progress-bar", progressTextId: "stch-craft-progress-text" });
  var seasonalStatus = createStatusController({ tag: "STCH Seasonal", logId: "stch-seasonal-log", statusId: "stch-seasonal-status", progressWrapId: "stch-seasonal-progress-wrap", progressBarId: "stch-seasonal-progress-bar", progressTextId: "stch-seasonal-progress-text" });
  var surplusStatus = createStatusController({ tag: "STCH Surplus", logId: "stch-surplus-log", statusId: "stch-surplus-status", progressWrapId: "stch-surplus-progress-wrap", progressBarId: "stch-surplus-progress-bar", progressTextId: "stch-surplus-progress-text" });
  var grindStatus = createStatusController({ tag: "STCH Grind", logId: "stch-grind-log", statusId: "stch-grind-status", progressWrapId: "stch-grind-progress-wrap", progressBarId: "stch-grind-progress-bar", progressTextId: "stch-grind-progress-text" });
  function orderLog(msg, type = "") {
    console.log("[STCH][Order]", msg);
    if (["ok", "warn", "err"].includes(type)) {
      orderStatus.setStatus(msg.replace(/^\s*[✓✗]\s*/, ""), false);
    }
  }

  // src/features/multibuy.js
  var { log } = scanStatus;
  function clearMultibuyData() {
    GM_setValue(MULTIBUY_DATA_KEY, null);
  }
  function getMultibuyQuantity(mode, badgeLevel, owned, targetLevel = 5) {
    const maxLevel = Math.max(1, Math.floor(Number(targetLevel) || 5));
    switch (mode) {
      case "complete5":
        return Math.max(0, maxLevel - badgeLevel - owned);
      case "buy1":
        return 1;
      case "buy5":
        return maxLevel;
      default:
        return owned < 1 ? 1 : 0;
    }
  }
  function sameMarketItems(left, right) {
    if (left.length !== right.length) return false;
    const a = [...left].sort();
    const b = [...right].sort();
    return a.every((item, index) => item === b[index]);
  }
  function getMultibuyItemsFromUrl(url) {
    const params = new URL(url).searchParams;
    const repeatedItems = params.getAll("items[]");
    if (repeatedItems.length > 0) return repeatedItems;
    const indexedItems = [];
    for (const [key, value] of params.entries()) {
      const match = key.match(/^items\[(\d+)\]$/);
      if (match) {
        indexedItems.push({ index: Number(match[1]), value });
      }
    }
    indexedItems.sort((a, b) => a.index - b.index);
    return indexedItems.map((item) => item.value);
  }
  function getFieldContext(field) {
    const attributes = [
      field?.name,
      field?.id,
      field?.className,
      field?.getAttribute?.("placeholder"),
      field?.getAttribute?.("aria-label"),
      field?.getAttribute?.("data-field")
    ];
    return attributes.filter(Boolean).join(" ").toLowerCase();
  }
  function findMultibuyFields(row) {
    const steamQuantity = row.querySelector(
      "input.market_multi_quantity, input[name$='_qty'], input[id$='_qty']"
    );
    const steamPrice = row.querySelector(
      "input.market_multi_price, input[name$='_price'], input[id$='_price']"
    );
    if (steamQuantity || steamPrice) {
      return { quantity: steamQuantity, price: steamPrice };
    }
    const fields = [...row.querySelectorAll("input, select")].filter((field) => {
      const type = (field.type || "").toLowerCase();
      return !field.disabled && !["hidden", "button", "submit", "checkbox", "radio"].includes(type);
    });
    const quantityPattern = /qty|quantity|count|数量/;
    const pricePattern = /price|cost|currency|buyorder|金额|价格|单价/;
    const quantity = fields.find((field) => quantityPattern.test(getFieldContext(field))) || null;
    const priceCandidates = fields.filter(
      (field) => field !== quantity && (field.tagName || "").toUpperCase() !== "SELECT"
    );
    let price = priceCandidates.find((field) => pricePattern.test(getFieldContext(field))) || null;
    if (!price) {
      const nestedPriceFields = [...row.querySelectorAll(
        ".market_multibuy_price input, .market_commodity_buyorder_price input, [class*='price'] input"
      )].filter((field) => priceCandidates.includes(field));
      if (nestedPriceFields.length === 1) price = nestedPriceFields[0];
    }
    if (!price && priceCandidates.length === 1) {
      price = priceCandidates[0];
    }
    return { quantity, price };
  }
  function findMultibuyRow(link) {
    const isSingleItemContainer = (node2) => {
      if (!node2?.querySelector("input, select")) return false;
      const listingCount = node2.querySelectorAll?.('a[href*="/market/listings/753/"]').length || 0;
      return listingCount <= 1;
    };
    const preferred = link.closest(
      "tr, .market_multibuy_item, .multibuy_item_row, [class*='multibuy'][class*='item']"
    );
    if (isSingleItemContainer(preferred)) return preferred;
    let node = link.parentElement;
    for (let depth = 0; node && node !== document.body && depth < 8; depth++, node = node.parentElement) {
      if (isSingleItemContainer(node)) return node;
    }
    return null;
  }
  function setMultibuyFieldValue(field, value) {
    if (!field) return false;
    const nextValue = String(value);
    if (field.value === nextValue) return false;
    field.value = nextValue;
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "0" }));
    $J(field).trigger("blur");
    return true;
  }
  function openMultibuy(info) {
    const cardsWithHash = info.cards.filter((c) => c.marketHashName);
    if (cardsWithHash.length === 0) {
      log(`${info.gameName}: 无可用卡牌数据`, "warn");
      return;
    }
    const mode = state.cfg.buyMode || "complete1";
    const params = new URLSearchParams();
    params.set("appid", "753");
    const qtyByCard = [];
    cardsWithHash.forEach((c) => {
      const qty = getMultibuyQuantity(mode, info.level, c.owned, getBadgeTargetLevel(info));
      qtyByCard.push({ card: c, qty });
    });
    const toBuy = qtyByCard.filter((q) => q.qty > 0);
    if (toBuy.length === 0) {
      log(`${info.gameName}: 当前模式下无需购买卡牌`, "info");
      return;
    }
    toBuy.forEach((q) => {
      params.append("items[]", q.card.marketHashName);
      params.append("qty[]", String(q.qty));
    });
    const profileUrl = getProfileUrl();
    if (profileUrl) {
      params.set("steamdb_return_to", `${profileUrl}/gamecards/${info.appid}/${getBadgeUrlSuffix(info)}`);
    }
    const adjustmentInput = document.getElementById("stch-price-adjustment");
    const adjustmentValue = adjustmentInput ? parseFloat(adjustmentInput.value) : state.cfg.priceAdjustment;
    const bufferCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const buyData = {
      appid: info.appid,
      isFoil: !!info.isFoil,
      gameName: info.gameName,
      bufferCents,
      createdAt: Date.now(),
      items: toBuy.map((q) => q.card.marketHashName),
      cards: toBuy.map((q) => ({
        marketHashName: q.card.marketHashName,
        lowestCents: q.card.priceSource === "lowest" && Number.isFinite(q.card.lowestCents) && q.card.lowestCents > 0 ? q.card.lowestCents : null,
        name: q.card.name,
        qty: q.qty
      }))
    };
    GM_setValue(MULTIBUY_DATA_KEY, JSON.stringify(buyData));
    const multibuyUrl = `https://steamcommunity.com/market/multibuy?${params.toString()}`;
    const totalQty = toBuy.reduce((s, q) => s + q.qty, 0);
    log(`${info.gameName}: 打开批量购买 (${totalQty} 张, 模式: ${mode})`, "ok");
    window.open(multibuyUrl, "_blank");
  }
  function initMultibuyAutoFill() {
    let data;
    try {
      const raw = GM_getValue(MULTIBUY_DATA_KEY, null);
      if (!raw) return;
      data = JSON.parse(raw);
    } catch (_) {
      clearMultibuyData();
      return;
    }
    const currentItems = getMultibuyItemsFromUrl(window.location.href);
    const storedItems = Array.isArray(data?.items) ? data.items : [];
    const sameItems = sameMarketItems(currentItems, storedItems);
    const isFresh = Number.isFinite(data?.createdAt) && Date.now() - data.createdAt <= MULTIBUY_DATA_TTL;
    if (!data || !Array.isArray(data.cards) || data.cards.length === 0 || !sameItems || !isFresh) {
      console.warn("[STCH] Ignoring stale or mismatched multibuy data", {
        currentItems,
        storedItems,
        isFresh
      });
      clearMultibuyData();
      return;
    }
    const bufferCents = data.bufferCents || 0;
    const injectResetBtn = () => {
      const heading = document.querySelector("h2, h1, .market_multibuy_header, .pageheader");
      if (heading && !document.getElementById("stch-reset-btn")) {
        const btn = document.createElement("span");
        btn.id = "stch-reset-btn";
        btn.textContent = "恢复默认价格";
        btn.style.cssText = "margin-left:12px;padding:4px 12px;background:rgba(67,137,179,0.85);color:#fff;border-radius:3px;cursor:pointer;font-size:13px;";
        btn.addEventListener("click", () => {
          location.reload();
        });
        heading.appendChild(btn);
      }
    };
    injectResetBtn();
    const cardsByHash = new Map(data.cards.map((card) => [card.marketHashName, card]));
    const filledCards = /* @__PURE__ */ new Set();
    const warnedCards = /* @__PURE__ */ new Set();
    let finished = false;
    let completionTimer = null;
    let deadlineTimer = null;
    let observer = null;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (completionTimer) clearTimeout(completionTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      clearMultibuyData();
      observer?.disconnect();
    };
    const tryFill = () => {
      if (finished) return;
      let changed = false;
      const listingLinks = document.querySelectorAll('a[href*="/market/listings/753/"]');
      listingLinks.forEach((listingLink) => {
        const marketHashName = getMarketHashNameFromLink(listingLink);
        if (filledCards.has(marketHashName)) return;
        const card = cardsByHash.get(marketHashName);
        if (!card) return;
        const row = findMultibuyRow(listingLink);
        if (!row) return;
        const { quantity, price } = findMultibuyFields(row);
        if (!price) {
          if (!warnedCards.has(marketHashName)) {
            warnedCards.add(marketHashName);
            console.warn(`[STCH] Price input not found for ${marketHashName}`);
          }
          return;
        }
        if (card.lowestCents > 0) {
          changed = setMultibuyFieldValue(
            price,
            (Math.max(getMarketMinimumPriceCents(), card.lowestCents + bufferCents) / 100).toFixed(2)
          ) || changed;
        }
        if (quantity) {
          changed = setMultibuyFieldValue(quantity, card.qty || 1) || changed;
        }
        filledCards.add(marketHashName);
      });
      if (changed && typeof unsafeWindow.UpdateOrderTotal === "function") {
        unsafeWindow.UpdateOrderTotal();
      }
      if (filledCards.size === data.cards.length && !completionTimer) {
        completionTimer = setTimeout(() => {
          tryFill();
          finish();
        }, 750);
      }
    };
    let pollCount = 0;
    const poll = () => {
      tryFill();
      if (finished) return;
      if (++pollCount >= MULTIBUY_FILL_TIMEOUT / 500) {
        finish();
        return;
      }
      setTimeout(poll, 500);
    };
    setTimeout(poll, 600);
    observer = new MutationObserver(() => {
      if (!finished) tryFill();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    deadlineTimer = setTimeout(finish, MULTIBUY_FILL_TIMEOUT);
  }

  // src/ui/action-state.js
  function getSurplusProcessingMode() {
    const value = document.getElementById("stch-surplus-item-mode")?.value || state.cfg.surplusItemMode || "card";
    return ["card", "background", "emoticon"].includes(value) ? value : "card";
  }
  function updateSurplusProcessingActionState() {
    const mode = getSurplusProcessingMode();
    const selectedCount = mode === "card" ? state.selectedSurplusResults?.size || 0 : state.selectedGrindResults?.size || 0;
    const selectedLabel = document.getElementById("stch-surplus-selected-count");
    if (selectedLabel) selectedLabel.textContent = `选择 ${selectedCount} 项`;
    const list = document.getElementById(mode === "card" ? "stch-surplus-list" : "stch-grind-list");
    const visibleTiles = list ? [...list.querySelectorAll(".stch-inv-tile")] : [];
    const selectedVisibleCount = visibleTiles.filter((tile) => tile.classList.contains("selected")).length;
    const allVisibleSelected = visibleTiles.length > 0 && selectedVisibleCount === visibleTiles.length;
    const selectAll = document.getElementById("stch-surplus-select-all-btn");
    if (selectAll) {
      selectAll.textContent = allVisibleSelected ? "取消全选" : "全选";
      selectAll.classList.toggle("disabled", visibleTiles.length === 0 || isSharedActionBusy());
    }
    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-surplus-sell-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-surplus-gem-btn")?.classList.toggle("disabled", disabled);
    ["stch-surplus-sell-price-source", "stch-surplus-sell-adjustment"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = isSharedActionBusy();
    });
  }
  function updateSeasonalActionState() {
    const seasonalBusy = state.seasonalActionRunning;
    const otherBusy = state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning;
    const plan = (() => {
      const targetLevel = clampNumber(
        document.getElementById("stch-seasonal-target")?.value,
        1,
        SEASONAL_BADGE_MAX_LEVEL,
        state.cfg.seasonalTargetLevel
      );
      return { levels: Math.max(0, targetLevel) };
    })();
    document.getElementById("stch-seasonal-buy-btn")?.classList.toggle(
      "disabled",
      seasonalBusy || otherBusy || plan.levels <= 0
    );
    document.getElementById("stch-seasonal-stop-btn")?.classList.toggle(
      "disabled",
      !seasonalBusy
    );
    [
      "stch-seasonal-target"
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = seasonalBusy || otherBusy;
    });
  }
  function updateCraftActionState() {
    const craftBusy = state.craftScanning || state.craftActionRunning;
    const otherBusy = state.scanning || state.bulkActionRunning || state.orderActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning;
    const hasResults = state.craftResults.length > 0;
    const hasPlan = state.craftResults.some((r) => r.selected && r.maxCraftable > 0 && (state.cfg.craftMode === "max" ? r.maxCraftable : parseInt(r.craftCount, 10) || 0) > 0);
    document.getElementById("stch-craft-scan-btn")?.classList.toggle(
      "disabled",
      craftBusy || otherBusy
    );
    document.getElementById("stch-craft-stop-btn")?.classList.toggle(
      "disabled",
      !craftBusy
    );
    ["stch-craft-one-btn", "stch-craft-max-btn", "stch-craft-clear-btn"].forEach((id) => {
      const modeDisabled = id === "stch-craft-one-btn" && state.cfg.craftMode === "max";
      document.getElementById(id)?.classList.toggle(
        "disabled",
        !hasResults || craftBusy || otherBusy || modeDisabled
      );
    });
    document.getElementById("stch-craft-submit-btn")?.classList.toggle(
      "disabled",
      !hasPlan || craftBusy || otherBusy
    );
    const craftMode = document.getElementById("stch-craft-mode");
    const craftMaxPages = document.getElementById("stch-craft-max-pages");
    if (craftMode) craftMode.disabled = craftBusy || otherBusy;
    if (craftMaxPages) craftMaxPages.disabled = craftBusy || otherBusy;
  }
  function updateSurplusActionState() {
    const surplusBusy = state.surplusScanning;
    const otherBusy = state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.grindScanning;
    document.getElementById("stch-surplus-scan-btn")?.classList.toggle(
      "disabled",
      surplusBusy || otherBusy
    );
    document.getElementById("stch-surplus-stop-btn")?.classList.toggle(
      "disabled",
      !surplusBusy
    );
    const onlyMaxed = document.getElementById("stch-surplus-only-maxed");
    if (onlyMaxed) onlyMaxed.disabled = surplusBusy || otherBusy;
    const compareGems = document.getElementById("stch-surplus-compare-gems");
    if (compareGems) compareGems.disabled = surplusBusy || otherBusy;
    const onlyTradable = document.getElementById("stch-surplus-only-tradable");
    if (onlyTradable) onlyTradable.disabled = surplusBusy || otherBusy;
    const itemMode = document.getElementById("stch-surplus-item-mode");
    if (itemMode) itemMode.disabled = surplusBusy || otherBusy;
    updateSurplusProcessingActionState();
  }
  function updateGrindActionState() {
    const grindBusy = state.grindScanning;
    const otherBusy = state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning;
    document.getElementById("stch-grind-scan-btn")?.classList.toggle(
      "disabled",
      grindBusy || otherBusy
    );
    document.getElementById("stch-grind-stop-btn")?.classList.toggle(
      "disabled",
      !grindBusy
    );
    ["stch-grind-only-recommended", "stch-grind-include-surplus-cards", "stch-grind-reserve-copies", "stch-grind-include-points-shop", "stch-surplus-item-mode"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = grindBusy || otherBusy;
    });
    updateSurplusProcessingActionState();
  }
  function isSharedActionBusy() {
    return state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning;
  }
  function updateBulkActionState() {
    const selectedCount = getSelectedResults().length;
    const countEl = document.getElementById("stch-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;
    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-recalculate-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-submit-orders-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-scan-btn")?.classList.toggle(
      "disabled",
      isSharedActionBusy()
    );
    const selectAll = document.getElementById("stch-result-select-all");
    if (selectAll) {
      selectAll.checked = state.results.length > 0 && selectedCount === state.results.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.results.length;
    }
    updateOrderActionState();
  }
  function updateOrderActionState() {
    const selectedCount = getSelectedOrderResults().length;
    const countEl = document.getElementById("stch-order-selected-count");
    if (countEl) countEl.textContent = `已选择 ${selectedCount} 项`;
    const disabled = selectedCount === 0 || isSharedActionBusy();
    document.getElementById("stch-order-recalculate-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-order-submit-orders-btn")?.classList.toggle("disabled", disabled);
    document.getElementById("stch-order-delete-btn")?.classList.toggle(
      "disabled",
      getExpiredOrderCacheCount() === 0 || isSharedActionBusy()
    );
    document.getElementById("stch-order-add-btn")?.classList.toggle("disabled", isSharedActionBusy());
    const selectAll = document.getElementById("stch-order-select-all");
    if (selectAll) {
      selectAll.checked = state.orderResults.length > 0 && selectedCount === state.orderResults.length;
      selectAll.indeterminate = selectedCount > 0 && selectedCount < state.orderResults.length;
    }
  }
  function updateAllActionStates() {
    updateBulkActionState();
    updateCraftActionState();
    updateSeasonalActionState();
    updateSurplusActionState();
    updateGrindActionState();
    const settingsBusy = isSharedActionBusy();
    ["stch-settings-clear-cache", "stch-settings-reset"].forEach((id) => {
      document.getElementById(id)?.classList.toggle("disabled", settingsBusy);
    });
  }

  // src/ui/render.js
  function setSummary(html) {
    const el = document.getElementById("stch-summary");
    if (el) el.innerHTML = html;
  }
  function setSummaryVisibility(visible) {
    const row = document.getElementById("stch-summary-row");
    if (row) row.style.display = visible ? "" : "none";
  }
  function getResultSourceState(source = "scan") {
    if (source === "order") {
      return {
        results: state.orderResults,
        selected: state.selectedOrderResults,
        sortKey: state.orderSortKey,
        sortAsc: state.orderSortAsc,
        render: renderOrderResults,
        selectAllId: "stch-order-select-all"
      };
    }
    return {
      results: state.results,
      selected: state.selectedResults,
      sortKey: state.sortKey,
      sortAsc: state.sortAsc,
      render: renderResults,
      selectAllId: "stch-result-select-all"
    };
  }
  function sortArrow(key, source = "scan") {
    const sourceState = getResultSourceState(source);
    if (sourceState.sortKey !== key) return "";
    return sourceState.sortAsc ? " ▲" : " ▼";
  }
  function renderHeader(list, options = {}) {
    const source = options.source || "scan";
    const sourceState = getResultSourceState(source);
    const cacheHeader = options.showCacheAge ? `<span class="stch-order-cache-age stch-sortable" data-sort="cached">天数<span class="stch-sort-arrow">${sortArrow("cached", source)}</span></span>` : "";
    const hdr = document.createElement("div");
    hdr.className = "stch-game-row stch-row-header";
    hdr.innerHTML = `
      <span class="stch-appid stch-sortable" data-sort="appid">游戏ID<span class="stch-sort-arrow">${sortArrow("appid", source)}</span></span>
      <span class="stch-name stch-sortable" data-sort="name">游戏名<span class="stch-sort-arrow">${sortArrow("name", source)}</span></span>
      <span class="stch-level stch-sortable" data-sort="level">等级<span class="stch-sort-arrow">${sortArrow("level", source)}</span></span>
      <span class="stch-cards stch-sortable" data-sort="cards">卡牌<span class="stch-sort-arrow">${sortArrow("cards", source)}</span></span>
      <span class="stch-cost stch-sortable" data-sort="cost">单套补全<span class="stch-sort-arrow">${sortArrow("cost", source)}</span></span>
      <span class="stch-full stch-sortable" data-sort="full">单套最低<span class="stch-sort-arrow">${sortArrow("full", source)}</span></span>
      <span class="stch-lv5 stch-sortable" data-sort="lv5">满级估算 <span class="stch-sort-arrow">${sortArrow("lv5", source)}</span><span style="cursor:help;color:#8f98a0;font-size:11px;" title="绿色:近期成交>1，参考性较强&#10;灰色:近期成交=1，参考性不强&#10;红色:近期成交=0，参考性较弱&#10;黄色:Steam返回信息不全，采用 median_price 或公式估算，结果可能偏低">?</span></span>
      <span class="stch-drops stch-sortable" data-sort="drops">掉落<span class="stch-sort-arrow">${sortArrow("drops", source)}</span></span>
      ${cacheHeader}
      <span class="stch-buy">手动购买</span>
      <span class="stch-check"><span class="stch-check-hit"><input id="${sourceState.selectAllId}" class="stch-result-cb" type="checkbox" title="全选"></span></span>
    `;
    hdr.querySelectorAll(".stch-sortable").forEach((sp) => {
      sp.addEventListener("click", () => {
        if (source === "order") sortAndRenderOrder(sp.dataset.sort);
        else sortAndRender(sp.dataset.sort);
      });
    });
    const selectAll = hdr.querySelector(`#${sourceState.selectAllId}`);
    const selectAllCell = selectAll.closest(".stch-check");
    const applySelectAll = (checked) => {
      if (checked) {
        sourceState.results.forEach((info) => sourceState.selected.add(getResultKey(info)));
      } else {
        sourceState.selected.clear();
      }
      sourceState.render();
    };
    selectAll.addEventListener("click", (e) => {
      e.stopPropagation();
      applySelectAll(selectAll.checked);
    });
    selectAllCell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === selectAll) return;
      selectAll.checked = !selectAll.checked;
      applySelectAll(selectAll.checked);
    });
    list.appendChild(hdr);
  }
  function getSortedGameResults(results, sortKey, sortAsc) {
    const sorted = [...results];
    if (!sortKey) return sorted;
    return sorted.sort((a, b) => {
      let va, vb;
      switch (sortKey) {
        case "appid":
          va = +a.appid;
          vb = +b.appid;
          break;
        case "name":
          va = a.gameName || "";
          vb = b.gameName || "";
          break;
        case "level":
          va = a.level;
          vb = b.level;
          break;
        case "cards":
          va = a.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0);
          vb = b.cards.reduce((s, c) => s + Math.min(c.owned, 1), 0);
          break;
        case "cost":
          va = a.cheapestSetCostCents;
          vb = b.cheapestSetCostCents;
          break;
        case "full":
          va = a.fullSetCostCents;
          vb = b.fullSetCostCents;
          break;
        case "lv5":
          va = a.level5CostCents;
          vb = b.level5CostCents;
          break;
        case "drops":
          va = a.dropsRemaining;
          vb = b.dropsRemaining;
          break;
        case "cached":
          va = a.cachedAt || 0;
          vb = b.cachedAt || 0;
          break;
        default:
          return 0;
      }
      if (typeof va === "string") {
        const cmp = va.localeCompare(vb, "zh");
        return sortAsc ? cmp : -cmp;
      }
      return sortAsc ? va - vb : vb - va;
    });
  }
  function getSortedResults() {
    return getSortedGameResults(state.results, state.sortKey, state.sortAsc);
  }
  function getSortedOrderResults() {
    pruneOrderCache(true);
    return getSortedGameResults(state.orderResults, state.orderSortKey, state.orderSortAsc);
  }
  function renderResults() {
    const list = document.getElementById("stch-list");
    if (!list) return;
    list.innerHTML = "";
    if (state.results.length === 0) {
      updateBulkActionState();
      updateResultColumns();
      return;
    }
    renderHeader(list);
    const sorted = getSortedResults();
    sorted.forEach((info) => renderDataRow(list, info));
    updateBulkActionState();
    updateResultColumns();
  }
  function renderOrderResults() {
    const list = document.getElementById("stch-order-list");
    if (!list) return;
    pruneOrderCache(true);
    list.innerHTML = "";
    if (state.orderResults.length === 0) {
      const row = document.createElement("div");
      row.className = "stch-game-row";
      const text = createTextSpan("", "订购卡牌缓存为空。价格扫描结果会实时进入这里，也可以手动输入 AppID。");
      text.style.color = "#8f98a0";
      row.appendChild(text);
      list.appendChild(row);
      setOrderSummaryVisibility(false);
      updateOrderActionState();
      updateOrderResultColumns();
      return;
    }
    renderHeader(list, { source: "order", showCacheAge: true });
    getSortedOrderResults().forEach((info) => {
      renderDataRow(list, info, { source: "order", showCacheAge: true });
    });
    updateOrderSummary();
    setOrderSummaryVisibility(true);
    updateOrderActionState();
    updateOrderResultColumns();
  }
  function sortAndRender(key) {
    if (state.sortKey === key) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = key;
      state.sortAsc = true;
    }
    renderResults();
  }
  function sortAndRenderOrder(key) {
    if (state.orderSortKey === key) {
      state.orderSortAsc = !state.orderSortAsc;
    } else {
      state.orderSortKey = key;
      state.orderSortAsc = key === "cached" ? false : true;
    }
    renderOrderResults();
  }
  function renderDataRow(list, info, options = {}) {
    const source = options.source || "scan";
    const sourceState = getResultSourceState(source);
    const row = document.createElement("div");
    row.className = "stch-game-row";
    row.dataset.appid = info.appid;
    row.dataset.foil = info.isFoil ? 1 : 0;
    const targetLevel = getBadgeTargetLevel(info);
    const ownedCards = info.cards.reduce((sum, c) => sum + Math.min(c.owned, 1), 0);
    const minVol = info.minVolume || 0;
    const lv5Color = info.hasEstimated ? "color:#c9a02c" : minVol > 1 ? "color:#4caf50" : minVol === 1 ? "color:#888" : "";
    const estimateNotes = [];
    if (info.hasFormulaEstimate) {
      estimateNotes.push(
        `Steam返回信息不全：${info.formulaEstimatedCards}张卡牌无价格，使用已知卡牌几何均价 ¥${formatCNY(info.formulaEstimateUnitCents)} 估算`
      );
    }
    if (info.hasMedianFallback) {
      estimateNotes.push("部分卡牌无最低出售价格，使用 median_price 估算");
    }
    const unestimatedCards = Math.max(0, (info.noPriceDataCount || 0) - (info.formulaEstimatedCards || 0)) + (info.failedPriceCount || 0);
    if (unestimatedCards > 0) {
      estimateNotes.push(`${unestimatedCards}张卡牌未计入估算`);
    }
    const lv5Title = estimateNotes.length > 0 ? `${estimateNotes.join("\n")}，结果可能偏低` : minVol > 1 ? "近期成交>1，参考性较强" : minVol === 1 ? "近期成交=1，参考性不强" : "近期成交=0，参考性较弱";
    row.appendChild(createTextSpan("stch-appid", `${info.appid}${info.isFoil ? "(箔)" : ""}`));
    row.appendChild(createTextSpan("stch-name", info.gameName || "(未知)"));
    row.appendChild(createTextSpan("stch-level", `Lv${info.level}/${targetLevel}`));
    row.appendChild(createTextSpan("stch-cards", `${ownedCards}/${info.totalInSet}`));
    row.appendChild(createTextSpan("stch-cost", `¥${info.cheapestSetCNY}`));
    row.appendChild(createTextSpan("stch-full", `¥${info.fullSetCNY}`));
    const lv5 = createTextSpan("stch-lv5", `¥${info.level5CNY}`);
    lv5.style.cssText = lv5Color;
    lv5.title = lv5Title;
    row.appendChild(lv5);
    row.appendChild(createTextSpan("stch-drops", info.dropsRemaining));
    if (options.showCacheAge) {
      const age = createTextSpan("stch-order-cache-age", String(getOrderCacheAgeDays(info.cachedAt)));
      age.title = info.cachedAt ? new Date(info.cachedAt).toLocaleString() : "";
      row.appendChild(age);
    }
    const buyCell = document.createElement("span");
    buyCell.className = "stch-buy";
    const buyLink = document.createElement("a");
    buyLink.href = "javascript:void(0)";
    buyLink.className = "stch-buy-link";
    buyLink.dataset.appid = info.appid;
    buyLink.style.cssText = "text-decoration:underline;color:#66c0f4;cursor:pointer;";
    buyLink.textContent = "购买";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "stch-result-cb";
    checkbox.checked = sourceState.selected.has(getResultKey(info));
    checkbox.title = "选择此游戏进行重新计算或提交订购单";
    buyCell.appendChild(buyLink);
    row.appendChild(buyCell);
    const checkboxCell = document.createElement("span");
    checkboxCell.className = "stch-check";
    checkboxCell.appendChild(createCheckboxHit(checkbox));
    row.appendChild(checkboxCell);
    buyLink.addEventListener("click", (e) => {
      e.stopPropagation();
      openMultibuy(info);
    });
    const applyChecked = (checked) => {
      const key = getResultKey(info);
      if (checked) {
        sourceState.selected.add(key);
      } else {
        sourceState.selected.delete(key);
      }
      if (source === "order") {
        updateOrderSummary();
        updateOrderActionState();
      } else {
        updateBulkActionState();
      }
    };
    checkbox.addEventListener("click", (e) => {
      e.stopPropagation();
      applyChecked(checkbox.checked);
    });
    checkboxCell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === checkbox) return;
      checkbox.checked = !checkbox.checked;
      applyChecked(checkbox.checked);
    });
    row.addEventListener("click", (e) => {
      if (e.target.closest(".stch-buy-link, .stch-result-cb, .stch-check, .stch-check-hit")) return;
      const pUrl = getProfileUrl();
      if (pUrl) window.open(`${pUrl}/gamecards/${info.appid}/${getBadgeUrlSuffix(info)}`, "_blank");
    });
    row.style.cursor = "pointer";
    list.appendChild(row);
  }
  function renderGameRow(info) {
    const list = document.getElementById("stch-list");
    if (list.children.length === 0) renderHeader(list);
    renderDataRow(list, info);
    upsertOrderResult(info);
    renderOrderResults();
    updateBulkActionState();
    updateResultColumns();
  }
  function getAdjustedCompletionCostCents(info) {
    const originalTotal = Math.max(0, Number(info?.cheapestSetCostCents) || 0);
    const adjustmentCents = Math.round((Number(state.cfg.priceAdjustment) || 0) * 100);
    if (adjustmentCents === 0) return originalTotal;
    const minimumCents = getMarketMinimumPriceCents();
    let knownOriginalTotal = 0;
    let knownAdjustedTotal = 0;
    for (const card of Array.isArray(info?.cards) ? info.cards : []) {
      const quantity = Math.max(0, 1 - (Number(card.owned) || 0));
      const basePriceCents = Number(card.lowestCents);
      if (quantity <= 0 || !Number.isFinite(basePriceCents) || basePriceCents <= 0) continue;
      knownOriginalTotal += basePriceCents * quantity;
      knownAdjustedTotal += Math.max(minimumCents, basePriceCents + adjustmentCents) * quantity;
    }
    return Math.max(0, originalTotal - knownOriginalTotal) + knownAdjustedTotal;
  }
  function updateSummary() {
    const summary = document.getElementById("stch-summary");
    if (!summary) return;
    const count = state.results.length;
    const modeLabel = state.results.some((info) => info.isFoil) ? "闪卡" : "普通卡";
    const totalCNY = (state.results.reduce((s, r) => s + getAdjustedCompletionCostCents(r), 0) / 100).toFixed(2);
    const fullCNY = (state.results.reduce((s, r) => s + r.fullSetCostCents, 0) / 100).toFixed(2);
    const lv5CNY = (state.results.reduce((s, r) => s + r.level5CostCents, 0) / 100).toFixed(2);
    summary.innerHTML = `
      共 <b>${count}</b> 个${modeLabel} ≤ ¥${state.cfg.threshold} (单套卡牌价格上限)，补全总价 <b>¥${totalCNY}</b>，全套总价 ¥${fullCNY}，满级总价 ¥${lv5CNY}
    `;
  }
  function setOrderSummaryVisibility(visible) {
    const row = document.getElementById("stch-order-summary-row");
    if (row) row.style.display = visible ? "" : "none";
  }
  function updateOrderSummary() {
    const summary = document.getElementById("stch-order-summary");
    if (!summary) return;
    pruneOrderCache(true);
    const count = state.orderResults.length;
    const selectedCount = getSelectedOrderResults().length;
    const totalCNY = (state.orderResults.reduce((s, r) => s + getAdjustedCompletionCostCents(r), 0) / 100).toFixed(2);
    const fullCNY = (state.orderResults.reduce((s, r) => s + r.fullSetCostCents, 0) / 100).toFixed(2);
    const lv5CNY = (state.orderResults.reduce((s, r) => s + r.level5CostCents, 0) / 100).toFixed(2);
    summary.innerHTML = `
      缓存 <b>${count}</b> 个 · 已选择 <b>${selectedCount}</b> 个 · 补全总价 <b>¥${totalCNY}</b>，全套总价 ¥${fullCNY}，满级总价 ¥${lv5CNY}
    `;
  }
  function updateOrderResultColumns() {
    const showDrops = state.orderResults.some((info) => Number(info.dropsRemaining) > 0);
    document.getElementById("stch-order-list")?.classList.toggle("stch-show-drops", showDrops);
  }

  // src/features/scan.js
  var { log: log2, setStatus, setProgress, hideProgress } = scanStatus;
  function skipCurrentBadge() {
    state.skipCurrent = true;
    log2("跳过当前徽章...", "warn");
  }
  function setScanPhase(phase) {
    const btn = document.getElementById("stch-scan-btn");
    if (!btn) return;
    btn.textContent = "开始扫描";
    switch (phase) {
      case "phase1":
        btn.textContent = "扫描中: 徽章列表";
        break;
      case "phase2":
        btn.textContent = "扫描中: 卡牌详情+查价";
        break;
      case "phase3":
        btn.textContent = "扫描完成";
        break;
      case "scanning":
        btn.textContent = "扫描中...";
        break;
      case "done":
        btn.textContent = "扫描完成";
        break;
    }
  }
  function updateResultColumns() {
    const showDrops = state.cfg.includeDrops && state.results.some((info) => Number(info.dropsRemaining) > 0);
    document.getElementById("stch-list")?.classList.toggle("stch-show-drops", showDrops);
  }
  function applyScanModeTheme() {
    const enabled = !!state.cfg.foilScanMode;
    document.getElementById("stch-tab-scan")?.classList.toggle("stch-foil-mode", enabled);
    const foilLabel = document.getElementById("stch-foil-mode-label");
    const foilInput = document.getElementById("stch-foil-scan-mode");
    const buyMode = document.getElementById("stch-buy-mode");
    const buyModeLabel = document.getElementById("stch-buy-mode-label");
    foilLabel?.classList.toggle("active", enabled);
    foilLabel?.classList.toggle("disabled", state.scanning);
    if (foilInput) foilInput.disabled = !!state.scanning;
    if (buyMode) {
      if (enabled) {
        if (!buyMode.dataset.normalValue && buyMode.value !== "complete1") {
          buyMode.dataset.normalValue = buyMode.value;
        }
        buyMode.value = "complete1";
        buyMode.disabled = true;
      } else {
        buyMode.disabled = false;
        buyMode.value = buyMode.dataset.normalValue || state.cfg.buyMode || DEFAULT_CONFIG.buyMode;
        delete buyMode.dataset.normalValue;
      }
    }
    buyModeLabel?.classList.toggle("stch-control-disabled", enabled);
  }
  async function startScan() {
    if (isSharedActionBusy()) return;
    if (_stopTimeout) {
      clearTimeout(_stopTimeout);
      _stopTimeout = null;
    }
    state.scanning = true;
    state.stopRequested = false;
    state.skipCurrent = false;
    state.results = [];
    state.selectedResults.clear();
    setSummary("");
    setSummaryVisibility(false);
    document.getElementById("stch-list").innerHTML = "";
    document.getElementById("stch-log").innerHTML = "";
    document.getElementById("stch-scan-btn").classList.add("disabled");
    document.getElementById("stch-skip-btn").classList.remove("disabled");
    document.getElementById("stch-stop-btn").classList.remove("disabled");
    updateAllActionStates();
    applyScanModeTheme();
    setScanPhase("scanning");
    setStatus("正在扫描徽章页");
    const cfg = {
      ...state.cfg,
      foilScanMode: !!state.cfg.foilScanMode,
      buyMode: state.cfg.foilScanMode ? "complete1" : state.cfg.buyMode
    };
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setStatus,
      log2
    );
    state.queue = queue;
    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      log2("未找到 Profile URL", "err");
      queue.stop();
      state.scanning = false;
      state.queue = null;
      hideProgress();
      setStatus(null);
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      updateSurplusActionState();
      updateGrindActionState();
      applyScanModeTheme();
      return;
    }
    try {
      const scanModeLabel = getBadgeModeLabel(cfg.foilScanMode);
      log2(`【阶段 1/3】正在扫描徽章页 (${scanModeLabel}模式，找候选游戏)...`);
      setProgress(0, 1, "阶段1: 扫描徽章页列表中...");
      setScanPhase("phase1");
      const badges = await scanBadgePages(cfg, (msg) => log2(msg, "info"), queue);
      if (badges.length === 0) {
        log2(`未找到任何${scanModeLabel}候选徽章`, "warn");
        setStatus(null);
        setScanPhase("done");
        return;
      }
      log2(`找到 ${badges.length} 个${scanModeLabel}候选徽章，开始逐个获取卡牌详情`);
      log2("【阶段 2/3】逐个获取卡牌页 + 查价中...");
      setProgress(0, badges.length, `阶段2: 获取卡牌详情 0/${badges.length}`);
      setScanPhase("phase2");
      setStatus("扫描卡牌价格中");
      let processed = 0;
      let skipped = 0;
      const getThresholdCents = () => Math.round((Number(state.cfg.threshold) || 0) * 100);
      for (const b of badges) {
        if (state.stopRequested) {
          log2("已手动停止", "warn");
          break;
        }
        if (state.skipCurrent) {
          state.skipCurrent = false;
          log2(`[${b.appid}] 跳过 (手动)`, "warn");
          skipped++;
          continue;
        }
        const blAppids = (cfg.blacklist || "").split(",").map((s) => s.trim()).filter(Boolean);
        if (blAppids.includes(String(b.appid))) {
          log2(`[${b.appid}] ${b.gameName || ""}: 在游戏/AppID黑名单中, 跳过`, "info");
          skipped++;
          continue;
        }
        if (cfg.skipCachedOrderResults) {
          const cached = getCachedOrderResult(b);
          if (cached) {
            log2(
              `[${b.appid}] ${b.gameName || cached.gameName || ""}: 订购缓存内已有结果 (${getOrderCacheAgeDays(cached.cachedAt)} 天)，跳过扫描`,
              "info"
            );
            skipped++;
            continue;
          }
        }
        processed++;
        setProgress(
          processed,
          badges.length,
          `阶段2: 获取卡牌详情 ${processed}/${badges.length} · ${b.gameName || b.appid}`
        );
        try {
          const url = getGameCardsUrl(profileUrl, b.appid, b, { language: "english" });
          let res;
          try {
            res = await queue.fetch(url);
          } catch (fetchErr) {
            if (state.stopRequested) {
              log2("已手动停止", "warn");
              break;
            }
            if (state.skipCurrent) {
              state.skipCurrent = false;
              log2("已跳过当前徽章", "warn");
              skipped++;
              continue;
            }
            log2(`[${b.appid}] ${b.gameName || ""}: 拉取 gamecards 网络错误`, "warn");
            skipped++;
            continue;
          }
          if (!res || !res.text) {
            log2(`[${b.appid}] ${b.gameName || ""}: 拉取 gamecards 失败`, "warn");
            skipped++;
            continue;
          }
          if (!res.text.includes("badge_card_set_card")) {
            log2(`[${b.appid}] ${b.gameName || ""}: 无卡牌套组 (可能是社区徽章)`, "info");
            skipped++;
            continue;
          }
          const info = parseGameCardsHtml(res.text, b.appid, b.isFoil);
          info.appid = b.appid;
          info.isFoil = b.isFoil;
          info.targetLevel = getBadgeTargetLevel(info);
          info.gameName = b.gameName || info.gameName || "";
          info.cardPrices = [];
          info.cheapestSetCostCents = 0;
          info.fullSetCostCents = 0;
          info.level5CostCents = 0;
          if (info.totalInSet === 0 || info.need === 0) {
            log2(`[${b.appid}] ${info.gameName}: Lv${info.level}, 套卡完整或无卡牌`, "info");
            skipped++;
            continue;
          }
          if (!state.cfg.includeDrops && info.dropsRemaining > 0) {
            log2(`[${b.appid}] ${info.gameName}: 还有 ${info.dropsRemaining} 张掉落，跳过 (可勾选"包含有掉落"来扫描)`, "info");
            skipped++;
            continue;
          }
          if (info.level >= info.targetLevel) {
            log2(`[${b.appid}] ${info.gameName}: 已满级 Lv${info.level}/${info.targetLevel}`, "info");
            skipped++;
            continue;
          }
          log2(`[${b.appid}] ${info.gameName} ${scanModeLabel} Lv${info.level}/${info.targetLevel} 缺 ${info.need}/${info.totalInSet} 张, 正在查价...`);
          let setCostCents = 0;
          let fullSetCostCents = 0;
          let level5CostCents = 0;
          let minVolume = Infinity;
          const setsToTarget = Math.max(0, info.targetLevel - info.level);
          let allPriced = true;
          let thresholdSkip = false;
          let cancelledCurrent = false;
          const noPriceCards = [];
          let failedPriceCount = 0;
          for (const card of info.cards) {
            if (state.stopRequested || state.skipCurrent) {
              cancelledCurrent = true;
              break;
            }
            if (!card.marketHashName) {
              log2(`  ⚠ 卡牌 "${card.name}" 无 market hash name, 跳过此游戏`, "warn");
              allPriced = false;
              break;
            }
            const pk = await priceCard(card.marketHashName, queue);
            if (!pk) {
              log2(`  ⚠ 卡牌 "${card.name}" (market: ${card.marketHashName}) 查价失败, 跳过此卡`, "warn");
              failedPriceCount++;
              info.hasEstimated = true;
              continue;
            }
            if (pk.noPriceData) {
              log2(`  ⚠ 卡牌 "${card.name}" Steam 仅返回 success，无可用价格`, "warn");
              card.priceSource = "none";
              noPriceCards.push(card);
              info.hasEstimated = true;
              continue;
            }
            card.lowestCents = pk.lowestSellCents;
            card.medianCents = pk.medianCents;
            card.volume = pk.volume;
            card.priceSource = pk.priceSource;
            if (pk.volume < minVolume) minVolume = pk.volume;
            if (pk.estimated) {
              info.hasEstimated = true;
              info.hasMedianFallback = true;
            }
            info.cardPrices.push({
              name: card.name,
              lowestCents: pk.lowestSellCents,
              medianCents: pk.medianCents,
              volume: pk.volume,
              marketHashName: card.marketHashName,
              priceSource: pk.priceSource
            });
            const need1 = Math.max(0, 1 - card.owned);
            const need5 = Math.max(0, setsToTarget - card.owned);
            setCostCents += pk.lowestSellCents * need1;
            fullSetCostCents += pk.lowestSellCents;
            level5CostCents += need5 > 0 ? pk.lowestSellCents + (need5 - 1) * Math.max(pk.lowestSellCents, pk.medianCents) : 0;
            if (fullSetCostCents > getThresholdCents()) {
              log2(`  → 已查${info.cardPrices.length}/${info.totalInSet}张, 全套 ¥${formatCNY(fullSetCostCents)} > ¥${formatCNY(getThresholdCents())}，跳过`, "info");
              allPriced = false;
              thresholdSkip = true;
              break;
            }
            if (state.cfg.earlyPricePrediction) {
              const prediction = predictFullSetLowerBound(
                info.cardPrices,
                info.totalInSet,
                fullSetCostCents
              );
              const predictionLimit = Math.ceil(getThresholdCents() * EARLY_PREDICTION_MARGIN);
              if (prediction && prediction.predictedCents > predictionLimit) {
                const predictionAutoBlacklistCents = Math.round(
                  (state.cfg.autoBlackThreshold || 0) * 100
                );
                const shouldAutoBlacklistPrediction = state.cfg.earlyPredictionAutoBlacklist && state.cfg.autoBlackEnabled && predictionAutoBlacklistCents > 0 && prediction.predictedCents > predictionAutoBlacklistCents;
                log2(
                  `  → 已查${prediction.sampleCount}/${info.totalInSet}张, 保守预测全套≥¥${formatCNY(prediction.predictedCents)} > 安全线¥${formatCNY(predictionLimit)}，提前跳过 (样本¥${formatCNY(prediction.minPrice)}-${formatCNY(prediction.maxPrice)})`,
                  "info"
                );
                if (shouldAutoBlacklistPrediction) {
                  addToBlacklist(b.appid, info.gameName || b.gameName || "", 1);
                  log2(
                    `  → 价格预测自动加入游戏黑名单: 预测全套≥¥${formatCNY(prediction.predictedCents)} > ¥${formatCNY(predictionAutoBlacklistCents)}`,
                    "info"
                  );
                }
                allPriced = false;
                thresholdSkip = true;
                break;
              }
            }
          }
          if (cancelledCurrent) {
            if (state.skipCurrent) {
              state.skipCurrent = false;
              log2(`[${b.appid}] ${info.gameName}: 已跳过当前徽章`, "warn");
              skipped++;
              continue;
            }
            if (state.stopRequested) {
              log2("已手动停止", "warn");
              break;
            }
          }
          if (!allPriced) {
            if (!thresholdSkip) {
              log2(`  → 部分卡牌无法取价, 跳过`, "warn");
            }
            skipped++;
            continue;
          }
          if (info.cardPrices.length === 0) {
            log2(`  → Steam 未返回任何可用价格，无法估算，跳过`, "warn");
            skipped++;
            continue;
          }
          const noPriceRatio = noPriceCards.length / info.totalInSet;
          if (noPriceCards.length > 0 && noPriceRatio >= 0.5) {
            const formulaEstimate = estimateMissingLevel5Cost(
              noPriceCards,
              info.cardPrices,
              setsToTarget
            );
            if (formulaEstimate) {
              level5CostCents += formulaEstimate.estimatedCostCents;
              info.hasEstimated = true;
              info.hasFormulaEstimate = true;
              info.formulaEstimatedCards = noPriceCards.length;
              info.formulaEstimateUnitCents = formulaEstimate.estimatedUnitCents;
              log2(
                `  → ${noPriceCards.length}/${info.totalInSet}张无价格，按已知卡牌几何均价 ¥${formatCNY(formulaEstimate.estimatedUnitCents)} 补充满级估算 ¥${formatCNY(formulaEstimate.estimatedCostCents)}`,
                "warn"
              );
            }
          }
          info.noPriceDataCount = noPriceCards.length;
          info.failedPriceCount = failedPriceCount;
          info.cheapestSetCostCents = setCostCents;
          info.fullSetCostCents = fullSetCostCents;
          info.level5CostCents = level5CostCents;
          info.minVolume = minVolume === Infinity ? 0 : minVolume;
          info.cheapestSetCNY = formatCNY(setCostCents);
          info.fullSetCNY = formatCNY(fullSetCostCents);
          info.level5CNY = formatCNY(level5CostCents);
          const autoBlCents = Math.round((state.cfg.autoBlackThreshold || 0) * 100);
          if (state.cfg.autoBlackEnabled && autoBlCents > 0 && fullSetCostCents > autoBlCents) {
            addToBlacklist(b.appid, info.gameName || b.gameName || "", 1);
            log2(`  → 自动加入游戏黑名单: 全套 ¥${info.fullSetCNY} > ¥${state.cfg.autoBlackThreshold}`, "info");
            skipped++;
            continue;
          }
          if (fullSetCostCents > getThresholdCents()) {
            log2(`  → 整套卡牌价格已大于上限(¥${info.fullSetCNY} > ¥${formatCNY(getThresholdCents())})，跳过`, "info");
            skipped++;
            continue;
          }
          state.results.push(info);
          renderGameRow(info);
          log2(`  ✓ [${b.appid}] ${info.gameName}: 补全 ¥${info.cheapestSetCNY} | 全套 ¥${info.fullSetCNY} | 满级 ¥${info.level5CNY}`, "ok");
        } catch (e) {
          log2(`[${b.appid}] ${b.gameName || ""}: 出错 ${e?.error || e?.status || JSON.stringify(e)}`, "err");
          skipped++;
        }
      }
      const resultCount = state.results.length;
      if (!state.stopRequested && !queue.stopped) {
        updateSummary();
        setSummaryVisibility(resultCount > 0);
      }
      setStatus(null);
      if (resultCount > 0) {
        setScanPhase("phase3");
      } else {
        setScanPhase("done");
      }
    } catch (e) {
      log2(`扫描中断: ${e?.message || JSON.stringify(e)}`, "err");
    } finally {
      queue.stop();
      state.scanning = false;
      state.queue = null;
      hideProgress();
      setStatus(null);
      document.getElementById("stch-scan-btn")?.classList.remove("disabled");
      document.getElementById("stch-skip-btn")?.classList.add("disabled");
      document.getElementById("stch-stop-btn")?.classList.add("disabled");
      updateAllActionStates();
      applyScanModeTheme();
    }
  }
  var _stopTimeout = null;
  function requestStop() {
    if (state.scanning) {
      state.stopRequested = true;
      state.queue?.stop();
      log2("已请求停止...", "warn");
      _stopTimeout = setTimeout(() => {
        if (state.scanning) {
          state.scanning = false;
          state.stopRequested = false;
          if (state.queue) {
            state.queue.clear();
            state.queue = null;
          }
          hideProgress();
          document.getElementById("stch-scan-btn").classList.remove("disabled");
          document.getElementById("stch-skip-btn").classList.add("disabled");
          document.getElementById("stch-stop-btn").classList.add("disabled");
          applyScanModeTheme();
          setScanPhase("done");
        }
      }, 5e3);
    }
  }

  // src/features/recalculate.js
  var { setStatus: setStatus2, log: log3 } = scanStatus;
  var { setStatus: setOrderStatus } = orderStatus;
  async function recalculateResultSelection(source = "scan") {
    const isOrder = source === "order";
    const selected = isOrder ? getSelectedOrderResults() : getSelectedResults();
    if (selected.length === 0 || isSharedActionBusy()) return;
    const statusFn = isOrder ? setOrderStatus : setStatus2;
    const logFn = isOrder ? orderLog : log3;
    const selectedSet = isOrder ? state.selectedOrderResults : state.selectedResults;
    const targetResults = isOrder ? state.orderResults : state.results;
    state.bulkActionRunning = true;
    updateAllActionStates();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      statusFn,
      logFn
    );
    let refreshed = 0;
    let removed = 0;
    let failed = 0;
    try {
      for (let index = 0; index < selected.length; index++) {
        const existing = selected[index];
        const key = getResultKey(existing);
        statusFn(`重新计算 ${index + 1}/${selected.length}: ${existing.gameName}`);
        try {
          const next = await refreshResultInfo(existing, queue);
          const resultIndex = targetResults.findIndex((info) => getResultKey(info) === key);
          if (next.level >= getBadgeTargetLevel(next)) {
            if (resultIndex >= 0) targetResults.splice(resultIndex, 1);
            selectedSet.delete(key);
            if (!isOrder) removeOrderResultByKey(key, { render: false });
            removed++;
            logFn(`[${existing.appid}] ${existing.gameName}: 已满级，从结果中移除`, "info");
          } else if (resultIndex >= 0) {
            if (isOrder) {
              targetResults[resultIndex] = normalizeOrderResult(next, Date.now());
            } else {
              targetResults[resultIndex] = next;
              upsertOrderResult(next, { render: false });
            }
            refreshed++;
            logFn(
              `[${existing.appid}] ${existing.gameName}: 重算完成，补全 ¥${next.cheapestSetCNY} | 满级 ¥${next.level5CNY}`,
              "ok"
            );
          }
        } catch (error) {
          failed++;
          logFn(
            `[${existing.appid}] ${existing.gameName}: 重算失败 ${error?.message || error}`,
            "err"
          );
        }
      }
    } finally {
      queue.stop();
      state.bulkActionRunning = false;
      statusFn(null);
      if (isOrder) {
        saveOrderCache();
        renderOrderResults();
      } else {
        renderResults();
        updateSummary();
        renderOrderResults();
      }
      updateAllActionStates();
      logFn(
        `选中项重算结束: 成功 ${refreshed}, 移除 ${removed}, 失败 ${failed}`,
        failed ? "warn" : "ok"
      );
    }
  }
  async function recalculateSelectedResults() {
    return recalculateResultSelection("scan");
  }
  async function recalculateSelectedOrderResults() {
    return recalculateResultSelection("order");
  }

  // src/features/orders.js
  var { log: log4, setStatus: setStatus3 } = scanStatus;
  var { setStatus: setOrderStatus2 } = orderStatus;
  async function addManualOrderAppid() {
    if (isSharedActionBusy()) return;
    const input = document.getElementById("stch-order-appid");
    const appid = String(input?.value || "").trim();
    if (!/^\d+$/.test(appid)) {
      setOrderStatus2("请输入有效的 AppID，例如 4761370", false);
      return;
    }
    const isFoil = !!document.getElementById("stch-order-manual-foil")?.checked;
    const existing = getCachedOrderResult({ appid, isFoil });
    state.orderActionRunning = true;
    updateAllActionStates();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setOrderStatus2,
      orderLog
    );
    try {
      setOrderStatus2(`读取 ${appid}${isFoil ? " 闪卡" : ""}`);
      orderLog(`[${appid}] 开始读取${isFoil ? "闪卡" : "普通卡"}卡牌页并查价`, "info");
      const info = await refreshResultInfo(
        { appid, isFoil, gameName: existing?.gameName || "" },
        queue
      );
      upsertOrderResult(info, { select: true, render: true });
      if (input) input.value = "";
      orderLog(
        `[${appid}] ${info.gameName || ""}: 已加入订购缓存，补全 ¥${info.cheapestSetCNY} | 全套 ¥${info.fullSetCNY} | 满级 ¥${info.level5CNY}`,
        "ok"
      );
    } catch (error) {
      orderLog(`[${appid}] 加入失败: ${error?.message || error}`, "err");
    } finally {
      queue.stop();
      state.orderActionRunning = false;
      setOrderStatus2(null);
      updateAllActionStates();
    }
  }
  function deleteExpiredOrderResults() {
    if (isSharedActionBusy()) return;
    const raw = readRawOrderCache();
    const fresh = raw.filter(isOrderCacheFresh);
    const expiredCount = raw.length - fresh.length;
    if (expiredCount <= 0) {
      setOrderStatus2("没有过期缓存", false);
      return;
    }
    if (!confirm(`将删除 ${expiredCount} 项过期订购缓存，确定？`)) return;
    state.orderResults = fresh;
    state.selectedOrderResults.forEach((key) => {
      if (!state.orderResults.some((info) => getResultKey(info) === key)) {
        state.selectedOrderResults.delete(key);
      }
    });
    saveOrderCache();
    renderOrderResults();
    setOrderStatus2(`已删除 ${expiredCount} 项过期缓存`, false);
  }
  async function loadActiveBuyOrders() {
    const response = await window.fetch(
      "https://steamcommunity.com/market/mylistings?start=0&count=100&l=english",
      { credentials: "include" }
    );
    if (!response.ok) {
      throw new Error(`读取现有订购单失败 (${response.status})`);
    }
    const data = await response.json();
    if (data?.success !== true && data?.success !== 1) {
      throw new Error("Steam 未返回现有订购单");
    }
    const doc = new DOMParser().parseFromString(data.results_html || "", "text/html");
    const orders = /* @__PURE__ */ new Map();
    doc.querySelectorAll('[id^="mybuyorder_"]').forEach((row) => {
      const link = row.querySelector('a[href*="/market/listings/"]');
      const href = link?.getAttribute("href") || "";
      if (!href.includes("/market/listings/753/")) return;
      const marketHashName = parseMarketHashNameFromHref(link?.getAttribute("href"));
      if (!marketHashName) {
        throw new Error("无法解析现有 Steam 卡牌订购单");
      }
      const quantityCell = row.querySelector(
        ".market_listing_buyorder_qty .market_listing_price"
      );
      const quantity = parseInt(quantityCell?.textContent || "", 10) || 0;
      if (quantity <= 0) {
        throw new Error(`无法解析现有订购单数量: ${marketHashName}`);
      }
      const orderId = row.id.replace("mybuyorder_", "");
      const current = orders.get(marketHashName) || { quantity: 0, orderIds: [] };
      current.quantity += quantity;
      if (orderId) current.orderIds.push(orderId);
      orders.set(marketHashName, current);
    });
    return orders;
  }
  function getPendingOrderExpectedQuantity(marketHashName) {
    const pending = state.pendingOrderQuantities.get(marketHashName);
    if (!pending) return 0;
    if (Date.now() - pending.createdAt > 2 * 60 * 1e3) {
      state.pendingOrderQuantities.delete(marketHashName);
      return 0;
    }
    return pending.expectedQuantity;
  }
  function getOrderPriceSourceLabel(priceSource) {
    if (priceSource === "median") return "平均价格";
    if (priceSource === "highest") return "求购最高";
    return "在售最低";
  }
  async function fetchHighestBuyPrice(marketHashName) {
    const cached = state.highestBuyPrices.get(marketHashName);
    if (Number.isFinite(cached?.priceCents) && cached.priceCents > 0 && Date.now() - cached.fetchedAt < 3e4) {
      return cached.priceCents;
    }
    const listingUrl = `https://steamcommunity.com/market/listings/753/${encodeURIComponent(marketHashName)}?l=english`;
    const listingResponse = await window.fetch(listingUrl, { credentials: "include" });
    if (!listingResponse.ok) {
      throw new Error(`读取商品页失败 (${listingResponse.status})`);
    }
    const listingHtml = await listingResponse.text();
    const newOrderbook = parseMarketOrderbookFromListingHtml(
      listingHtml,
      marketHashName
    );
    if (newOrderbook) {
      const walletCurrency = Number(
        unsafeWindow.g_rgWalletInfo?.wallet_currency || 23
      );
      if (newOrderbook.currency != null && newOrderbook.currency !== walletCurrency) {
        throw new Error(
          `商品页币种不一致 (${newOrderbook.currency}/${walletCurrency})`
        );
      }
      if (newOrderbook.highestBuyCents <= 0) {
        throw new Error("当前没有可用的最高求购价格");
      }
      state.highestBuyPrices.set(marketHashName, {
        priceCents: newOrderbook.highestBuyCents,
        fetchedAt: Date.now()
      });
      return newOrderbook.highestBuyCents;
    }
    const itemNameIdMatch = listingHtml.match(/Market_LoadOrderSpread\(\s*(\d+)\s*\)/) || listingHtml.match(/ItemActivityTicker\.Start\(\s*(\d+)\s*\)/);
    if (!itemNameIdMatch) {
      throw new Error("商品页缺少可用的订单簿数据");
    }
    const params = new URLSearchParams({
      country: unsafeWindow.g_strCountryCode || "CN",
      language: unsafeWindow.g_strLanguage || "schinese",
      currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
      item_nameid: itemNameIdMatch[1]
    });
    const histogramResponse = await window.fetch(
      `https://steamcommunity.com/market/itemordershistogram?${params}`,
      { credentials: "include" }
    );
    if (!histogramResponse.ok) {
      throw new Error(`读取市场订单簿失败 (${histogramResponse.status})`);
    }
    const histogram = await histogramResponse.json();
    const highestBuyCents = parseInt(histogram?.highest_buy_order, 10);
    if (histogram?.success !== true && histogram?.success !== 1 || !Number.isFinite(highestBuyCents) || highestBuyCents <= 0) {
      throw new Error("当前没有可用的最高求购价格");
    }
    state.highestBuyPrices.set(marketHashName, {
      priceCents: highestBuyCents,
      fetchedAt: Date.now()
    });
    return highestBuyCents;
  }
  async function buildBuyOrderPlan(selected, activeOrders, ui = {}) {
    const statusFn = ui.setStatus || setStatus3;
    const logFn = ui.log || log4;
    const configuredPriceSource = document.getElementById("stch-order-price-source")?.value || state.cfg.orderPriceSource || "lowest";
    const priceSource = ["lowest", "median", "highest"].includes(configuredPriceSource) ? configuredPriceSource : "lowest";
    const adjustmentInput = document.getElementById("stch-price-adjustment");
    const adjustmentValue = adjustmentInput ? parseFloat(adjustmentInput.value) : state.cfg.priceAdjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    const minimumCents = getMarketMinimumPriceCents();
    const plan = [];
    const skipped = {
      covered: 0,
      missingPrice: 0,
      missingHash: 0,
      clamped: 0
    };
    const candidates = [];
    for (const info of selected) {
      for (const card of info.cards) {
        if (!card.marketHashName) {
          skipped.missingHash++;
          continue;
        }
        const targetQuantity = getMultibuyQuantity(
          state.cfg.buyMode || "complete1",
          info.level,
          card.owned,
          getBadgeTargetLevel(info)
        );
        if (targetQuantity <= 0) continue;
        const activeQuantity = activeOrders.get(card.marketHashName)?.quantity || 0;
        const pendingQuantity = getPendingOrderExpectedQuantity(card.marketHashName);
        const reservedQuantity = Math.max(activeQuantity, pendingQuantity);
        const quantity = Math.max(0, targetQuantity - reservedQuantity);
        if (quantity <= 0) {
          skipped.covered++;
          continue;
        }
        candidates.push({
          info,
          card,
          quantity,
          reservedQuantity,
          targetQuantity
        });
      }
    }
    for (let index = 0; index < candidates.length; index++) {
      const { info, card, quantity, reservedQuantity, targetQuantity } = candidates[index];
      let basePriceCents = null;
      if (priceSource === "lowest" && card.priceSource === "lowest" && Number.isFinite(card.lowestCents) && card.lowestCents > 0) {
        basePriceCents = card.lowestCents;
      } else if (priceSource === "median" && Number.isFinite(card.medianCents) && card.medianCents > 0) {
        basePriceCents = card.medianCents;
      } else if (priceSource === "highest") {
        statusFn(`读取求购最高 ${index + 1}/${candidates.length}: ${card.name}`);
        try {
          basePriceCents = await fetchHighestBuyPrice(card.marketHashName);
        } catch (error) {
          logFn(
            `  ${info.gameName} · ${card.name}: ${error?.message || error}，已跳过`,
            "warn"
          );
        }
      }
      if (basePriceCents == null) {
        skipped.missingPrice++;
        continue;
      }
      const adjustedPrice = basePriceCents + adjustmentCents;
      const unitPriceCents = Math.max(minimumCents, adjustedPrice);
      if (unitPriceCents !== adjustedPrice) skipped.clamped++;
      plan.push({
        appid: info.appid,
        gameName: info.gameName,
        cardName: card.name,
        marketHashName: card.marketHashName,
        quantity,
        reservedQuantity,
        targetQuantity,
        basePriceCents,
        unitPriceCents,
        totalPriceCents: unitPriceCents * quantity
      });
    }
    return { plan, skipped, priceSource, adjustmentCents, minimumCents };
  }
  function showBuyOrderConfirmation(planData, selectedGameCount) {
    return new Promise((resolve) => {
      const { plan, skipped, priceSource, adjustmentCents, minimumCents } = planData;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
      const totalCents = plan.reduce((sum, item) => sum + item.totalPriceCents, 0);
      const plannedGameCount = new Set(plan.map((item) => `${item.appid}:${item.gameName}`)).size;
      const adjustmentText = `${adjustmentCents >= 0 ? "+" : "-"}¥${formatCNY(Math.abs(adjustmentCents))}`;
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认提交长期订购单</h3>
          <div class="stch-order-summary">
            游戏 <b>${plannedGameCount}</b>/${selectedGameCount} 个 · 卡牌种类 <b>${plan.length}</b> ·
            数量 <b>${totalQuantity}</b> 张 · 新增最高占用 <b>¥${formatCNY(totalCents)}</b><br>
            价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> ·
            买价调整 <b>${adjustmentText}</b>
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note"></div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">提交订购单</div>
          </div>
        </div>
      `;
      const list = backdrop.querySelector(".stch-order-list");
      plan.forEach((item) => {
        const row = document.createElement("div");
        row.className = "stch-order-item";
        row.title = `${item.gameName} · ${item.marketHashName}`;
        row.appendChild(createTextSpan("", `${item.gameName} · ${item.cardName}`));
        row.appendChild(createTextSpan("", `${item.quantity} 张`));
        row.appendChild(createTextSpan("", `¥${formatCNY(item.unitPriceCents)}`));
        list.appendChild(row);
      });
      const notes = [];
      if (skipped.covered) notes.push(`${skipped.covered} 种卡牌已被现有订购单覆盖`);
      if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 种卡牌缺少所选价格，已跳过`);
      if (skipped.missingHash) notes.push(`${skipped.missingHash} 种卡牌缺少市场标识，已跳过`);
      if (skipped.clamped) {
        notes.push(`${skipped.clamped} 种卡牌低于 Steam 最低价，已调整为 ¥${formatCNY(minimumCents)}`);
      }
      backdrop.querySelector(".stch-order-note").textContent = `${notes.join("；") || "未发现需跳过的卡牌"}。订单将长期保留，直到成交或手动取消；提交即表示同意 Steam 订户协议。`;
      const finish = (confirmed) => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }
  async function createLongTermBuyOrder(item, ui = {}) {
    const statusFn = ui.setStatus || setStatus3;
    const logFn = ui.log || log4;
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    if (unsafeWindow.g_bRequiresBillingInfo === true) {
      throw new Error("Steam 要求补充账单信息，请先在市场页面手动提交一次订单");
    }
    let confirmation = 0;
    for (let attempt = 0; attempt < 41; attempt++) {
      const body = new URLSearchParams({
        sessionid: sessionId,
        currency: String(unsafeWindow.g_rgWalletInfo?.wallet_currency || 23),
        appid: "753",
        market_hash_name: item.marketHashName,
        price_total: String(item.totalPriceCents),
        quantity: String(item.quantity),
        first_name: "",
        last_name: "",
        billing_address: "",
        billing_address_two: "",
        billing_country: "",
        billing_city: "",
        billing_state: "",
        billing_postal_code: "",
        save_my_address: "0",
        confirmation: String(confirmation || 0)
      });
      const response = await window.fetch(
        "https://steamcommunity.com/market/createbuyorder/",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
          body: body.toString()
        }
      );
      const text = await response.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (_) {
      }
      if (data?.success === 1) return data;
      if (data?.need_confirmation && data?.confirmation?.confirmation_id) {
        confirmation = data.confirmation.confirmation_id;
        if (attempt === 0) {
          logFn(`  ${item.cardName}: 等待 Steam 移动确认`, "warn");
          statusFn(`请在 Steam 移动应用中确认: ${item.cardName}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        continue;
      }
      throw new Error(data?.message || `提交失败 (${response.status})`);
    }
    throw new Error("等待 Steam 移动确认超时");
  }
  async function submitBuyOrdersForSelection(source = "scan") {
    const isOrder = source === "order";
    const statusFn = isOrder ? setOrderStatus2 : setStatus3;
    const logFn = isOrder ? orderLog : log4;
    const ui = { setStatus: statusFn, log: logFn };
    const selected = isOrder ? getSelectedOrderResults() : getSelectedResults();
    if (isSharedActionBusy()) return;
    if (selected.length === 0) {
      statusFn("请先勾选要提交订购单的卡组", false);
      return;
    }
    state.bulkActionRunning = true;
    updateAllActionStates();
    let submitted = 0;
    let failed = 0;
    let finalStatus = null;
    try {
      statusFn("读取现有订购单");
      const activeOrders = await loadActiveBuyOrders();
      const planData = await buildBuyOrderPlan(selected, activeOrders, ui);
      if (planData.plan.length === 0) {
        finalStatus = `无需提交订购单：已有订单已覆盖，或没有可用的${getOrderPriceSourceLabel(planData.priceSource)}`;
        logFn(finalStatus, "warn");
        return;
      }
      const confirmed = await showBuyOrderConfirmation(planData, selected.length);
      if (!confirmed) {
        finalStatus = "已取消提交订购单";
        return;
      }
      for (let index = 0; index < planData.plan.length; index++) {
        const item = planData.plan[index];
        statusFn(`提交订购单 ${index + 1}/${planData.plan.length}: ${item.cardName}`);
        try {
          const result = await createLongTermBuyOrder(item, ui);
          submitted++;
          state.pendingOrderQuantities.set(item.marketHashName, {
            expectedQuantity: item.reservedQuantity + item.quantity,
            createdAt: Date.now()
          });
          logFn(
            `  ✓ ${item.gameName} · ${item.cardName}: ${item.quantity} 张 @ ¥${formatCNY(item.unitPriceCents)}，订单 ${result.buy_orderid}`,
            "ok"
          );
        } catch (error) {
          failed++;
          logFn(
            `  ✗ ${item.gameName} · ${item.cardName}: ${error?.message || error}`,
            "err"
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      finalStatus = `长期订购单提交结束: 成功 ${submitted}, 失败 ${failed}`;
      logFn(finalStatus, failed ? "warn" : "ok");
    } catch (error) {
      finalStatus = `无法提交长期订购单: ${error?.message || error}`;
      logFn(finalStatus, "err");
    } finally {
      state.bulkActionRunning = false;
      if (isOrder && finalStatus) {
        statusFn(finalStatus, false);
      } else {
        statusFn(null);
      }
      updateAllActionStates();
    }
  }
  async function submitSelectedBuyOrders() {
    return submitBuyOrdersForSelection("scan");
  }
  async function submitSelectedOrderBuyOrders() {
    return submitBuyOrdersForSelection("order");
  }

  // src/features/craft.js
  var { log: craftLog, setStatus: setCraftStatus, setProgress: setCraftProgress, hideProgress: hideCraftProgress } = craftStatus;
  function getCraftPlan() {
    return state.craftResults.filter((result) => result.selected && result.maxCraftable > 0).map((result) => ({
      result,
      count: state.cfg.craftMode === "max" ? result.maxCraftable : Math.max(
        0,
        Math.min(result.maxCraftable, parseInt(result.craftCount, 10) || 0)
      )
    })).filter((item) => item.count > 0);
  }
  function updateCraftSummary() {
    const row = document.getElementById("stch-craft-summary-row");
    const summary = document.getElementById("stch-craft-summary");
    if (!row || !summary) return;
    if (state.craftResults.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }
    const plan = getCraftPlan();
    const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
    const totalAvailable = state.craftResults.reduce(
      (sum, result) => sum + result.maxCraftable,
      0
    );
    summary.innerHTML = `共 <b>${state.craftResults.length}</b> 个可合成徽章 · 可合成 <b>${totalAvailable}</b> 次 · 已选择 <b>${plan.length}</b> 个 / <b>${totalLevels}</b> 次`;
    row.style.display = "";
  }
  function renderCraftResults() {
    const list = document.getElementById("stch-craft-list");
    if (!list) return;
    list.innerHTML = "";
    if (state.craftResults.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-game-row";
      empty.textContent = state.craftScanning ? "正在读取可合成徽章..." : "尚未扫描可合成徽章";
      list.appendChild(empty);
      updateCraftSummary();
      updateCraftActionState();
      return;
    }
    const header = document.createElement("div");
    header.className = "stch-game-row stch-craft-row stch-row-header";
    header.innerHTML = `
      <span class="stch-appid">游戏ID</span>
      <span class="stch-name">游戏名</span>
      <span class="stch-level">当前</span>
      <span class="stch-craft-available">可合成</span>
      <span class="stch-craft-count">本次</span>
      <span class="stch-craft-target">目标</span>
      <span class="stch-craft-status">状态</span>
      <span class="stch-check"><span class="stch-check-hit"><input class="stch-result-cb" id="stch-craft-select-all" type="checkbox" title="全选"></span></span>
    `;
    list.appendChild(header);
    const selectAll = header.querySelector("#stch-craft-select-all");
    const selectedCount = state.craftResults.filter((result) => result.selected).length;
    selectAll.checked = selectedCount === state.craftResults.length;
    selectAll.indeterminate = selectedCount > 0 && selectedCount < state.craftResults.length;
    selectAll.disabled = state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning;
    const applyCraftSelectAll = (checked) => {
      state.craftResults.forEach((result) => {
        if (result.maxCraftable <= 0) return;
        result.selected = checked;
        if (checked && result.craftCount <= 0) {
          result.craftCount = result.maxCraftable;
        }
      });
      renderCraftResults();
    };
    selectAll.addEventListener("change", (event) => {
      event.stopPropagation();
      applyCraftSelectAll(event.target.checked);
    });
    selectAll.closest(".stch-check").addEventListener("click", (event) => {
      event.stopPropagation();
      if (event.target === selectAll || selectAll.disabled) return;
      selectAll.checked = !selectAll.checked;
      applyCraftSelectAll(selectAll.checked);
    });
    state.craftResults.forEach((result) => {
      const row = document.createElement("div");
      row.className = "stch-game-row stch-craft-row";
      row.dataset.key = getResultKey(result);
      const appid = createTextSpan("stch-appid", result.appid);
      const name = createTextSpan(
        "stch-name",
        `${result.gameName}${result.isFoil ? "（闪亮）" : ""}`
      );
      name.title = result.gameName;
      const level = createTextSpan("stch-level", `Lv${result.level}`);
      const available = createTextSpan(
        "stch-craft-available",
        `${result.maxCraftable} 次`
      );
      const countCell = document.createElement("span");
      countCell.className = "stch-craft-count";
      const countInput = document.createElement("input");
      countInput.className = "stch-input";
      countInput.type = "number";
      countInput.min = "0";
      countInput.max = String(result.maxCraftable);
      countInput.step = "1";
      const displayedCraftCount = state.cfg.craftMode === "max" ? result.maxCraftable : Math.max(0, Math.min(result.maxCraftable, result.craftCount || 0));
      countInput.value = String(displayedCraftCount);
      countInput.title = state.cfg.craftMode === "max" ? "一次提交当前可合成最大次数" : "输入本次要逐级合成的次数";
      countInput.disabled = state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning || state.cfg.craftMode === "max" || result.maxCraftable <= 0;
      countCell.appendChild(countInput);
      const target = createTextSpan(
        "stch-craft-target",
        `Lv${result.level + (parseInt(countInput.value, 10) || 0)}`
      );
      const status = createTextSpan(
        `stch-craft-status ${result.statusType || ""}`.trim(),
        result.status || "待合成"
      );
      const checkCell = document.createElement("span");
      checkCell.className = "stch-check";
      const checkbox = document.createElement("input");
      checkbox.className = "stch-result-cb";
      checkbox.type = "checkbox";
      checkbox.checked = !!result.selected;
      checkbox.disabled = state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning || result.maxCraftable <= 0;
      checkCell.appendChild(createCheckboxHit(checkbox));
      const applyCraftChecked = (checked) => {
        result.selected = checked;
        if (result.selected && result.craftCount <= 0) {
          result.craftCount = result.maxCraftable;
          countInput.value = String(result.craftCount);
          target.textContent = `Lv${result.level + result.craftCount}`;
        }
        updateCraftSummary();
        updateCraftActionState();
      };
      checkbox.addEventListener("change", (event) => {
        event.stopPropagation();
        applyCraftChecked(checkbox.checked);
      });
      checkCell.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.target === checkbox || checkbox.disabled) return;
        checkbox.checked = !checkbox.checked;
        applyCraftChecked(checkbox.checked);
      });
      countInput.addEventListener("input", () => {
        const value = Math.max(
          0,
          Math.min(result.maxCraftable, parseInt(countInput.value, 10) || 0)
        );
        result.craftCount = value;
        result.selected = value > 0;
        checkbox.checked = result.selected;
        target.textContent = `Lv${result.level + value}`;
        updateCraftSummary();
        updateCraftActionState();
      });
      countInput.addEventListener("change", () => {
        countInput.value = String(result.craftCount);
      });
      row.append(appid, name, level, available, countCell, target, status, checkCell);
      list.appendChild(row);
    });
    updateCraftSummary();
    updateCraftActionState();
  }
  function setAllCraftCounts(mode) {
    if (state.craftScanning || state.craftActionRunning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning) {
      return;
    }
    if (mode === "one" && state.cfg.craftMode === "max") return;
    state.craftResults.forEach((result) => {
      if (mode === "clear") {
        result.craftCount = 0;
        result.selected = false;
      } else if (result.maxCraftable > 0) {
        result.craftCount = mode === "one" ? 1 : result.maxCraftable;
        result.selected = true;
      }
    });
    renderCraftResults();
  }
  async function startCraftScan() {
    if (state.craftScanning || state.craftActionRunning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning) {
      return;
    }
    const profileUrl = getProfileUrl();
    if (!profileUrl) {
      craftLog("未找到 Steam 个人资料地址", "err");
      return;
    }
    state.craftScanning = true;
    state.craftStopRequested = false;
    state.craftResults = [];
    const logBox = document.getElementById("stch-craft-log");
    if (logBox) logBox.innerHTML = "";
    renderCraftResults();
    updateAllActionStates();
    setCraftStatus("扫描可合成徽章");
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      null,
      craftLog
    );
    state.craftQueue = queue;
    const maxPages = Math.max(
      1,
      parseInt(
        document.getElementById("stch-craft-max-pages")?.value,
        10
      ) || cfg.maxBadgePages
    );
    const candidates = [];
    const seen = /* @__PURE__ */ new Set();
    const blacklist = new Set(
      (cfg.blacklist || "").split(",").map((value) => value.trim()).filter(Boolean)
    );
    try {
      for (let page = 1; page <= maxPages; page++) {
        if (state.craftStopRequested) break;
        setCraftProgress(page - 1, maxPages, `读取徽章页 ${page}/${maxPages}`);
        const response = await queue.fetch(
          `${profileUrl}/badges/?sort=p&p=${page}`
        );
        const pageCandidates = parseCraftCandidatesHtml(response.text || "");
        for (const candidate of pageCandidates) {
          const key = getResultKey(candidate);
          if (seen.has(key)) continue;
          seen.add(key);
          if (blacklist.has(String(candidate.appid))) {
            craftLog(
              `[${candidate.appid}] ${candidate.gameName}: 位于游戏/AppID黑名单，跳过`,
              "info"
            );
            continue;
          }
          candidates.push(candidate);
        }
        craftLog(
          `徽章页 ${page}: 找到 ${pageCandidates.length} 个可合成入口`,
          "info"
        );
        const doc = new DOMParser().parseFromString(
          response.text || "",
          "text/html"
        );
        const nextLink = doc.querySelector(
          `a.pagebtn[href*="p=${page + 1}"]`
        );
        if (!nextLink) break;
      }
      if (state.craftStopRequested) {
        craftLog("已停止扫描", "warn");
        return;
      }
      if (candidates.length === 0) {
        craftLog("没有找到可立即合成的徽章", "warn");
        return;
      }
      craftLog(`找到 ${candidates.length} 个候选徽章，开始读取卡组数量`);
      for (let index = 0; index < candidates.length; index++) {
        if (state.craftStopRequested) break;
        const candidate = candidates[index];
        setCraftProgress(
          index,
          candidates.length,
          `读取卡组 ${index + 1}/${candidates.length} · ${candidate.gameName}`
        );
        setCraftStatus(`读取卡组: ${candidate.gameName}`);
        try {
          const response = await queue.fetch(
            getGameCardsUrl(profileUrl, candidate.appid, candidate, { language: "english" })
          );
          const result = parseCraftableGameCardsHtml(
            response.text || "",
            candidate
          );
          if (result.maxCraftable <= 0) {
            craftLog(
              `[${candidate.appid}] ${candidate.gameName}: 页面已不可合成，跳过`,
              "warn"
            );
            continue;
          }
          state.craftResults.push(result);
          craftLog(
            `[${result.appid}] ${result.gameName}: Lv${result.level}，可合成 ${result.maxCraftable} 次`,
            "ok"
          );
        } catch (error) {
          if (state.craftStopRequested) break;
          craftLog(
            `[${candidate.appid}] ${candidate.gameName}: 读取失败 ${error?.message || error?.status || error}`,
            "err"
          );
        }
      }
      state.craftResults.sort(
        (left, right) => left.gameName.localeCompare(right.gameName, "zh-CN")
      );
      renderCraftResults();
      if (state.craftStopRequested) {
        craftLog("已停止扫描", "warn");
      } else {
        const total = state.craftResults.reduce(
          (sum, result) => sum + result.maxCraftable,
          0
        );
        craftLog(
          `扫描完成：${state.craftResults.length} 个徽章，可合成 ${total} 次`,
          "ok"
        );
      }
    } catch (error) {
      if (!state.craftStopRequested) {
        craftLog(`扫描中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      state.craftQueue = null;
      state.craftScanning = false;
      state.craftStopRequested = false;
      hideCraftProgress();
      setCraftStatus(null);
      renderCraftResults();
      updateAllActionStates();
    }
  }
  function showCraftConfirmation(plan, craftMode) {
    return new Promise((resolve) => {
      const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
      const craftModeLabel = craftMode === "max" ? "一次升满" : "逐级升级";
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认批量合成徽章</h3>
          <div class="stch-order-summary">
            游戏 <b>${plan.length}</b> 个 · 合成 <b>${totalLevels}</b> 次 ·
            预计增加 <b>${totalLevels * 100}</b> XP ·
            模式 <b>${craftModeLabel}</b>
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note">
            ${craftMode === "max" ? "每个徽章会按所选次数提交一次合成请求。" : "每一级都会独立提交一次合成请求。"}
            若请求结果不确定，脚本会立即停止且不会自动重试，请重新扫描后再继续。
          </div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">开始合成</div>
          </div>
        </div>
      `;
      const list = backdrop.querySelector(".stch-order-list");
      plan.forEach((item) => {
        const row = document.createElement("div");
        row.className = "stch-order-item stch-craft-dialog-item";
        row.appendChild(createTextSpan("", item.result.gameName));
        row.appendChild(createTextSpan("", `Lv${item.result.level}`));
        row.appendChild(createTextSpan("", `${item.count} 次`));
        row.appendChild(
          createTextSpan("", `Lv${item.result.level + item.count}`)
        );
        list.appendChild(row);
      });
      const finish = (confirmed) => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }
  async function createBadgeCraftRequest(result, levels = 1) {
    const profileUrl = getProfileUrl();
    const sessionId = getSessionId();
    if (!profileUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    const requestedLevels = Math.max(1, parseInt(levels, 10) || 1);
    if (requestedLevels > result.maxCraftable) {
      throw new Error("合成次数超过 Steam 当前允许的最大值");
    }
    const body = new URLSearchParams({
      appid: String(result.appid),
      series: "1",
      border_color: result.isFoil ? "1" : "0",
      levels: String(requestedLevels),
      sessionid: sessionId
    });
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15e3);
    let response;
    try {
      response = await window.fetch(`${profileUrl}/ajaxcraftbadge/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest"
        },
        body: body.toString(),
        signal: controller.signal
      });
    } catch (cause) {
      clearTimeout(timeoutId);
      const message = cause?.name === "AbortError" ? "请求超时" : `网络错误: ${cause?.message || cause}`;
      const error2 = new Error(message);
      error2.uncertain = true;
      throw error2;
    }
    let text;
    try {
      text = await response.text();
    } catch (cause) {
      const error2 = new Error(`响应读取失败: ${cause?.message || cause}`);
      error2.uncertain = true;
      throw error2;
    } finally {
      clearTimeout(timeoutId);
    }
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      const error2 = new Error(`Steam 返回了无法识别的响应 (${response.status})`);
      error2.status = response.status;
      error2.uncertain = response.ok || response.status >= 500;
      throw error2;
    }
    if (response.ok && data?.success === 1) return data;
    const error = new Error(
      data?.message || `合成失败 (${response.status || "unknown"})`
    );
    error.status = response.status;
    error.uncertain = response.status >= 500;
    throw error;
  }
  async function submitCraftPlan() {
    if (state.craftScanning || state.craftActionRunning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning) {
      return;
    }
    const plan = getCraftPlan();
    if (plan.length === 0) return;
    const craftMode = state.cfg.craftMode === "max" ? "max" : "step";
    const confirmed = await showCraftConfirmation(plan, craftMode);
    if (!confirmed) return;
    state.craftActionRunning = true;
    state.craftStopRequested = false;
    updateAllActionStates();
    renderCraftResults();
    const totalLevels = plan.reduce((sum, item) => sum + item.count, 0);
    let completedLevels = 0;
    let failedGames = 0;
    let uncertain = false;
    try {
      for (const item of plan) {
        if (state.craftStopRequested || uncertain) break;
        const result = item.result;
        let itemCompleted = 0;
        result.status = "合成中";
        result.statusType = "warn";
        renderCraftResults();
        while (itemCompleted < item.count) {
          if (state.craftStopRequested) break;
          const requestLevels = craftMode === "max" ? item.count - itemCompleted : 1;
          setCraftStatus(
            `合成 ${Math.min(totalLevels, completedLevels + requestLevels)}/${totalLevels}: ${result.gameName}`
          );
          try {
            const data = await createBadgeCraftRequest(result, requestLevels);
            completedLevels += requestLevels;
            itemCompleted += requestLevels;
            result.level += requestLevels;
            result.availableSets = Math.max(
              0,
              result.availableSets - requestLevels
            );
            result.maxCraftable = Math.max(
              0,
              result.maxCraftable - requestLevels
            );
            result.craftCount = Math.max(0, item.count - itemCompleted);
            const rewards = (data.rgDroppedItems || []).map((reward) => reward.title).filter(Boolean);
            craftLog(
              `✓ ${result.gameName}: 已合成 ${requestLevels} 次，至 Lv${result.level}${rewards.length ? `，获得 ${rewards.join("、")}` : ""}`,
              "ok"
            );
            setCraftProgress(
              completedLevels,
              totalLevels,
              `已合成 ${completedLevels}/${totalLevels} 次`
            );
          } catch (error) {
            failedGames++;
            result.status = error.uncertain ? "结果不确定" : "失败";
            result.statusType = "err";
            craftLog(
              `✗ ${result.gameName}: ${error?.message || error}`,
              "err"
            );
            if (error.uncertain) {
              uncertain = true;
              state.craftStopRequested = true;
              craftLog(
                "请求可能已经被 Steam 执行，已停止后续合成；请刷新或重新扫描确认实际等级",
                "warn"
              );
            } else if (error.status === 429) {
              state.craftStopRequested = true;
              craftLog(
                "Steam 返回 429，已停止后续合成；建议等待至少半小时或者更换 IP 后再继续",
                "warn"
              );
            }
            break;
          }
          if (completedLevels < totalLevels && !state.craftStopRequested && !uncertain) {
            await new Promise(
              (resolve) => setTimeout(resolve, Math.max(200, state.cfg.craftInterval))
            );
          }
        }
        result.selected = false;
        result.craftCount = 0;
        if (!result.statusType || result.statusType !== "err") {
          if (itemCompleted === item.count) {
            result.status = "已完成";
            result.statusType = "ok";
          } else if (itemCompleted > 0) {
            result.status = "部分完成";
            result.statusType = "warn";
          } else if (state.craftStopRequested) {
            result.status = "已停止";
            result.statusType = "warn";
          }
        }
        renderCraftResults();
      }
      if (state.craftStopRequested && !uncertain) {
        craftLog("已按请求停止后续合成", "warn");
      }
      craftLog(
        `批量合成结束：成功 ${completedLevels}/${totalLevels} 次，失败 ${failedGames} 个游戏`,
        failedGames || state.craftStopRequested ? "warn" : "ok"
      );
    } finally {
      state.craftActionRunning = false;
      state.craftStopRequested = false;
      hideCraftProgress();
      setCraftStatus(null);
      renderCraftResults();
      updateAllActionStates();
    }
  }
  function requestCraftStop() {
    if (!state.craftScanning && !state.craftActionRunning) return;
    state.craftStopRequested = true;
    state.craftQueue?.stop();
    craftLog(
      state.craftActionRunning ? "已请求停止，将在当前合成请求结束后停止" : "已请求停止扫描",
      "warn"
    );
    updateCraftActionState();
  }

  // src/request/http.js
  async function stchRequestText(url) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 2e4,
          anonymous: false,
          withCredentials: true,
          onload: (response2) => {
            if (response2.status >= 200 && response2.status < 300) {
              resolve(response2.responseText || "");
            } else {
              reject(new Error(`HTTP ${response2.status}`));
            }
          },
          onerror: () => reject(new Error("网络请求失败")),
          ontimeout: () => reject(new Error("网络请求超时"))
        });
      });
    }
    const response = await window.fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }
  async function stchRequestJson(url) {
    const text = await stchRequestText(url);
    try {
      return JSON.parse(text || "{}");
    } catch (_) {
      throw new Error("返回内容不是 JSON");
    }
  }
  function requestExternalText({ method = "GET", url, headers = {}, data = null, timeout = 2e4 }) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data,
          timeout,
          anonymous: false,
          responseType: "text",
          onload: (response) => resolve({
            status: response.status || 0,
            text: response.responseText || "",
            finalUrl: response.finalUrl || url
          }),
          onerror: (response) => {
            const error = new Error(`网络错误 (${response?.status || "unknown"})`);
            error.status = response?.status || 0;
            reject(error);
          },
          ontimeout: () => {
            const error = new Error("请求超时");
            error.uncertain = true;
            reject(error);
          }
        });
      });
    }
    return window.fetch(url, {
      method,
      credentials: "include",
      headers,
      body: data
    }).then(async (response) => ({
      status: response.status,
      text: await response.text(),
      finalUrl: response.url || url
    }));
  }
  function buildHttpError(status, message) {
    const error = new Error(message || `请求失败 (${status})`);
    error.status = status;
    if (status === 429) {
      error.message = "Steam 返回 429";
    }
    return error;
  }
  function appendQuery(url, params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null || value === "") return;
      query.set(key, String(value));
    });
    const qs = query.toString();
    return qs ? `${url}?${qs}` : url;
  }

  // src/features/seasonal.js
  var { log: seasonalLog, setStatus: setSeasonalStatus, setProgress: setSeasonalProgress, hideProgress: hideSeasonalProgress } = seasonalStatus;
  function sleepMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
  }
  function normalizeSeasonalInputs() {
    const targetEl = document.getElementById("stch-seasonal-target");
    if (targetEl) {
      state.cfg.seasonalTargetLevel = clampNumber(
        targetEl.value,
        1,
        SEASONAL_BADGE_MAX_LEVEL,
        DEFAULT_CONFIG.seasonalTargetLevel
      );
      targetEl.min = "1";
      targetEl.value = String(state.cfg.seasonalTargetLevel);
    }
    saveConfig(state.cfg);
  }
  function getSeasonalPlan() {
    normalizeSeasonalInputs();
    const targetLevel = state.cfg.seasonalTargetLevel;
    return {
      targetLevel,
      levels: Math.max(0, targetLevel),
      interval: Math.max(0, state.cfg.seasonalInterval)
    };
  }
  function updateSeasonalSummary() {
    const summary = document.getElementById("stch-seasonal-summary");
    if (!summary) return;
    const plan = getSeasonalPlan();
    const pointCost = SEASONAL_BADGE_DEFAULT_COST;
    const totalCost = pointCost * plan.levels;
    summary.innerHTML = `
      <div><b>${SEASONAL_BADGE_NAME}</b> · 每级约 <b>${pointCost.toLocaleString()}</b> 点</div>
      <div>将尝试 Lv<b>1</b> 到 Lv<b>${plan.targetLevel}</b> · 最多 <b>${plan.levels}</b> 次 · 最多 <b>${totalCost.toLocaleString()}</b> 点</div>
    `;
    updateSeasonalActionState();
  }
  function parseJsonDataAttribute(html, attrName) {
    const match = String(html || "").match(new RegExp(`${attrName}="([^"]*)"`, "i"));
    if (!match) return null;
    try {
      return JSON.parse(decodeHtmlEntities(match[1]));
    } catch (_) {
      return null;
    }
  }
  async function loadSeasonalStoreContext() {
    const response = await requestExternalText({ url: SEASONAL_POINTS_SHOP_URL });
    if (response.status === 429) {
      throw buildHttpError(429);
    }
    if (response.status < 200 || response.status >= 300) {
      throw buildHttpError(response.status, `读取点数商店失败 (${response.status})`);
    }
    const config = parseJsonDataAttribute(response.text, "data-config") || {};
    const loyaltyStore = parseJsonDataAttribute(response.text, "data-loyaltystore") || {};
    const token = loyaltyStore.webapi_token || config.webapi_token || response.text.match(/"webapi_token"\s*:\s*"([^"]+)"/)?.[1] || response.text.match(/g_wapit\s*=\s*"([^"]+)"/)?.[1];
    if (!token) {
      throw new Error("未从点数商店读取到 webapi token，请确认已登录 Steam 商店");
    }
    return {
      token
    };
  }
  async function requestSteamWebApi(methodName, token, payload) {
    const endpoint = `https://api.steampowered.com/ILoyaltyRewardsService/${methodName}/v1`;
    const body = new FormData();
    body.append("input_json", JSON.stringify(payload));
    const response = await requestExternalText({
      method: "POST",
      url: appendQuery(endpoint, { access_token: token }),
      data: body,
      timeout: 2e4
    });
    if (response.status === 429) {
      throw buildHttpError(429);
    }
    if (response.status < 200 || response.status >= 300) {
      const error = buildHttpError(response.status, `Steam API 请求失败 (${response.status})`);
      error.uncertain = response.status >= 500;
      throw error;
    }
    let data = null;
    try {
      data = response.text ? JSON.parse(response.text) : {};
    } catch (_) {
      const error = new Error("Steam API 返回了无法识别的响应");
      error.uncertain = true;
      throw error;
    }
    const payloadError = data?.response?.error || data?.response?.message || data?.error || data?.message;
    const success = data?.response?.success ?? data?.success;
    const eresult = Number(data?.response?.eresult || data?.eresult || 1);
    if (payloadError || success === false || success === 0 || Number.isFinite(eresult) && eresult > 1) {
      const error = new Error(
        payloadError || `Steam API 返回失败${Number.isFinite(eresult) ? ` (EResult ${eresult})` : ""}`
      );
      error.uncertain = false;
      throw error;
    }
    return data;
  }
  async function getSeasonalBadgeInfo() {
    const context = await loadSeasonalStoreContext();
    return {
      token: context.token,
      defid: SEASONAL_BADGE_DEFID,
      name: SEASONAL_BADGE_NAME,
      pointCost: SEASONAL_BADGE_DEFAULT_COST
    };
  }
  function showSeasonalConfirmation(info, plan) {
    return new Promise((resolve) => {
      const totalCost = (info.pointCost || SEASONAL_BADGE_DEFAULT_COST) * plan.levels;
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>确认购买 ${escapeHtml(info.name)}</h3>
          <div class="stch-order-summary">
            将从 Lv<b>1</b> 试到 Lv<b>${plan.targetLevel}</b><br>
            最多提交 <b>${plan.levels}</b> 次 · 最多消耗 <b>${totalCost.toLocaleString()}</b> 点
          </div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note">
            提交后会消耗 Steam 点数，脚本无法撤销。若请求超时、429 或结果不确定，脚本会停止，不会自动重复提交。
          </div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn" data-action="confirm">开始购买</div>
          </div>
        </div>
      `;
      const list = backdrop.querySelector(".stch-order-list");
      const row = document.createElement("div");
      row.className = "stch-order-item";
      row.appendChild(createTextSpan("", info.name));
      row.appendChild(createTextSpan("", `Lv1-Lv${plan.targetLevel}`));
      row.appendChild(createTextSpan("", `${totalCost.toLocaleString()} 点`));
      list.appendChild(row);
      const finish = (confirmed) => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }
  async function redeemSeasonalBadgeLevels(info, levels) {
    const requestedLevels = Math.max(
      1,
      Math.min(SEASONAL_BADGE_MAX_LEVEL, parseInt(levels, 10) || 1)
    );
    const data = await requestSteamWebApi(
      "RedeemPointsForBadgeLevel",
      info.token,
      {
        defid: Number(info.defid),
        num_levels: requestedLevels
      }
    );
    return data;
  }
  async function startSeasonalPurchase() {
    if (state.seasonalActionRunning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.surplusActionRunning || state.surplusScanning || state.grindScanning) {
      return;
    }
    const plan = getSeasonalPlan();
    if (plan.levels <= 0) {
      seasonalLog("目标等级至少为 1", "warn");
      updateSeasonalSummary();
      return;
    }
    state.seasonalActionRunning = true;
    state.seasonalStopRequested = false;
    updateAllActionStates();
    setSeasonalStatus("读取 Steam 点数商店");
    let completed = 0;
    let skipped = 0;
    let failed = false;
    let cancelled = false;
    try {
      const info = await getSeasonalBadgeInfo();
      updateSeasonalSummary();
      const confirmed = await showSeasonalConfirmation(info, plan);
      if (!confirmed) {
        cancelled = true;
        return;
      }
      setSeasonalProgress(0, plan.levels, `准备购买 0/${plan.levels} 级`);
      seasonalLog(
        `${info.name}: 开始从 Lv1 试到 Lv${plan.targetLevel}`,
        "info"
      );
      for (let level = 1; level <= plan.targetLevel; level++) {
        if (state.seasonalStopRequested) break;
        setSeasonalStatus(`尝试 ${info.name} Lv${level}/${plan.targetLevel}`);
        try {
          await redeemSeasonalBadgeLevels(info, level);
          completed++;
          setSeasonalProgress(level, plan.levels, `已尝试 ${level}/${plan.levels} 级`);
          seasonalLog(
            `✓ ${info.name}: Lv${level} 提交成功`,
            "ok"
          );
        } catch (error) {
          if (error?.status === 429 || error?.uncertain) throw error;
          skipped++;
          setSeasonalProgress(level, plan.levels, `已尝试 ${level}/${plan.levels} 级`);
          seasonalLog(`Lv${level} 跳过: ${error?.message || error}`, "warn");
        }
        if (level < plan.targetLevel && !state.seasonalStopRequested) {
          await sleepMs(plan.interval);
        }
      }
    } catch (error) {
      failed = true;
      if (error?.status === 429) {
        seasonalLog(
          "Steam 返回 429，已停止购买；建议等待至少半小时或者更换 IP 后再继续",
          "warn"
        );
      } else if (error?.uncertain) {
        seasonalLog(
          `请求结果不确定: ${error?.message || error}。请刷新点数商店确认实际等级后再继续`,
          "warn"
        );
      } else {
        seasonalLog(`购买失败: ${error?.message || error}`, "err");
      }
    } finally {
      if (state.seasonalStopRequested && !failed) {
        seasonalLog("已按请求停止后续购买", "warn");
      }
      if (!cancelled) {
        seasonalLog(
          `季节徽章购买结束：成功 ${completed}，跳过 ${skipped}`,
          failed || state.seasonalStopRequested ? "warn" : "ok"
        );
      }
      state.seasonalActionRunning = false;
      state.seasonalStopRequested = false;
      setSeasonalStatus(null);
      hideSeasonalProgress();
      updateSeasonalSummary();
      updateAllActionStates();
    }
  }
  function requestSeasonalStop() {
    if (!state.seasonalActionRunning) return;
    state.seasonalStopRequested = true;
    seasonalLog("已请求停止，将在当前请求结束后停止", "warn");
    updateSeasonalActionState();
  }

  // src/parsers/inventory.js
  function isGemSackDescription(description) {
    const hash = String(description?.market_hash_name || "").trim();
    const name = String(description?.name || "").trim();
    return hash === SIDEBAR_GEM_SACK_HASH || /sack of gems/i.test(name) || /宝石袋|袋装宝石/.test(name);
  }
  function isLooseGemDescription(description) {
    const hash = String(description?.market_hash_name || "").trim();
    const name = String(description?.name || "").trim();
    const type = String(description?.type || "").trim();
    if (isGemSackDescription(description)) return false;
    return hash === "Gems" || /^gems$/i.test(name) || /^宝石$/.test(name) || /steam gems?/i.test(type) || /^宝石$/.test(type);
  }
  function getDescriptionKey(item) {
    return `${item?.classid || ""}_${item?.instanceid || ""}`;
  }
  function getDescriptionTags(description) {
    return Array.isArray(description?.tags) ? description.tags : [];
  }
  function findDescriptionTag(description, category, internalName = null) {
    return getDescriptionTags(description).find((tag) => {
      if (String(tag?.category || "") !== category) return false;
      return internalName == null || String(tag?.internal_name || "") === internalName;
    }) || null;
  }
  function getDescriptionImageUrl(description, size = "96fx96f") {
    const rawIcon = String(description?.icon_url_large || description?.icon_url || "").trim();
    if (!rawIcon) return "";
    if (/^https?:\/\//i.test(rawIcon)) return rawIcon;
    const suffix = size ? `/${size}` : "";
    return `https://community.fastly.steamstatic.com/economy/image/${rawIcon}${suffix}`;
  }
  function getDescriptionColor(description, field) {
    const value = String(description?.[field] || "").trim();
    return /^[0-9a-f]{6}$/i.test(value) ? `#${value}` : "";
  }
  function isTradingCardDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_2");
  }
  function isProfileBackgroundDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_3");
  }
  function isEmoticonDescription(description) {
    return !!findDescriptionTag(description, "item_class", "item_class_4");
  }
  function getCommunityItemCategory(description) {
    if (isTradingCardDescription(description)) return "card";
    if (isProfileBackgroundDescription(description)) return "background";
    if (isEmoticonDescription(description)) return "emoticon";
    return "other";
  }
  function isPointsShopCommunityItemDescription(description) {
    const category = getCommunityItemCategory(description);
    return ["background", "emoticon"].includes(category) && Number(description?.marketable) !== 1 && Number(description?.tradable) !== 1;
  }
  function getCardGameAppid(description) {
    const feeApp = String(description?.market_fee_app || "").trim();
    if (/^\d+$/.test(feeApp)) return feeApp;
    const gameTag = findDescriptionTag(description, "Game");
    const match = String(gameTag?.internal_name || "").match(/^app_(\d+)$/);
    return match ? match[1] : "";
  }
  function getCardGameName(description) {
    const gameTag = findDescriptionTag(description, "Game");
    return String(gameTag?.localized_tag_name || "").trim();
  }
  function isFoilCardDescription(description) {
    return !!findDescriptionTag(description, "cardborder", "cardborder_1");
  }
  function normalizeCardName(name) {
    return String(name || "").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function getAssetAmount(asset) {
    return Math.max(1, parseInt(asset?.amount, 10) || 1);
  }
  function addInventoryCard(groupMap, asset, description) {
    if (!description || !isTradingCardDescription(description)) return false;
    const marketHashName = String(description.market_hash_name || "").trim();
    const appid = getCardGameAppid(description);
    if (!marketHashName || !appid) return false;
    const isFoil = isFoilCardDescription(description);
    const badgeKey = `${appid}_${isFoil ? 1 : 0}`;
    let group = groupMap.get(badgeKey);
    if (!group) {
      group = {
        appid,
        isFoil,
        gameName: getCardGameName(description),
        cardsByHash: /* @__PURE__ */ new Map(),
        cardsByName: /* @__PURE__ */ new Map(),
        totalCount: 0
      };
      groupMap.set(badgeKey, group);
    }
    if (!group.gameName) group.gameName = getCardGameName(description);
    const gemValue = parseGemValueFromDescription(description);
    let card = group.cardsByHash.get(marketHashName);
    if (!card) {
      card = {
        appid,
        isFoil,
        gameName: group.gameName,
        name: String(description.name || marketHashName).trim(),
        marketHashName,
        imageUrl: getDescriptionImageUrl(description),
        nameColor: getDescriptionColor(description, "name_color"),
        backgroundColor: getDescriptionColor(description, "background_color"),
        gemValue,
        totalCount: 0,
        assets: []
      };
      group.cardsByHash.set(marketHashName, card);
      const nameKey = normalizeCardName(card.name);
      if (nameKey && !group.cardsByName.has(nameKey)) {
        group.cardsByName.set(nameKey, card);
      }
    } else if (!card.gemValue && gemValue) {
      card.gemValue = gemValue;
    }
    const amount = getAssetAmount(asset);
    card.totalCount += amount;
    group.totalCount += amount;
    card.assets.push({
      assetid: String(asset.assetid || ""),
      contextid: String(asset.contextid || "6"),
      classid: String(asset.classid || ""),
      instanceid: String(asset.instanceid || ""),
      amount,
      gemValue,
      marketable: Number(description.marketable) === 1,
      tradable: Number(description.tradable) === 1
    });
    return true;
  }
  function findInventoryCardForBadgeCard(group, badgeCard) {
    if (badgeCard.marketHashName && group.cardsByHash.has(badgeCard.marketHashName)) {
      return group.cardsByHash.get(badgeCard.marketHashName);
    }
    const nameKey = normalizeCardName(badgeCard.name);
    return nameKey ? group.cardsByName.get(nameKey) || null : null;
  }
  function selectSurplusAssets(assets, surplusCount) {
    const sorted = [...assets].sort((left, right) => {
      const marketCompare = Number(right.marketable) - Number(left.marketable);
      if (marketCompare) return marketCompare;
      const tradeCompare = Number(right.tradable) - Number(left.tradable);
      if (tradeCompare) return tradeCompare;
      return String(left.assetid).localeCompare(String(right.assetid), "en");
    });
    const selected = [];
    let remaining = surplusCount;
    for (const asset of sorted) {
      if (remaining <= 0) break;
      const amount = Math.min(asset.amount, remaining);
      selected.push({ ...asset, selectedAmount: amount });
      remaining -= amount;
    }
    return selected;
  }
  function summarizeAssetIds(assets) {
    const ids = assets.map(
      (asset) => asset.selectedAmount > 1 ? `${asset.assetid}x${asset.selectedAmount}` : asset.assetid
    );
    const visible = ids.slice(0, 3).join(", ");
    return {
      text: ids.length > 3 ? `${visible} ...` : visible,
      title: ids.join("\n")
    };
  }
  function normalizeInventoryText(value) {
    const div = document.createElement("div");
    div.innerHTML = String(value ?? "").replace(/<br\s*\/?>/gi, " ");
    return decodeHtmlEntities(div.textContent || div.innerText || String(value || "")).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }
  function parseGemValueFromText(text) {
    const normalized = normalizeInventoryText(text).replace(/[，,]/g, "");
    if (!normalized) return 0;
    const direct = normalized.match(
      /(?:turn(?:ed)?\s+into|convert(?:ed)?\s+into|worth|可分解为|可转换为|可转化为|转换为|转化为|分解为|分解成)[^\d]{0,40}(\d+)\s*(?:gems?|宝石)/i
    );
    const fallback = direct || normalized.match(/(\d+)\s*(?:gems?|宝石)/i);
    return fallback ? Math.max(0, parseInt(fallback[1], 10) || 0) : 0;
  }
  function parseGemValueFromDescription(description) {
    const values = [];
    ["owner_descriptions", "descriptions", "owner_actions", "actions"].forEach((key) => {
      const list = Array.isArray(description?.[key]) ? description[key] : [];
      list.forEach((item) => {
        values.push(item?.value, item?.name, item?.link);
      });
    });
    return values.reduce((best, value) => {
      if (value == null) return best;
      return Math.max(best, parseGemValueFromText(value));
    }, 0);
  }
  function parseGooValueParams(description) {
    const links = [];
    ["owner_actions", "actions"].forEach((key) => {
      const list = Array.isArray(description?.[key]) ? description[key] : [];
      list.forEach((item) => {
        if (item?.link) links.push(String(item.link));
      });
    });
    for (const link of links) {
      const match = link.match(/GetGooValue\s*\(([^)]*)\)/i);
      if (!match) continue;
      const args = match[1].split(",").map((value) => value.trim().replace(/^['"]|['"]$/g, ""));
      if (args.length < 5) continue;
      const appid = args[args.length - 3];
      const itemType = args[args.length - 2];
      const borderColor = args[args.length - 1];
      if (/^\d+$/.test(appid) && /^\d+$/.test(itemType) && /^\d+$/.test(borderColor)) {
        return { appid, itemType, borderColor };
      }
    }
    return null;
  }
  function getCommunityItemType(description) {
    if (isTradingCardDescription(description)) {
      return isFoilCardDescription(description) ? "闪亮卡牌" : "卡牌";
    }
    const itemClass = findDescriptionTag(description, "item_class");
    return String(
      description?.type || itemClass?.localized_tag_name || "物品"
    ).replace(/\s+/g, " ").trim();
  }

  // src/services/inventory.js
  var { setStatus: setSurplusStatus, log: surplusLog } = surplusStatus;
  async function loadCommunityInventoryCards(steamId, queue) {
    const groupMap = /* @__PURE__ */ new Map();
    const language = unsafeWindow.g_strLanguage || "schinese";
    let startAssetId = "";
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    let totalCards = 0;
    do {
      page++;
      const params = new URLSearchParams({
        l: language,
        count: "2000"
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const url = `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`;
      setSurplusStatus(`读取库存第 ${page} 页`);
      const response = await queue.fetch(url);
      const data = response?.data || {};
      if (data?.success !== 1 && data?.success !== true) {
        throw new Error(data?.Error || data?.error || "Steam 未返回可用库存数据");
      }
      totalInventoryCount = Number(data.total_inventory_count || totalInventoryCount) || totalInventoryCount;
      const descriptions = /* @__PURE__ */ new Map();
      (Array.isArray(data.descriptions) ? data.descriptions : []).forEach((description) => {
        descriptions.set(getDescriptionKey(description), description);
      });
      const assets = Array.isArray(data.assets) ? data.assets : [];
      totalAssetsSeen += assets.length;
      for (const asset of assets) {
        const description = descriptions.get(getDescriptionKey(asset));
        if (addInventoryCard(groupMap, asset, description)) {
          totalCards += getAssetAmount(asset);
        }
      }
      surplusLog(
        `库存第 ${page} 页：读取 ${assets.length} 件，累计卡牌 ${totalCards} 张`,
        "info"
      );
      startAssetId = data.more_items && data.last_assetid ? String(data.last_assetid) : "";
    } while (startAssetId && !state.surplusStopRequested);
    const groups = [...groupMap.values()].sort((left, right) => {
      const nameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
      if (nameCompare) return nameCompare;
      if (left.appid !== right.appid) return Number(left.appid) - Number(right.appid);
      return Number(left.isFoil) - Number(right.isFoil);
    });
    return {
      groups,
      totalInventoryCount,
      totalAssetsSeen,
      totalCards,
      cardTypeCount: groups.reduce((sum, group) => sum + group.cardsByHash.size, 0)
    };
  }

  // src/sidebar/gems.js
  async function loadSidebarGemInfo(steamId) {
    if (!steamId) throw new Error("未找到 SteamID，无法读取库存");
    const language = unsafeWindow.g_strLanguage || "schinese";
    let startAssetId = "";
    let looseGems = 0;
    let sackCount = 0;
    let totalInventoryCount = 0;
    do {
      const params = new URLSearchParams({
        l: language,
        count: "2000"
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const data = await stchRequestJson(
        `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`
      );
      if (data?.success !== 1 && data?.success !== true) {
        throw new Error(data?.Error || data?.error || "Steam 未返回库存数据");
      }
      totalInventoryCount = Number(data.total_inventory_count || totalInventoryCount) || totalInventoryCount;
      const descriptions = /* @__PURE__ */ new Map();
      (Array.isArray(data.descriptions) ? data.descriptions : []).forEach((description) => {
        descriptions.set(getDescriptionKey(description), description);
      });
      for (const asset of Array.isArray(data.assets) ? data.assets : []) {
        const description = descriptions.get(getDescriptionKey(asset));
        const amount = getAssetAmount(asset);
        if (isGemSackDescription(description)) {
          sackCount += amount;
        } else if (isLooseGemDescription(description)) {
          looseGems += amount;
        }
      }
      startAssetId = data.more_items && data.last_assetid ? String(data.last_assetid) : "";
    } while (startAssetId);
    return {
      looseGems,
      sackCount,
      totalGems: looseGems + sackCount * GEM_SACK_SIZE,
      totalInventoryCount
    };
  }
  async function loadSidebarGemPrice(queue = null) {
    const params = new URLSearchParams({
      appid: "753",
      currency: "23",
      market_hash_name: SIDEBAR_GEM_SACK_HASH
    });
    const url = `https://steamcommunity.com/market/priceoverview/?${params.toString()}`;
    const data = queue ? (await queue.fetch(url))?.data : await stchRequestJson(url);
    const lowestCents = parsePrice(data?.lowest_price);
    const medianCents = parsePrice(data?.median_price);
    const priceCents = lowestCents || medianCents;
    return {
      priceCents,
      source: lowestCents ? "在售最低" : medianCents ? "平均价格" : "暂无价格",
      volume: parseInt(String(data?.volume || "").replace(/[^\d]/g, ""), 10) || 0
    };
  }

  // src/utils/market-fees.js
  function getMarketFeesForSellerReceive(sellerCents) {
    const received = Math.max(0, Math.floor(Number(sellerCents) || 0));
    if (received <= 0) {
      return { steamFee: 0, publisherFee: 0, totalFees: 0, buyerCents: 0 };
    }
    const steamFee = Math.max(1, Math.floor(received * MARKET_STEAM_FEE_RATE));
    const publisherFee = Math.max(1, Math.floor(received * MARKET_PUBLISHER_FEE_RATE));
    return {
      steamFee,
      publisherFee,
      totalFees: steamFee + publisherFee,
      buyerCents: received + steamFee + publisherFee
    };
  }
  function getBuyerPriceForSellerReceive(sellerCents) {
    return getMarketFeesForSellerReceive(sellerCents).buyerCents;
  }
  function getSellerReceiveForBuyerPrice(buyerCents) {
    const total = Math.max(0, Math.floor(Number(buyerCents) || 0));
    let low = 0;
    let high = total;
    let best = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (getBuyerPriceForSellerReceive(mid) <= total) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return best;
  }
  function getGemSackSellerNetCents(priceCents) {
    return getSellerReceiveForBuyerPrice(priceCents);
  }
  function getGemValueSellerNetCents(gems, gemSackPriceCents) {
    const sackNet = getGemSackSellerNetCents(gemSackPriceCents);
    return sackNet > 0 ? sackNet * Math.max(0, Number(gems) || 0) / GEM_SACK_SIZE : 0;
  }
  function getGemBreakEvenBuyerPrice(gems, gemSackPriceCents) {
    const desiredSellerNet = Math.ceil(getGemValueSellerNetCents(gems, gemSackPriceCents));
    return desiredSellerNet > 0 ? getBuyerPriceForSellerReceive(desiredSellerNet) : 0;
  }

  // src/features/surplus.js
  var { log: surplusLog2, setStatus: setSurplusStatus2, setProgress: setSurplusProgress, hideProgress: hideSurplusProgress } = surplusStatus;
  function getSurplusReservePolicy(info) {
    const targetLevel = getBadgeTargetLevel(info);
    const level = Math.max(0, Number(info?.level) || 0);
    if (info?.isUnlimitedLevelBadge) {
      const eligible = level >= 1;
      return {
        targetLevel,
        level,
        eligible,
        badgeMaxed: eligible,
        reservePerCard: 0
      };
    }
    return {
      targetLevel,
      level,
      eligible: true,
      badgeMaxed: level >= targetLevel,
      reservePerCard: Math.max(0, targetLevel - level)
    };
  }
  function applySurplusMarketInfo(result, price, gemSackPriceCents) {
    result.priceCents = price && !price.noPriceData ? price.lowestSellCents || 0 : 0;
    result.medianCents = price && !price.noPriceData ? price.medianCents || 0 : 0;
    result.volume = price ? price.volume : null;
    result.priceSource = price?.priceSource || (price?.noPriceData ? "none" : "failed");
    result.marketNetCents = result.priceCents ? getSellerReceiveForBuyerPrice(result.priceCents) : 0;
    result.gemValueNetCents = getGemValueSellerNetCents(
      result.gemValue,
      gemSackPriceCents
    );
    result.gemBetter = result.marketNetCents > 0 && result.gemValueNetCents > result.marketNetCents;
  }
  async function resolveSurplusForBadge(group, profileUrl, queue) {
    const response = await queue.fetch(
      getGameCardsUrl(profileUrl, group.appid, group, { language: "english" })
    );
    if (!response?.text?.includes("badge_card_set_card")) {
      throw new Error("未找到卡牌套组");
    }
    const info = parseGameCardsHtml(response.text, group.appid, group.isFoil);
    info.appid = group.appid;
    info.isFoil = group.isFoil;
    info.gameName = info.gameName || group.gameName || "";
    const policy = getSurplusReservePolicy(info);
    const { targetLevel, level, badgeMaxed, reservePerCard } = policy;
    if (!policy.eligible) return [];
    const results = [];
    for (const badgeCard of info.cards) {
      const inventoryCard = findInventoryCardForBadgeCard(group, badgeCard);
      if (!inventoryCard) continue;
      const surplusCount = Math.max(0, inventoryCard.totalCount - reservePerCard);
      if (surplusCount <= 0) continue;
      const surplusAssets = selectSurplusAssets(inventoryCard.assets, surplusCount);
      const marketableCount = surplusAssets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.selectedAmount : 0),
        0
      );
      const tradableCount = surplusAssets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.selectedAmount : 0),
        0
      );
      const assetSummary = summarizeAssetIds(surplusAssets);
      const totalGems = surplusAssets.reduce(
        (sum, asset) => sum + (asset.selectedAmount || 0) * (asset.gemValue || inventoryCard.gemValue || 0),
        0
      );
      results.push({
        appid: group.appid,
        isFoil: group.isFoil,
        gameName: info.gameName || group.gameName || "",
        level,
        targetLevel,
        badgeMaxed,
        isUnlimitedLevelBadge: !!info.isUnlimitedLevelBadge,
        cardName: badgeCard.name || inventoryCard.name,
        marketHashName: badgeCard.marketHashName || inventoryCard.marketHashName,
        imageUrl: inventoryCard.imageUrl || "",
        nameColor: inventoryCard.nameColor || "",
        backgroundColor: inventoryCard.backgroundColor || "",
        gemValue: inventoryCard.gemValue || 0,
        totalGems,
        inventoryCount: inventoryCard.totalCount,
        reservedCount: reservePerCard,
        surplusCount,
        marketableCount,
        tradableCount,
        assets: surplusAssets,
        assetText: assetSummary.text,
        assetTitle: assetSummary.title
      });
    }
    return results;
  }
  function getVisibleSurplusResults() {
    return (state.surplusResults || []).filter((result) => {
      if (state.cfg.surplusOnlyMaxed && !result.badgeMaxed) return false;
      if (state.cfg.surplusOnlyTradable && result.tradableCount <= 0) return false;
      return true;
    });
  }
  function getSurplusResultKey(result) {
    const assetKey = (result.assets || []).map((asset) => `${asset.assetid || ""}x${asset.selectedAmount || asset.amount || 1}`).join(",");
    return [
      "card",
      result.appid || "",
      result.isFoil ? 1 : 0,
      result.marketHashName || result.cardName || "",
      assetKey
    ].join("|");
  }
  function getSelectedSurplusResults() {
    const selected = state.selectedSurplusResults || /* @__PURE__ */ new Set();
    return (state.surplusResults || []).filter(
      (result) => selected.has(getSurplusResultKey(result))
    );
  }
  function setAllVisibleSurplusSelection(selected) {
    if (!state.selectedSurplusResults) state.selectedSurplusResults = /* @__PURE__ */ new Set();
    const visible = getVisibleSurplusResults();
    for (const result of visible) {
      const key = getSurplusResultKey(result);
      if (selected) state.selectedSurplusResults.add(key);
      else state.selectedSurplusResults.delete(key);
    }
    renderSurplusResults();
  }
  function pruneSelectedSurplusResults(visible) {
    const selected = state.selectedSurplusResults || /* @__PURE__ */ new Set();
    const visibleKeys = new Set(visible.map(getSurplusResultKey));
    for (const key of [...selected]) {
      if (!visibleKeys.has(key)) selected.delete(key);
    }
  }
  function updateSurplusSummary() {
    const row = document.getElementById("stch-surplus-summary-row");
    const summary = document.getElementById("stch-surplus-summary");
    if (!row || !summary) return;
    const visible = getVisibleSurplusResults();
    if (visible.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }
    const badgeCount = new Set(visible.map((result) => `${result.appid}_${result.isFoil ? 1 : 0}`)).size;
    const surplusTotal = visible.reduce((sum, result) => sum + result.surplusCount, 0);
    const marketableTotal = visible.reduce((sum, result) => sum + result.marketableCount, 0);
    const tradableTotal = visible.reduce((sum, result) => sum + result.tradableCount, 0);
    const selectedCount = getSelectedSurplusResults().filter(
      (result) => visible.some((visibleResult) => getSurplusResultKey(visibleResult) === getSurplusResultKey(result))
    ).length;
    summary.innerHTML = `共 <b>${badgeCount}</b> 个徽章 · <b>${visible.length}</b> 种卡牌 · 多余 <b>${surplusTotal}</b> 张 · 可出售 <b>${marketableTotal}</b> 张 · 可交易 <b>${tradableTotal}</b> 张 · 已选择 <b>${selectedCount}</b> 项`;
    row.style.display = "";
  }
  function renderSurplusResults() {
    const list = document.getElementById("stch-surplus-list");
    if (!list) return;
    list.innerHTML = "";
    list.classList.add("stch-inventory-grid");
    const visible = getVisibleSurplusResults();
    pruneSelectedSurplusResults(visible);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-inventory-empty";
      empty.textContent = state.surplusScanning ? "正在检测多余卡牌..." : state.surplusResults.length > 0 ? "当前筛选下没有多余卡牌" : "尚未检测到多余卡牌";
      list.appendChild(empty);
      updateSurplusSummary();
      updateSurplusActionState();
      return;
    }
    for (const result of visible) {
      const key = getSurplusResultKey(result);
      const tile = document.createElement("div");
      tile.className = "stch-inv-tile";
      const volumeZero = result.volume === 0;
      tile.classList.toggle("stch-volume-zero", volumeZero);
      tile.classList.toggle(
        "stch-gem-better",
        state.cfg.surplusCompareGems && result.gemBetter
      );
      tile.dataset.key = key;
      tile.classList.toggle("selected", state.selectedSurplusResults?.has(key));
      tile.title = [
        `${result.gameName || "未知游戏"} · ${result.cardName || result.marketHashName || "未知卡牌"}`,
        result.isUnlimitedLevelBadge ? `特卖徽章 Lv${result.level}（Lv1 后可处理多余卡牌）` : `徽章 Lv${result.level}/${result.targetLevel}`,
        `库存 ${result.inventoryCount}，预留 ${result.reservedCount}，多余 ${result.surplusCount}`,
        `可出售 ${result.marketableCount}，可交易 ${result.tradableCount}`,
        result.volume === 0 ? "市场成交量 0" : Number.isFinite(result.volume) ? `市场成交量 ${result.volume}` : "市场价格尚未读取",
        result.priceCents ? `市场参考 ¥${formatCNY(result.priceCents)}，出售税后约 ¥${formatCNY(result.marketNetCents)}` : "",
        result.gemValueNetCents ? `${result.gemValue} 宝石/张，税后折算约 ¥${formatCNY(result.gemValueNetCents)}` : "",
        state.cfg.surplusCompareGems && result.gemBetter ? "宝石价值高于出售税后到手价" : "",
        result.assetTitle ? `资产ID:
${result.assetTitle}` : ""
      ].filter(Boolean).join("\n");
      if (result.nameColor) tile.style.borderColor = result.nameColor;
      if (result.backgroundColor) tile.style.backgroundColor = result.backgroundColor;
      if (result.imageUrl) {
        const image = document.createElement("img");
        image.src = result.imageUrl;
        image.alt = result.cardName || result.marketHashName || "";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "stch-inv-placeholder";
        placeholder.textContent = result.cardName || "?";
        tile.appendChild(placeholder);
      }
      const count = document.createElement("span");
      count.className = "stch-inv-badge";
      count.textContent = `x${result.surplusCount}`;
      count.title = "多余数量";
      tile.appendChild(count);
      if (result.marketableCount > 0) {
        const market = document.createElement("span");
        market.className = "stch-inv-badge stch-inv-badge-left";
        market.textContent = `可售 ${result.marketableCount}`;
        tile.appendChild(market);
      }
      const name = document.createElement("div");
      name.className = "stch-inv-name";
      name.textContent = result.cardName || result.marketHashName || "未知卡牌";
      tile.appendChild(name);
      tile.addEventListener("click", () => {
        if (!state.selectedSurplusResults) state.selectedSurplusResults = /* @__PURE__ */ new Set();
        if (state.selectedSurplusResults.has(key)) {
          state.selectedSurplusResults.delete(key);
          tile.classList.remove("selected");
        } else {
          state.selectedSurplusResults.add(key);
          tile.classList.add("selected");
        }
        updateSurplusSummary();
        updateSurplusActionState();
      });
      list.appendChild(tile);
    }
    updateSurplusSummary();
    updateSurplusActionState();
  }
  async function startSurplusScan() {
    if (state.surplusScanning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.grindScanning) {
      return;
    }
    if (location.hostname !== "steamcommunity.com") {
      surplusLog2("请在 Steam 社区徽章页或库存页使用多余物品处理", "warn");
      return;
    }
    const profileUrl = getProfileUrl();
    const steamId = getSteamId();
    if (!profileUrl || !steamId) {
      surplusLog2("未找到 Steam 个人资料地址或 SteamID", "err");
      return;
    }
    state.surplusScanning = true;
    state.surplusStopRequested = false;
    state.surplusResults = [];
    state.selectedSurplusResults = /* @__PURE__ */ new Set();
    state.surplusGemPrice = null;
    const logBox = document.getElementById("stch-surplus-log");
    if (logBox) logBox.innerHTML = "";
    renderSurplusResults();
    updateAllActionStates();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setSurplusStatus2,
      surplusLog2
    );
    state.surplusQueue = queue;
    try {
      surplusLog2("【阶段 1/3】正在读取 Steam 社区库存");
      setSurplusProgress(0, 1, "阶段1: 读取库存");
      const inventory = await loadCommunityInventoryCards(steamId, queue);
      if (state.surplusStopRequested) {
        surplusLog2("已停止检测", "warn");
        return;
      }
      if (inventory.groups.length === 0) {
        surplusLog2("库存中没有检测到集换式卡牌", "warn");
        renderSurplusResults();
        return;
      }
      surplusLog2(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，卡牌 ${inventory.totalCards} 张，${inventory.cardTypeCount} 种，${inventory.groups.length} 个徽章候选`,
        "ok"
      );
      surplusLog2("【阶段 2/3】正在读取徽章等级并计算升满后剩余");
      let scanned = 0;
      let failed = 0;
      for (let index = 0; index < inventory.groups.length; index++) {
        if (state.surplusStopRequested) break;
        const group = inventory.groups[index];
        scanned++;
        const label = `${group.gameName || group.appid}${group.isFoil ? "（闪亮）" : ""}`;
        setSurplusProgress(
          index,
          inventory.groups.length,
          `阶段2: ${index + 1}/${inventory.groups.length} · ${label}`
        );
        setSurplusStatus2(`读取徽章: ${label}`);
        try {
          const rows = await resolveSurplusForBadge(group, profileUrl, queue);
          if (rows.length === 0) {
            if (state.cfg.showNoResultLogs) {
              surplusLog2(`[${group.appid}] ${label}: 没有升满后剩余`, "info");
            }
            continue;
          }
          state.surplusResults.push(...rows);
          const surplusCount = rows.reduce((sum, row) => sum + row.surplusCount, 0);
          surplusLog2(
            `[${group.appid}] ${label}: ${rows.length} 种卡牌，多余 ${surplusCount} 张`,
            "ok"
          );
          renderSurplusResults();
        } catch (error) {
          if (state.surplusStopRequested) break;
          failed++;
          surplusLog2(
            `[${group.appid}] ${label}: 读取失败 ${error?.message || error?.status || error}`,
            "warn"
          );
        }
      }
      state.surplusResults.sort((left, right) => {
        const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
        if (gameCompare) return gameCompare;
        if (left.appid !== right.appid) return Number(left.appid) - Number(right.appid);
        if (left.isFoil !== right.isFoil) return Number(left.isFoil) - Number(right.isFoil);
        return (left.cardName || "").localeCompare(right.cardName || "", "zh-CN");
      });
      renderSurplusResults();
      let priceFailed = 0;
      let zeroVolume = 0;
      if (!state.surplusStopRequested && state.surplusResults.length > 0) {
        surplusLog2("【阶段 3/3】正在查询市场成交量并计算宝石价值");
        try {
          state.surplusGemPrice = await loadSidebarGemPrice(queue);
          if (state.surplusGemPrice.priceCents) {
            surplusLog2(
              `宝石袋 ${state.surplusGemPrice.source} ¥${formatCNY(state.surplusGemPrice.priceCents)}`,
              "info"
            );
          }
        } catch (error) {
          surplusLog2(`宝石袋价格读取失败: ${error?.message || error}`, "warn");
        }
        const priceCache = /* @__PURE__ */ new Map();
        for (let index = 0; index < state.surplusResults.length; index++) {
          if (state.surplusStopRequested) break;
          const result = state.surplusResults[index];
          setSurplusProgress(
            index,
            state.surplusResults.length,
            `阶段3: ${index + 1}/${state.surplusResults.length} · ${result.cardName || result.marketHashName}`
          );
          setSurplusStatus2(`查询市场: ${result.cardName || result.marketHashName}`);
          let price = null;
          if (result.marketHashName) {
            if (priceCache.has(result.marketHashName)) {
              price = priceCache.get(result.marketHashName);
            } else {
              price = await priceCard(result.marketHashName, queue);
              priceCache.set(result.marketHashName, price);
            }
          }
          applySurplusMarketInfo(
            result,
            price,
            state.surplusGemPrice?.priceCents || 0
          );
          if (!price) priceFailed++;
          if (result.volume === 0) zeroVolume++;
          renderSurplusResults();
        }
        if (!state.surplusStopRequested) {
          surplusLog2(
            `市场比较完成：成交量为 0 的卡牌 ${zeroVolume} 种，查价失败 ${priceFailed} 种`,
            priceFailed ? "warn" : "ok"
          );
        }
      }
      if (state.surplusStopRequested) {
        surplusLog2("已停止检测", "warn");
      } else {
        const totalSurplus = state.surplusResults.reduce((sum, result) => sum + result.surplusCount, 0);
        surplusLog2(
          `检测完成：读取 ${scanned} 个徽章，失败 ${failed} 个，找到 ${state.surplusResults.length} 种多余卡牌 / ${totalSurplus} 张`,
          failed ? "warn" : "ok"
        );
      }
    } catch (error) {
      if (!state.surplusStopRequested) {
        surplusLog2(`检测中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      state.surplusQueue = null;
      state.surplusScanning = false;
      state.surplusStopRequested = false;
      hideSurplusProgress();
      setSurplusStatus2(null);
      renderSurplusResults();
      updateAllActionStates();
    }
  }
  function requestSurplusStop() {
    if (!state.surplusScanning) return;
    state.surplusStopRequested = true;
    state.surplusQueue?.stop();
    surplusLog2("已请求停止检测", "warn");
    updateSurplusActionState();
  }

  // src/features/grind.js
  var { log: grindLog, setStatus: setGrindStatus, setProgress: setGrindProgress, hideProgress: hideGrindProgress } = grindStatus;
  function getBlacklistAppids() {
    return new Set(
      (state.cfg.blacklist || "").split(",").map((value) => value.trim()).filter(Boolean)
    );
  }
  function isBlacklistedAppid(appid) {
    return !!appid && getBlacklistAppids().has(String(appid));
  }
  var grindGemValueCache = /* @__PURE__ */ new Map();
  async function getGrindGemValue(description, queue) {
    const parsedValue = parseGemValueFromDescription(description);
    if (parsedValue > 0) return parsedValue;
    const params = parseGooValueParams(description);
    if (!params) return 0;
    const key = `${params.appid}_${params.itemType}_${params.borderColor}`;
    if (grindGemValueCache.has(key)) return grindGemValueCache.get(key);
    try {
      const url = `https://steamcommunity.com/auction/ajaxgetgoovalueforitemtype/?appid=${encodeURIComponent(params.appid)}&item_type=${encodeURIComponent(params.itemType)}&border_color=${encodeURIComponent(params.borderColor)}`;
      const response = await queue.fetch(url);
      const value = Math.max(0, parseInt(response?.data?.goo_value, 10) || 0);
      grindGemValueCache.set(key, value);
      return value;
    } catch (_) {
      if (state.grindStopRequested || queue.stopped) return 0;
      grindGemValueCache.set(key, 0);
      return 0;
    }
  }
  function getSurplusAssetAllowance() {
    const allowance = /* @__PURE__ */ new Map();
    for (const result of state.surplusResults || []) {
      for (const asset of result.assets || []) {
        const assetid = String(asset.assetid || "");
        if (!assetid) continue;
        allowance.set(assetid, (allowance.get(assetid) || 0) + (asset.selectedAmount || 0));
      }
    }
    return allowance;
  }
  function addGrindItem(groupMap, asset, description, amount, source, gemValue, pointsShop = false) {
    if (!description || amount <= 0) return "skipped";
    if (isGemSackDescription(description) || isLooseGemDescription(description)) return "gem";
    const unitGemValue = Math.max(0, parseInt(gemValue, 10) || 0);
    if (unitGemValue <= 0) return "noGemValue";
    const appid = getCardGameAppid(description);
    if (isBlacklistedAppid(appid)) return "blacklisted";
    const marketHashName = String(description.market_hash_name || "").trim();
    const key = [
      appid || "0",
      marketHashName || getDescriptionKey(description),
      unitGemValue,
      source
    ].join("|");
    let item = groupMap.get(key);
    if (!item) {
      item = {
        appid,
        gameName: getCardGameName(description),
        type: getCommunityItemType(description),
        itemName: String(description.name || marketHashName || "未知物品").trim(),
        marketHashName,
        imageUrl: getDescriptionImageUrl(description),
        nameColor: getDescriptionColor(description, "name_color"),
        backgroundColor: getDescriptionColor(description, "background_color"),
        gemValue: unitGemValue,
        quantity: 0,
        totalGems: 0,
        marketableCount: 0,
        tradableCount: 0,
        pointsShopCount: 0,
        source,
        assets: []
      };
      groupMap.set(key, item);
    }
    if (!item.gameName) item.gameName = getCardGameName(description);
    const marketable = Number(description.marketable) === 1;
    const tradable = Number(description.tradable) === 1;
    item.quantity += amount;
    item.totalGems += amount * unitGemValue;
    if (marketable) item.marketableCount += amount;
    if (tradable) item.tradableCount += amount;
    if (pointsShop) item.pointsShopCount += amount;
    item.assets.push({
      assetid: String(asset.assetid || ""),
      contextid: String(asset.contextid || "6"),
      amount,
      originalAmount: getAssetAmount(asset),
      marketable,
      tradable,
      pointsShop
    });
    return "added";
  }
  function selectDuplicateSurplusItem(item, reserveCopies) {
    const inventoryCount = (item.assets || []).reduce(
      (sum, asset) => sum + Math.max(0, Number(asset.amount) || 0),
      0
    );
    const reservedCount = Math.min(
      inventoryCount,
      Math.max(0, Math.floor(Number(reserveCopies) || 0))
    );
    let remaining = Math.max(0, inventoryCount - reservedCount);
    if (remaining <= 0) return null;
    const assets = [...item.assets || []].sort((left, right) => {
      const marketCompare = Number(right.marketable) - Number(left.marketable);
      if (marketCompare) return marketCompare;
      const tradeCompare = Number(right.tradable) - Number(left.tradable);
      if (tradeCompare) return tradeCompare;
      const pointsCompare = Number(left.pointsShop) - Number(right.pointsShop);
      if (pointsCompare) return pointsCompare;
      return String(left.assetid || "").localeCompare(String(right.assetid || ""), "en");
    }).flatMap((asset) => {
      if (remaining <= 0) return [];
      const amount = Math.min(Math.max(0, Number(asset.amount) || 0), remaining);
      remaining -= amount;
      return amount > 0 ? [{ ...asset, amount }] : [];
    });
    const quantity = assets.reduce((sum, asset) => sum + asset.amount, 0);
    return {
      ...item,
      inventoryCount,
      reservedCount,
      quantity,
      totalGems: quantity * item.gemValue,
      marketableCount: assets.reduce(
        (sum, asset) => sum + (asset.marketable ? asset.amount : 0),
        0
      ),
      tradableCount: assets.reduce(
        (sum, asset) => sum + (asset.tradable ? asset.amount : 0),
        0
      ),
      pointsShopCount: assets.reduce(
        (sum, asset) => sum + (asset.pointsShop ? asset.amount : 0),
        0
      ),
      assets
    };
  }
  async function loadGrindInventoryItems(steamId, queue) {
    const groupMap = /* @__PURE__ */ new Map();
    const language = unsafeWindow.g_strLanguage || "schinese";
    const surplusAllowance = getSurplusAssetAllowance();
    const includeCards = !!state.cfg.grindIncludeSurplusCards;
    const reserveCopies = Math.max(0, Math.floor(Number(state.cfg.grindReserveCopies) || 0));
    const includePointsShopItems = !!state.cfg.grindIncludePointsShopItems;
    const itemMode = ["background", "emoticon"].includes(state.cfg.surplusItemMode) ? state.cfg.surplusItemMode : "background";
    let startAssetId = "";
    let page = 0;
    let totalInventoryCount = 0;
    let totalAssetsSeen = 0;
    const skipped = {
      cardsWithoutSurplus: 0,
      noGemValue: 0,
      blacklisted: 0,
      gems: 0,
      pointsShop: 0,
      reserved: 0
    };
    do {
      page++;
      const params = new URLSearchParams({
        l: language,
        count: "2000"
      });
      if (startAssetId) params.set("start_assetid", startAssetId);
      const url = `https://steamcommunity.com/inventory/${steamId}/753/6?${params.toString()}`;
      setGrindStatus(`读取库存第 ${page} 页`);
      const response = await queue.fetch(url);
      const data = response?.data || {};
      if (data?.success !== 1 && data?.success !== true) {
        throw new Error(data?.Error || data?.error || "Steam 未返回可用库存数据");
      }
      totalInventoryCount = Number(data.total_inventory_count || totalInventoryCount) || totalInventoryCount;
      const descriptions = /* @__PURE__ */ new Map();
      (Array.isArray(data.descriptions) ? data.descriptions : []).forEach((description) => {
        descriptions.set(getDescriptionKey(description), description);
      });
      const assets = Array.isArray(data.assets) ? data.assets : [];
      totalAssetsSeen += assets.length;
      for (const asset of assets) {
        if (state.grindStopRequested) break;
        const description = descriptions.get(getDescriptionKey(asset));
        if (!description) continue;
        const assetAmount = getAssetAmount(asset);
        if (isGemSackDescription(description) || isLooseGemDescription(description)) {
          skipped.gems += assetAmount;
          continue;
        }
        if (isBlacklistedAppid(getCardGameAppid(description))) {
          skipped.blacklisted += assetAmount;
          continue;
        }
        if (getCommunityItemCategory(description) !== itemMode) {
          continue;
        }
        const pointsShop = isPointsShopCommunityItemDescription(description);
        if (pointsShop && !includePointsShopItems) {
          skipped.pointsShop += assetAmount;
          continue;
        }
        let amount = assetAmount;
        if (isTradingCardDescription(description)) {
          const allowed = surplusAllowance.get(String(asset.assetid || "")) || 0;
          amount = includeCards ? Math.min(assetAmount, allowed) : 0;
          if (amount <= 0) {
            skipped.cardsWithoutSurplus += assetAmount;
            continue;
          }
        }
        const gemValue = await getGrindGemValue(description, queue);
        const result = addGrindItem(
          groupMap,
          asset,
          description,
          amount,
          isTradingCardDescription(description) ? "card" : "item",
          gemValue,
          pointsShop
        );
        if (result === "noGemValue") skipped.noGemValue += amount;
        else if (result === "blacklisted") skipped.blacklisted += amount;
        else if (result === "gem") skipped.gems += amount;
      }
      grindLog(
        `库存第 ${page} 页：读取 ${assets.length} 件，累计候选 ${groupMap.size} 种`,
        "info"
      );
      startAssetId = data.more_items && data.last_assetid ? String(data.last_assetid) : "";
    } while (startAssetId && !state.grindStopRequested);
    const items = [...groupMap.values()].flatMap((item) => {
      const surplus = selectDuplicateSurplusItem(item, reserveCopies);
      skipped.reserved += surplus ? surplus.reservedCount : item.quantity;
      return surplus ? [surplus] : [];
    }).sort((left, right) => {
      const adviceCompare = Number(right.totalGems) - Number(left.totalGems);
      if (adviceCompare) return adviceCompare;
      const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
      if (gameCompare) return gameCompare;
      return (left.itemName || "").localeCompare(right.itemName || "", "zh-CN");
    });
    return {
      items,
      totalInventoryCount,
      totalAssetsSeen,
      skipped
    };
  }
  function applyGrindRecommendation(item, gemSackPriceCents) {
    item.gemSackPriceCents = gemSackPriceCents || 0;
    item.gemValueNetCents = getGemValueSellerNetCents(item.totalGems, gemSackPriceCents);
    item.unitGemValueNetCents = getGemValueSellerNetCents(item.gemValue, gemSackPriceCents);
    item.breakEvenPriceCents = getGemBreakEvenBuyerPrice(item.gemValue, gemSackPriceCents);
    item.marketNetCents = item.priceCents ? getSellerReceiveForBuyerPrice(item.priceCents) : 0;
    if (!gemSackPriceCents) {
      item.recommendationKey = "unknown";
      item.recommendationLabel = "缺宝石价";
      item.recommendationClass = "warn";
    } else if (!item.marketHashName || item.marketableCount <= 0) {
      item.recommendationKey = "grind";
      item.recommendationLabel = "分解";
      item.recommendationClass = "ok";
      item.recommendationReason = "不可出售或缺少市场标识";
    } else if (!item.priceCents) {
      item.recommendationKey = "grind";
      item.recommendationLabel = "分解";
      item.recommendationClass = "ok";
      item.recommendationReason = "市场暂无可用价格";
    } else if (item.marketNetCents <= item.unitGemValueNetCents) {
      item.recommendationKey = "grind";
      item.recommendationLabel = "分解";
      item.recommendationClass = "ok";
      item.recommendationReason = `卖出税后约 ¥${formatCNY(item.marketNetCents)}，低于分解宝石税后约 ¥${formatCNY(item.unitGemValueNetCents)}`;
    } else {
      item.recommendationKey = "sell";
      item.recommendationLabel = "卖出";
      item.recommendationClass = "info";
      item.recommendationReason = `卖出税后约 ¥${formatCNY(item.marketNetCents)}，高于分解宝石税后约 ¥${formatCNY(item.unitGemValueNetCents)}`;
    }
    return item;
  }
  function getVisibleGrindResults() {
    return (state.grindResults || []).filter((item) => {
      if (state.cfg.grindOnlyRecommended && item.recommendationKey !== "grind") return false;
      if (state.cfg.surplusOnlyTradable && item.tradableCount <= 0) return false;
      return true;
    });
  }
  function getGrindResultKey(item) {
    const assetKey = (item.assets || []).map((asset) => `${asset.assetid || ""}x${asset.amount || 1}`).join(",");
    return [
      "item",
      item.appid || "",
      item.marketHashName || item.itemName || "",
      item.gemValue || 0,
      item.source || "",
      assetKey
    ].join("|");
  }
  function getSelectedGrindResults() {
    const selected = state.selectedGrindResults || /* @__PURE__ */ new Set();
    return (state.grindResults || []).filter(
      (item) => selected.has(getGrindResultKey(item))
    );
  }
  function setAllVisibleGrindSelection(selected) {
    if (!state.selectedGrindResults) state.selectedGrindResults = /* @__PURE__ */ new Set();
    const visible = getVisibleGrindResults();
    for (const item of visible) {
      const key = getGrindResultKey(item);
      if (selected) state.selectedGrindResults.add(key);
      else state.selectedGrindResults.delete(key);
    }
    renderGrindResults();
  }
  function pruneSelectedGrindResults(visible) {
    const selected = state.selectedGrindResults || /* @__PURE__ */ new Set();
    const visibleKeys = new Set(visible.map(getGrindResultKey));
    for (const key of [...selected]) {
      if (!visibleKeys.has(key)) selected.delete(key);
    }
  }
  function updateGrindSummary() {
    const row = document.getElementById("stch-grind-summary-row");
    const summary = document.getElementById("stch-grind-summary");
    if (!row || !summary) return;
    const visible = getVisibleGrindResults();
    if (visible.length === 0) {
      row.style.display = "none";
      summary.textContent = "";
      return;
    }
    const recommended = (state.grindResults || []).filter((item) => item.recommendationKey === "grind");
    const visibleQuantity = visible.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedQuantity = recommended.reduce((sum, item) => sum + item.quantity, 0);
    const recommendedGems = recommended.reduce((sum, item) => sum + item.totalGems, 0);
    const selectedCount = getSelectedGrindResults().filter(
      (item) => visible.some((visibleItem) => getGrindResultKey(visibleItem) === getGrindResultKey(item))
    ).length;
    const gemPrice = state.grindGemPrice || {};
    const priceText = gemPrice.priceCents ? `宝石袋 ¥${formatCNY(gemPrice.priceCents)} / 税后 ¥${formatCNY(getGemSackSellerNetCents(gemPrice.priceCents))}` : "暂无宝石袋价格";
    summary.innerHTML = `显示 <b>${visible.length}</b> 种 / <b>${visibleQuantity}</b> 件 · 建议分解 <b>${recommended.length}</b> 种 / <b>${recommendedQuantity}</b> 件 · 预计 <b>${formatInt(recommendedGems)}</b> 宝石 · 已选择 <b>${selectedCount}</b> 项 · ${priceText}`;
    row.style.display = "";
  }
  function renderGrindResults() {
    const list = document.getElementById("stch-grind-list");
    if (!list) return;
    list.innerHTML = "";
    list.classList.add("stch-inventory-grid");
    const visible = getVisibleGrindResults();
    pruneSelectedGrindResults(visible);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "stch-inventory-empty";
      empty.textContent = state.grindScanning ? "正在扫描可分解物品..." : state.grindResults.length > 0 ? "当前筛选下没有建议分解物品" : "尚未扫描可分解物品";
      list.appendChild(empty);
      updateGrindSummary();
      updateGrindActionState();
      return;
    }
    for (const item of visible) {
      const key = getGrindResultKey(item);
      const assetSummary = summarizeAssetIds(item.assets.map((asset) => ({
        assetid: asset.assetid,
        selectedAmount: asset.amount
      })));
      const marketText = item.priceCents ? `¥${formatCNY(item.priceCents)}` : item.marketHashName && item.marketableCount > 0 ? "无价" : "不可售";
      const marketTitle = item.priceCents ? `${item.priceSource || "市场价"}；卖出税后约 ¥${formatCNY(item.marketNetCents)}` : item.recommendationReason || "";
      const breakEvenText = item.breakEvenPriceCents ? `¥${formatCNY(item.breakEvenPriceCents)}` : "—";
      const tile = document.createElement("div");
      tile.className = "stch-inv-tile";
      tile.classList.toggle("stch-volume-zero", item.volume === 0);
      tile.dataset.key = key;
      tile.classList.toggle("selected", state.selectedGrindResults?.has(key));
      tile.title = [
        `${item.gameName || "未知游戏"} · ${item.itemName || item.marketHashName || "未知物品"}`,
        `类型 ${item.type || "物品"}；库存 ${item.inventoryCount}，保留 ${item.reservedCount}，多余 ${item.quantity}`,
        item.pointsShopCount ? `多余数量中含点数商店类副本 ${item.pointsShopCount} 件` : "",
        `${item.gemValue} 宝石/件，共 ${formatInt(item.totalGems)} 宝石`,
        `市场 ${marketText}${marketTitle ? `；${marketTitle}` : ""}`,
        `分解临界 ${breakEvenText}`,
        item.recommendationReason ? `建议：${item.recommendationLabel || "—"}，${item.recommendationReason}` : "",
        assetSummary.title ? `资产ID:
${assetSummary.title}` : ""
      ].filter(Boolean).join("\n");
      if (item.nameColor) tile.style.borderColor = item.nameColor;
      if (item.backgroundColor) tile.style.backgroundColor = item.backgroundColor;
      if (item.imageUrl) {
        const image = document.createElement("img");
        image.src = item.imageUrl;
        image.alt = item.itemName || item.marketHashName || "";
        tile.appendChild(image);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "stch-inv-placeholder";
        placeholder.textContent = item.itemName || "?";
        tile.appendChild(placeholder);
      }
      const price = document.createElement("span");
      price.className = "stch-inv-badge";
      price.textContent = item.priceCents ? `¥${formatCNY(item.priceCents)}` : `x${item.quantity}`;
      price.title = marketTitle || "数量";
      tile.appendChild(price);
      const action = document.createElement("span");
      action.className = `stch-inv-badge stch-inv-badge-left ${item.recommendationClass || ""}`.trim();
      action.textContent = item.recommendationLabel || "—";
      action.title = item.recommendationReason || "";
      tile.appendChild(action);
      const gems = document.createElement("span");
      gems.className = "stch-inv-gems";
      gems.textContent = `${formatInt(item.totalGems)} 宝石`;
      gems.title = `${item.gemValue} 宝石/件`;
      tile.appendChild(gems);
      const name = document.createElement("div");
      name.className = "stch-inv-name";
      name.textContent = item.itemName || item.marketHashName || "未知物品";
      tile.appendChild(name);
      tile.addEventListener("click", () => {
        if (!state.selectedGrindResults) state.selectedGrindResults = /* @__PURE__ */ new Set();
        if (state.selectedGrindResults.has(key)) {
          state.selectedGrindResults.delete(key);
          tile.classList.remove("selected");
        } else {
          state.selectedGrindResults.add(key);
          tile.classList.add("selected");
        }
        updateGrindSummary();
        updateGrindActionState();
      });
      list.appendChild(tile);
    }
    updateGrindSummary();
    updateGrindActionState();
  }
  async function startGrindScan() {
    if (state.grindScanning || state.scanning || state.bulkActionRunning || state.orderActionRunning || state.craftScanning || state.craftActionRunning || state.seasonalActionRunning || state.surplusActionRunning || state.surplusScanning) {
      return;
    }
    if (location.hostname !== "steamcommunity.com") {
      grindLog("请在 Steam 社区徽章页或库存页使用多余物品处理", "warn");
      return;
    }
    const steamId = getSteamId();
    if (!steamId) {
      grindLog("未找到 SteamID，无法读取库存", "err");
      return;
    }
    state.grindScanning = true;
    state.grindStopRequested = false;
    state.grindResults = [];
    state.selectedGrindResults = /* @__PURE__ */ new Set();
    state.grindGemPrice = null;
    const logBox = document.getElementById("stch-grind-log");
    if (logBox) logBox.innerHTML = "";
    renderGrindResults();
    updateAllActionStates();
    const cfg = state.cfg;
    const queue = new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      setGrindStatus,
      grindLog
    );
    state.grindQueue = queue;
    try {
      grindLog("【阶段 1/3】读取宝石袋市场价格");
      setGrindProgress(0, 1, "阶段1: 读取宝石价格");
      const gemPrice = await loadSidebarGemPrice(queue);
      if (!gemPrice.priceCents) {
        throw new Error("宝石袋暂无可用市场价格，无法计算分解临界点");
      }
      state.grindGemPrice = gemPrice;
      const sackNet = getGemSackSellerNetCents(gemPrice.priceCents);
      const breakEven10 = getGemBreakEvenBuyerPrice(10, gemPrice.priceCents);
      grindLog(
        `宝石袋 ${gemPrice.source} ¥${formatCNY(gemPrice.priceCents)}，税后到手约 ¥${formatCNY(sackNet)}；10宝石临界价 ¥${formatCNY(breakEven10)}`,
        "ok"
      );
      const itemModeLabel = state.cfg.surplusItemMode === "emoticon" ? "表情" : "背景";
      grindLog(`本次只分析${itemModeLabel}类社区物品`, "info");
      grindLog("【阶段 2/3】读取社区库存并识别可分解物品");
      setGrindProgress(0, 1, "阶段2: 读取库存");
      const inventory = await loadGrindInventoryItems(steamId, queue);
      if (state.grindStopRequested) {
        grindLog("已停止扫描", "warn");
        return;
      }
      grindLog(
        `库存读取完成：库存 ${inventory.totalInventoryCount || inventory.totalAssetsSeen} 件，候选 ${inventory.items.length} 种；跳过无宝石值 ${inventory.skipped.noGemValue} 件，默认保留 ${inventory.skipped.reserved} 件，点数商店类 ${inventory.skipped.pointsShop} 件，游戏黑名单 ${inventory.skipped.blacklisted} 件`,
        "ok"
      );
      if (inventory.items.length === 0) {
        renderGrindResults();
        grindLog("没有找到可用于分解建议的物品", "warn");
        return;
      }
      grindLog("【阶段 3/3】查询市场价格并计算建议");
      const pricedCandidates = inventory.items.filter((item) => item.marketHashName && item.marketableCount > 0);
      let priced = 0;
      let failed = 0;
      for (let index = 0; index < inventory.items.length; index++) {
        if (state.grindStopRequested) break;
        const item = inventory.items[index];
        setGrindProgress(
          index,
          inventory.items.length,
          `阶段3: ${index + 1}/${inventory.items.length} · ${item.itemName || item.marketHashName}`
        );
        setGrindStatus(`查询价格: ${item.itemName || item.marketHashName}`);
        if (item.marketHashName && item.marketableCount > 0) {
          const price = await priceCard(item.marketHashName, queue);
          if (price && !price.noPriceData) {
            item.priceCents = price.lowestSellCents;
            item.medianCents = price.medianCents;
            item.volume = price.volume;
            item.priceSource = price.priceSource === "lowest" ? "在售最低" : "平均价格";
            priced++;
          } else if (price?.noPriceData) {
            item.volume = 0;
            item.priceSource = "无可用价格";
          } else {
            failed++;
            item.priceSource = "查价失败";
          }
        }
        applyGrindRecommendation(item, gemPrice.priceCents);
        state.grindResults.push(item);
        renderGrindResults();
      }
      state.grindResults.sort((left, right) => {
        const recommendCompare = Number(right.recommendationKey === "grind") - Number(left.recommendationKey === "grind");
        if (recommendCompare) return recommendCompare;
        const gemCompare = right.totalGems - left.totalGems;
        if (gemCompare) return gemCompare;
        const gameCompare = (left.gameName || "").localeCompare(right.gameName || "", "zh-CN");
        if (gameCompare) return gameCompare;
        return (left.itemName || "").localeCompare(right.itemName || "", "zh-CN");
      });
      renderGrindResults();
      if (state.grindStopRequested) {
        grindLog("已停止扫描", "warn");
      } else {
        const recommended = state.grindResults.filter((item) => item.recommendationKey === "grind");
        const recommendedQuantity = recommended.reduce((sum, item) => sum + item.quantity, 0);
        const recommendedGems = recommended.reduce((sum, item) => sum + item.totalGems, 0);
        grindLog(
          `扫描完成：查价 ${priced}/${pricedCandidates.length} 种，失败 ${failed} 种；建议分解 ${recommended.length} 种 / ${recommendedQuantity} 件 / ${formatInt(recommendedGems)} 宝石`,
          failed ? "warn" : "ok"
        );
      }
    } catch (error) {
      if (!state.grindStopRequested) {
        grindLog(`扫描中断: ${error?.message || error?.status || error}`, "err");
      }
    } finally {
      queue.stop();
      state.grindQueue = null;
      state.grindScanning = false;
      state.grindStopRequested = false;
      hideGrindProgress();
      setGrindStatus(null);
      renderGrindResults();
      updateAllActionStates();
    }
  }
  function requestGrindStop() {
    if (!state.grindScanning) return;
    state.grindStopRequested = true;
    state.grindQueue?.stop();
    grindLog("已请求停止扫描", "warn");
    updateGrindActionState();
  }

  // src/features/item-actions.js
  function getProcessingMode() {
    const value = document.getElementById("stch-surplus-item-mode")?.value || state.cfg.surplusItemMode || "card";
    return ["card", "background", "emoticon"].includes(value) ? value : "card";
  }
  function getProcessingUi(mode = getProcessingMode()) {
    return mode === "card" ? {
      log: surplusStatus.log,
      setStatus: surplusStatus.setStatus,
      emptySell: "请先选择要出售的卡牌",
      emptyGem: "请先选择要转化宝石的卡牌"
    } : {
      log: grindStatus.log,
      setStatus: grindStatus.setStatus,
      emptySell: "请先选择要出售的物品",
      emptyGem: "请先选择要转化宝石的物品"
    };
  }
  function getSellPriceControls() {
    const configuredPriceSource = document.getElementById("stch-surplus-sell-price-source")?.value || state.cfg.surplusSellPriceSource || "lowest";
    const priceSource = ["lowest", "median", "highest"].includes(configuredPriceSource) ? configuredPriceSource : "lowest";
    const adjustmentInput = document.getElementById("stch-surplus-sell-adjustment");
    const adjustmentValue = adjustmentInput ? parseFloat(adjustmentInput.value) : state.cfg.surplusSellPriceAdjustment;
    const adjustmentCents = Math.round(
      (Number.isFinite(adjustmentValue) ? adjustmentValue : 0) * 100
    );
    return { priceSource, adjustmentCents };
  }
  function getActionQueue(ui) {
    const cfg = state.cfg;
    return new RequestQueue(
      cfg.requestInterval,
      cfg.batchSize,
      cfg.batchPause,
      state,
      ui.setStatus,
      ui.log
    );
  }
  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  function getAssetQuantity(asset, field = "amount") {
    return Math.max(1, parseInt(asset?.[field], 10) || 1);
  }
  function getSelectedGroups(mode) {
    return mode === "card" ? getSelectedSurplusResults() : getSelectedGrindResults();
  }
  function clearSelection(mode) {
    if (mode === "card") {
      state.selectedSurplusResults = /* @__PURE__ */ new Set();
      renderSurplusResults();
    } else {
      state.selectedGrindResults = /* @__PURE__ */ new Set();
      renderGrindResults();
    }
  }
  function makeSellGroups(mode) {
    const selected = getSelectedGroups(mode);
    if (mode === "card") {
      return selected.map((result) => {
        const assets = (result.assets || []).filter((asset) => asset.assetid && asset.marketable).map((asset) => ({
          assetid: String(asset.assetid || ""),
          contextid: String(asset.contextid || "6"),
          amount: getAssetQuantity(asset, "selectedAmount")
        }));
        return {
          gameName: result.gameName || "",
          itemName: result.cardName || result.marketHashName || "未知卡牌",
          marketHashName: result.marketHashName || "",
          quantity: assets.reduce((sum, asset) => sum + asset.amount, 0),
          assets
        };
      });
    }
    return selected.map((item) => {
      const assets = (item.assets || []).filter((asset) => asset.assetid && asset.marketable).map((asset) => ({
        assetid: String(asset.assetid || ""),
        contextid: String(asset.contextid || "6"),
        amount: getAssetQuantity(asset, "amount")
      }));
      return {
        gameName: item.gameName || "",
        itemName: item.itemName || item.marketHashName || "未知物品",
        marketHashName: item.marketHashName || "",
        quantity: assets.reduce((sum, asset) => sum + asset.amount, 0),
        assets
      };
    });
  }
  function makeGemAssets(mode) {
    const selected = getSelectedGroups(mode);
    if (mode === "card") {
      return selected.flatMap(
        (result) => (result.assets || []).map((asset) => ({
          gameName: result.gameName || "",
          itemName: result.cardName || result.marketHashName || "未知卡牌",
          assetid: String(asset.assetid || ""),
          contextid: String(asset.contextid || "6"),
          selectedAmount: getAssetQuantity(asset, "selectedAmount"),
          assetAmount: getAssetQuantity(asset, "amount"),
          estimatedGems: (asset.gemValue || result.gemValue || 0) * getAssetQuantity(asset, "selectedAmount")
        }))
      );
    }
    return selected.flatMap(
      (item) => (item.assets || []).map((asset) => ({
        gameName: item.gameName || "",
        itemName: item.itemName || item.marketHashName || "未知物品",
        assetid: String(asset.assetid || ""),
        contextid: String(asset.contextid || "6"),
        selectedAmount: getAssetQuantity(asset, "amount"),
        assetAmount: getAssetQuantity(asset, "originalAmount"),
        estimatedGems: (item.gemValue || 0) * getAssetQuantity(asset, "amount")
      }))
    );
  }
  async function getSellBasePrice(group, priceSource, queue, ui, index, total, cache) {
    if (cache.has(group.marketHashName)) return cache.get(group.marketHashName);
    let basePriceCents = null;
    if (priceSource === "highest") {
      ui.setStatus(`读取求购最高 ${index + 1}/${total}: ${group.itemName}`);
      basePriceCents = await fetchHighestBuyPrice(group.marketHashName);
    } else {
      ui.setStatus(`读取出售参考价 ${index + 1}/${total}: ${group.itemName}`);
      const price = await priceCard(group.marketHashName, queue);
      if (priceSource === "lowest") {
        basePriceCents = price?.priceSource === "lowest" ? price.lowestSellCents : null;
      } else {
        basePriceCents = Number.isFinite(price?.medianCents) && price.medianCents > 0 ? price.medianCents : null;
      }
    }
    const value = Number.isFinite(basePriceCents) && basePriceCents > 0 ? basePriceCents : null;
    cache.set(group.marketHashName, value);
    return value;
  }
  async function buildSellPlan(mode, ui, queue) {
    const { priceSource, adjustmentCents } = getSellPriceControls();
    const minimumBuyerCents = getMarketMinimumPriceCents();
    const priceCache = /* @__PURE__ */ new Map();
    const plan = [];
    const skipped = {
      missingHash: 0,
      unmarketable: 0,
      missingPrice: 0,
      clamped: 0,
      failedPrice: 0
    };
    const candidates = makeSellGroups(mode).filter((group) => {
      if (!group.marketHashName) {
        skipped.missingHash++;
        return false;
      }
      if (!group.assets.length || group.quantity <= 0) {
        skipped.unmarketable++;
        return false;
      }
      return true;
    });
    for (let index = 0; index < candidates.length; index++) {
      const group = candidates[index];
      let basePriceCents = null;
      try {
        basePriceCents = await getSellBasePrice(
          group,
          priceSource,
          queue,
          ui,
          index,
          candidates.length,
          priceCache
        );
      } catch (error) {
        skipped.failedPrice++;
        ui.log(`  ${group.itemName}: ${error?.message || error}，已跳过`, "warn");
      }
      if (!basePriceCents) {
        skipped.missingPrice++;
        continue;
      }
      const targetBuyerCents = basePriceCents + adjustmentCents;
      const clampedBuyerCents = Math.max(minimumBuyerCents, targetBuyerCents);
      if (clampedBuyerCents !== targetBuyerCents) skipped.clamped++;
      const sellerReceiveCents = getSellerReceiveForBuyerPrice(clampedBuyerCents);
      if (sellerReceiveCents <= 0) {
        skipped.missingPrice++;
        continue;
      }
      const unitBuyerCents = getBuyerPriceForSellerReceive(sellerReceiveCents);
      plan.push({
        ...group,
        priceSource,
        basePriceCents,
        targetBuyerCents,
        unitBuyerCents,
        sellerReceiveCents,
        totalBuyerCents: unitBuyerCents * group.quantity,
        totalReceiveCents: sellerReceiveCents * group.quantity
      });
    }
    return { plan, skipped, priceSource, adjustmentCents, minimumBuyerCents };
  }
  function getProfileActionBaseUrl() {
    const profileUrl = getProfileUrl();
    if (profileUrl) return profileUrl.replace(/\/$/, "");
    const steamId = getSteamId();
    return steamId ? `https://steamcommunity.com/profiles/${steamId}` : "";
  }
  async function fetchAssetGooValue(asset, queue, ui, index, total) {
    const baseUrl = getProfileActionBaseUrl();
    const sessionId = getSessionId();
    if (!baseUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    ui.setStatus(`读取宝石值 ${index + 1}/${total}: ${asset.itemName}`);
    const params = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      assetid: asset.assetid,
      contextid: asset.contextid || "6"
    });
    const response = await queue.fetch(`${baseUrl}/ajaxgetgoovalue/?${params.toString()}`);
    const data = response?.data || {};
    const gooValue = Math.max(0, parseInt(data.goo_value, 10) || 0);
    if (gooValue <= 0) {
      throw new Error(data?.message || "Steam 未返回可分解宝石值");
    }
    return gooValue;
  }
  async function buildGemPlan(mode, ui, queue) {
    const candidates = makeGemAssets(mode);
    const plan = [];
    const skipped = {
      missingAsset: 0,
      partialStack: 0,
      noGooValue: 0
    };
    for (let index = 0; index < candidates.length; index++) {
      const asset = candidates[index];
      if (!asset.assetid) {
        skipped.missingAsset++;
        continue;
      }
      if (asset.selectedAmount < asset.assetAmount) {
        skipped.partialStack++;
        continue;
      }
      try {
        const gooValueExpected = await fetchAssetGooValue(asset, queue, ui, index, candidates.length);
        plan.push({ ...asset, gooValueExpected });
      } catch (error) {
        skipped.noGooValue++;
        ui.log(`  ${asset.itemName}: ${error?.message || error}，已跳过`, "warn");
      }
    }
    return { plan, skipped };
  }
  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return { data: JSON.parse(text), text };
    } catch (_) {
      return { data: null, text };
    }
  }
  function getSteamResponseError(data, response, fallback) {
    return data?.message || data?.strError || data?.error || data?.strHTML || `${fallback} (${response.status})`;
  }
  async function sellAsset(asset, sellerReceiveCents) {
    const sessionId = getSessionId();
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    const body = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      contextid: asset.contextid || "6",
      assetid: asset.assetid,
      amount: String(asset.amount || 1),
      price: String(sellerReceiveCents)
    });
    const response = await window.fetch("https://steamcommunity.com/market/sellitem/", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString()
    });
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(getSteamResponseError(data, response, "出售失败"));
    }
    if (data?.success === true || data?.success === 1) return data;
    throw new Error(getSteamResponseError(data, response, "出售失败"));
  }
  async function grindAsset(asset) {
    const baseUrl = getProfileActionBaseUrl();
    const sessionId = getSessionId();
    if (!baseUrl) throw new Error("未找到 Steam 个人资料地址");
    if (!sessionId) throw new Error("未找到 Steam sessionid");
    const body = new URLSearchParams({
      sessionid: sessionId,
      appid: "753",
      assetid: asset.assetid,
      contextid: asset.contextid || "6",
      goo_value_expected: String(asset.gooValueExpected)
    });
    const response = await window.fetch(`${baseUrl}/ajaxgrindintogoo/`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
      body: body.toString()
    });
    const { data } = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(getSteamResponseError(data, response, "转化宝石失败"));
    }
    if (data?.success === true || Number(data?.success) === 1) return data;
    throw new Error(getSteamResponseError(data, response, "转化宝石失败"));
  }
  function showProcessingConfirmation(options) {
    return new Promise((resolve) => {
      const backdrop = document.createElement("div");
      backdrop.id = "stch-order-dialog-backdrop";
      backdrop.innerHTML = `
        <div class="stch-order-dialog">
          <h3>${options.title}</h3>
          <div class="stch-order-summary"></div>
          <div class="stch-order-list"></div>
          <div class="stch-order-note"></div>
          <div class="stch-order-dialog-actions">
            <div class="stch-btn alt" data-action="cancel">取消</div>
            <div class="stch-btn ${options.danger ? "stch-btn-danger" : ""}" data-action="confirm">${options.confirmLabel}</div>
          </div>
        </div>
      `;
      backdrop.querySelector(".stch-order-summary").innerHTML = options.summaryHtml;
      const list = backdrop.querySelector(".stch-order-list");
      options.rows.forEach((rowInfo) => {
        const row = document.createElement("div");
        row.className = `stch-order-item stch-processing-dialog-item ${options.rowClass || ""}`.trim();
        rowInfo.forEach((text) => row.appendChild(createTextSpan("", text)));
        list.appendChild(row);
      });
      backdrop.querySelector(".stch-order-note").textContent = options.note;
      const finish = (confirmed) => {
        backdrop.remove();
        resolve(confirmed);
      };
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop) finish(false);
      });
      document.body.appendChild(backdrop);
    });
  }
  function showSellConfirmation(planData) {
    const { plan, skipped, priceSource, adjustmentCents, minimumBuyerCents } = planData;
    const totalQuantity = plan.reduce((sum, item) => sum + item.quantity, 0);
    const totalBuyerCents = plan.reduce((sum, item) => sum + item.totalBuyerCents, 0);
    const totalReceiveCents = plan.reduce((sum, item) => sum + item.totalReceiveCents, 0);
    const adjustmentText = `${adjustmentCents >= 0 ? "+" : "-"}¥${formatCNY(Math.abs(adjustmentCents))}`;
    const notes = [];
    if (skipped.missingHash) notes.push(`${skipped.missingHash} 项缺少市场标识`);
    if (skipped.unmarketable) notes.push(`${skipped.unmarketable} 项不可出售`);
    if (skipped.missingPrice) notes.push(`${skipped.missingPrice} 项缺少所选价格`);
    if (skipped.failedPrice) notes.push(`${skipped.failedPrice} 项查价失败`);
    if (skipped.clamped) notes.push(`${skipped.clamped} 项低于 Steam 最低售价，已调整到 ¥${formatCNY(minimumBuyerCents)}`);
    return showProcessingConfirmation({
      title: "确认上架出售",
      rowClass: "sell",
      confirmLabel: "上架出售",
      summaryHtml: `项目 <b>${plan.length}</b> 项 · 数量 <b>${totalQuantity}</b> 件 · 买家价格合计 <b>¥${formatCNY(totalBuyerCents)}</b> · 税后到手约 <b>¥${formatCNY(totalReceiveCents)}</b><br>价格基准 <b>${getOrderPriceSourceLabel(priceSource)}</b> · 售价调整 <b>${adjustmentText}</b>`,
      rows: plan.map((item) => [
        `${item.gameName ? `${item.gameName} · ` : ""}${item.itemName}`,
        `${item.quantity} 件`,
        `买家 ¥${formatCNY(item.unitBuyerCents)}`,
        `到手 ¥${formatCNY(item.sellerReceiveCents)}`
      ]),
      note: `${notes.join("；") || "未发现需跳过的项目"}。将直接提交 Steam 市场上架请求；可能仍需要在 Steam 手机应用中确认。`
    });
  }
  function showGemConfirmation(planData) {
    const { plan, skipped } = planData;
    const totalGems = plan.reduce((sum, item) => sum + item.gooValueExpected, 0);
    const notes = [];
    if (skipped.missingAsset) notes.push(`${skipped.missingAsset} 项缺少资产 ID`);
    if (skipped.partialStack) notes.push(`${skipped.partialStack} 项是部分堆叠资产，Steam 原生接口不支持只销毁一部分，已跳过`);
    if (skipped.noGooValue) notes.push(`${skipped.noGooValue} 项未读取到可分解宝石值`);
    return showProcessingConfirmation({
      title: "确认转化宝石",
      rowClass: "gem",
      confirmLabel: "转化宝石",
      danger: true,
      summaryHtml: `资产 <b>${plan.length}</b> 个 · 预计获得 <b>${formatInt(totalGems)}</b> 宝石`,
      rows: plan.map((item) => [
        `${item.gameName ? `${item.gameName} · ` : ""}${item.itemName}`,
        item.assetid,
        `${formatInt(item.gooValueExpected)} 宝石`
      ]),
      note: `${notes.join("；") || "未发现需跳过的项目"}。转化宝石会不可逆销毁物品，请确认选中项目和数量。`
    });
  }
  async function submitSelectedProcessingSell() {
    const mode = getProcessingMode();
    const ui = getProcessingUi(mode);
    if (isSharedActionBusy()) return;
    if (getSelectedGroups(mode).length === 0) {
      ui.log(ui.emptySell, "warn");
      return;
    }
    state.surplusActionRunning = true;
    updateAllActionStates();
    const queue = getActionQueue(ui);
    let finalStatus = null;
    let submitted = 0;
    let failed = 0;
    try {
      ui.log("开始生成出售计划", "info");
      const planData = await buildSellPlan(mode, ui, queue);
      if (planData.plan.length === 0) {
        finalStatus = "没有可上架出售的选中项目";
        ui.log(finalStatus, "warn");
        return;
      }
      const confirmed = await showSellConfirmation(planData);
      if (!confirmed) {
        finalStatus = "已取消上架出售";
        return;
      }
      const assets = planData.plan.flatMap(
        (item) => item.assets.map((asset) => ({ ...asset, item }))
      );
      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index];
        ui.setStatus(`上架出售 ${index + 1}/${assets.length}: ${asset.item.itemName}`);
        try {
          const result = await sellAsset(asset, asset.item.sellerReceiveCents);
          submitted++;
          const confirmationText = result?.requires_confirmation || result?.needs_mobile_confirmation ? "，等待手机确认" : "";
          ui.log(
            `  ✓ ${asset.item.itemName} x${asset.amount}: 买家 ¥${formatCNY(asset.item.unitBuyerCents)} / 到手 ¥${formatCNY(asset.item.sellerReceiveCents)}${confirmationText}`,
            "ok"
          );
        } catch (error) {
          failed++;
          ui.log(`  ✗ ${asset.item.itemName} x${asset.amount}: ${error?.message || error}`, "err");
        }
        await wait(500);
      }
      finalStatus = `上架出售结束: 成功 ${submitted}, 失败 ${failed}`;
      ui.log(`${finalStatus}；建议重新扫描刷新库存结果`, failed ? "warn" : "ok");
      if (submitted > 0) clearSelection(mode);
    } catch (error) {
      finalStatus = `无法上架出售: ${error?.message || error}`;
      ui.log(finalStatus, "err");
    } finally {
      queue.stop();
      state.surplusActionRunning = false;
      ui.setStatus(finalStatus && failed ? finalStatus : null, false);
      updateAllActionStates();
    }
  }
  async function submitSelectedProcessingGems() {
    const mode = getProcessingMode();
    const ui = getProcessingUi(mode);
    if (isSharedActionBusy()) return;
    if (getSelectedGroups(mode).length === 0) {
      ui.log(ui.emptyGem, "warn");
      return;
    }
    state.surplusActionRunning = true;
    updateAllActionStates();
    const queue = getActionQueue(ui);
    let finalStatus = null;
    let submitted = 0;
    let failed = 0;
    try {
      ui.log("开始读取选中资产的可分解宝石值", "info");
      const planData = await buildGemPlan(mode, ui, queue);
      if (planData.plan.length === 0) {
        finalStatus = "没有可转化宝石的选中项目";
        ui.log(finalStatus, "warn");
        return;
      }
      const confirmed = await showGemConfirmation(planData);
      if (!confirmed) {
        finalStatus = "已取消转化宝石";
        return;
      }
      for (let index = 0; index < planData.plan.length; index++) {
        const asset = planData.plan[index];
        ui.setStatus(`转化宝石 ${index + 1}/${planData.plan.length}: ${asset.itemName}`);
        try {
          await grindAsset(asset);
          submitted++;
          ui.log(
            `  ✓ ${asset.itemName}: ${formatInt(asset.gooValueExpected)} 宝石`,
            "ok"
          );
        } catch (error) {
          failed++;
          ui.log(`  ✗ ${asset.itemName}: ${error?.message || error}`, "err");
        }
        await wait(500);
      }
      finalStatus = `转化宝石结束: 成功 ${submitted}, 失败 ${failed}`;
      ui.log(`${finalStatus}；建议重新扫描刷新库存结果`, failed ? "warn" : "ok");
      if (submitted > 0) clearSelection(mode);
    } catch (error) {
      finalStatus = `无法转化宝石: ${error?.message || error}`;
      ui.log(finalStatus, "err");
    } finally {
      queue.stop();
      state.surplusActionRunning = false;
      ui.setStatus(finalStatus && failed ? finalStatus : null, false);
      updateAllActionStates();
    }
  }

  // src/ui/modal.js
  var modalEl = null;
  function getOuterHeight(element) {
    if (!element || getComputedStyle(element).display === "none") return 0;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
  }
  function initLogResizers(root) {
    root.querySelectorAll(".stch-log-resizer").forEach((resizer) => {
      const logPane = document.getElementById(resizer.dataset.log);
      if (!logPane || resizer.dataset.ready === "1") return;
      resizer.dataset.ready = "1";
      const contentPane = resizer.dataset.content ? document.getElementById(resizer.dataset.content) : null;
      resizer.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const tab = resizer.closest(".stch-tab-content") || root;
        const tabHeight = tab.getBoundingClientRect().height || window.innerHeight;
        const startY = event.clientY;
        const startLogHeight = logPane.getBoundingClientRect().height || 160;
        const minLogHeight = 82;
        const minContentHeight = contentPane ? 82 : 42;
        const reservedHeight = [...tab.children].reduce((sum, child) => {
          if (child === logPane || child === resizer || child === contentPane) return sum;
          return sum + getOuterHeight(child);
        }, 0);
        const maxLogHeight = Math.max(
          minLogHeight,
          tabHeight - reservedHeight - getOuterHeight(resizer) - minContentHeight - 12
        );
        if (contentPane) {
          contentPane.style.flex = "1 1 0";
          contentPane.style.maxHeight = "none";
          contentPane.style.minHeight = `${minContentHeight}px`;
        }
        logPane.style.minHeight = `${minLogHeight}px`;
        const onMove = (moveEvent) => {
          const delta = moveEvent.clientY - startY;
          const nextHeight = Math.max(
            minLogHeight,
            Math.min(maxLogHeight, startLogHeight - delta)
          );
          logPane.style.flex = `0 0 ${nextHeight}px`;
          logPane.style.height = `${nextHeight}px`;
        };
        const onUp = () => {
          resizer.classList.remove("dragging");
          document.body.classList.remove("stch-log-resizing");
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onUp);
        };
        resizer.classList.add("dragging");
        document.body.classList.add("stch-log-resizing");
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        document.addEventListener("pointercancel", onUp);
      });
    });
  }
  function openModal() {
    if (modalEl) {
      modalEl.style.display = "";
      const backdrop = document.getElementById("stch-backdrop");
      if (backdrop) backdrop.style.display = "block";
      return;
    }
    buildModal();
  }
  function buildModal(options = {}) {
    const seasonalOnly = isPointsShopPage();
    const initialTab = seasonalOnly ? "seasonal" : options.initialTab || "scan";
    const activeClass = (tabName) => initialTab === tabName ? "active" : "";
    const backdrop = document.createElement("div");
    backdrop.id = "stch-backdrop";
    backdrop.style.display = "block";
    backdrop.addEventListener("click", closeModal);
    document.body.appendChild(backdrop);
    const modal = document.createElement("div");
    modal.id = "stch-modal";
    modal.addEventListener("click", (e) => e.stopPropagation());
    modal.innerHTML = `
      <div class="stch-header">
        <h2>Steam 卡牌助手</h2>
        <span class="stch-close" title="关闭">✕</span>
      </div>
      <div class="stch-body">
        <div class="stch-tabs">
          ${seasonalOnly ? `
          <span class="stch-tab ${activeClass("seasonal")}" data-tab="seasonal">季节徽章</span>
          ` : `
          <span class="stch-tab ${activeClass("scan")}" data-tab="scan">卡牌价格扫描</span>
          <span class="stch-tab" data-tab="orders">订购卡牌</span>
          <span class="stch-tab" data-tab="craft">徽章合成</span>
          <span class="stch-tab" data-tab="blacklist">游戏/AppID黑名单</span>
          <span class="stch-tab" data-tab="surplus">多余物品处理</span>
          <span class="stch-tab stch-tab-right ${activeClass("settings")}" data-tab="settings">设置</span>
          `}
        </div>
        <div class="stch-tab-content ${activeClass("scan")}" id="stch-tab-scan">
          <div class="stch-onboarding" id="stch-onboarding" style="display:none">
            <h3>欢迎使用 Steam 卡牌助手</h3>
            <p class="stch-onboarding-intro">扫描未完成的徽章，比较卡牌成本，更快地完成购买和徽章合成。</p>
            <div class="stch-onboarding-step">
              <b>1. 设置并扫描</b>
              设置单套价格上限和购买逻辑后开始扫描。价格预测会在明显超出上限时提前跳过，减少请求和等待。
            </div>
            <div class="stch-onboarding-step">
              <b>2. 选择购买方式</b>
              “手动购买”会打开 Steam multibuy 并自动填写数量和价格；勾选结果后也可以批量提交长期订购单。
            </div>
            <div class="stch-onboarding-step">
              <b>3. 理解购买价格</b>
              在售最低通常更快成交，平均价格用于参考，求购最高通常需要等待卖家成交。买价调整可正可负。
            </div>
            <div class="stch-onboarding-step">
              <b>4. 批量合成徽章</b>
              在“徽章合成”页扫描已经收集齐全的卡组，可逐级升级或一次提交当前可合成最大次数。
            </div>
            <div class="stch-onboarding-note">
              市场价格和满级成本均可能变化。提交购买、订购单或合成前，请检查数量和目标等级。
            </div>
            <div class="stch-onboarding-actions">
              <div class="stch-btn" id="stch-onboarding-close">关闭</div>
            </div>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">单套卡牌价格上限 ¥ <input id="stch-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.threshold}"></label>
            <label class="stch-primary-label" id="stch-buy-mode-label">购买卡牌逻辑 <select id="stch-buy-mode" class="stch-input" style="width:110px">
              <option value="complete1" ${state.cfg.buyMode === "complete1" ? "selected" : ""}>补全单套</option>
              <option value="complete5" ${state.cfg.buyMode === "complete5" ? "selected" : ""}>补至五级</option>
              <option value="buy1" ${state.cfg.buyMode === "buy1" ? "selected" : ""}>购买单套</option>
              <option value="buy5" ${state.cfg.buyMode === "buy5" ? "selected" : ""}>购买五套</option>
            </select></label>
            <label>最大徽章页数 <input id="stch-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <label>
              <input id="stch-include-drops" type="checkbox" ${state.cfg.includeDrops ? "checked" : ""}>
              包含有掉落卡牌的游戏
            </label>
            <label class="stch-foil-mode-label ${state.cfg.foilScanMode ? "active" : ""}" id="stch-foil-mode-label">
              <input id="stch-foil-scan-mode" type="checkbox" ${state.cfg.foilScanMode ? "checked" : ""}>
              闪卡模式
            </label>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">购买价格
              <span class="stch-help" title="在售最低：当前最低卖单价格，通常可立即成交&#10;平均价格：Steam 返回的 median_price，用作市场参考价&#10;求购最高：当前最高买单价格，通常需要等待卖家成交&#10;仅用于自动提交长期订购单；手动购买仍使用在售最低">?</span>
              <select id="stch-order-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.orderPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.orderPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.orderPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">买价调整 ¥ <input id="stch-price-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.priceAdjustment}" style="width:68px"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-scan-btn">开始扫描</div>
            <div class="stch-btn alt disabled" id="stch-stop-btn">停止</div>
            <div class="stch-btn alt disabled" id="stch-skip-btn" title="跳过当前徽章">跳过当前</div>
            <div class="stch-bulk-actions">
              <div class="stch-btn alt disabled" id="stch-recalculate-btn">重新计算</div>
              <div class="stch-btn disabled" id="stch-submit-orders-btn">提交订购单</div>
            </div>
          </div>
          <div class="stch-progress" id="stch-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-progress-text">0/0</div>
          </div>
          <div class="stch-summary" id="stch-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-summary"></span>
            <span class="stch-selected-count" id="stch-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-status"></div>
          <div class="stch-game-list" id="stch-list"></div>
          <div class="stch-log-resizer" data-log="stch-log" data-content="stch-list" title="上下拖动调整日志区域"></div>
          <div id="stch-log"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-orders">
          <div class="stch-toolbar">
            <label class="stch-primary-label">手动 AppID <input id="stch-order-appid" class="stch-input" type="text" style="width:100px" placeholder="4761370"></label>
            <label class="stch-foil-mode-label" id="stch-order-manual-foil-label">
              <input id="stch-order-manual-foil" type="checkbox">
              闪卡
            </label>
            <div class="stch-btn alt" id="stch-order-add-btn">读取并加入</div>
            <div class="stch-btn alt disabled" id="stch-order-recalculate-btn">重新计算</div>
            <div class="stch-btn disabled" id="stch-order-submit-orders-btn">提交订购单</div>
            <div class="stch-btn alt stch-btn-danger disabled stch-order-tools" id="stch-order-delete-btn">删除过期</div>
          </div>
          <div class="stch-toolbar">
            <label class="stch-primary-label">购买价格
              <span class="stch-help" title="在售最低：当前最低卖单价格，通常可立即成交&#10;平均价格：Steam 返回的 median_price，用作市场参考价&#10;求购最高：当前最高买单价格，通常需要等待卖家成交">?</span>
              <select id="stch-order-page-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.orderPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.orderPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.orderPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">买价调整 ¥ <input id="stch-order-page-price-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.priceAdjustment}" style="width:68px"></label>
            <span class="stch-settings-hint">与卡牌价格扫描页同步；补全总价会实时计入每张卡牌的调整值</span>
          </div>
          <div class="stch-summary" id="stch-order-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-order-summary"></span>
            <span class="stch-selected-count" id="stch-order-selected-count">已选择 0 项</span>
          </div>
          <div class="stch-status-text" id="stch-order-status" style="display:none"></div>
          <div class="stch-game-list stch-order-page-list" id="stch-order-list"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-craft">
          <div class="stch-toolbar">
            <label class="stch-primary-label">合成模式
              <select id="stch-craft-mode" class="stch-input" style="width:100px">
                <option value="step" ${state.cfg.craftMode === "step" ? "selected" : ""}>逐级升级</option>
                <option value="max" ${state.cfg.craftMode === "max" ? "selected" : ""}>一次升满</option>
              </select>
            </label>
            <label>最大徽章页数 <input id="stch-craft-max-pages" class="stch-input" type="number" min="1" max="20" value="${state.cfg.maxBadgePages}"></label>
            <span style="color:#8f98a0;font-size:12px;">扫描“进行中”页面里已经收集齐全、可立即合成的徽章</span>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-craft-scan-btn">扫描可合成徽章</div>
            <div class="stch-btn alt disabled" id="stch-craft-stop-btn">停止</div>
            <div class="stch-craft-actions">
              <div class="stch-btn alt disabled" id="stch-craft-one-btn">全部 1 次</div>
              <div class="stch-btn alt disabled" id="stch-craft-max-btn">全部最大</div>
              <div class="stch-btn alt disabled" id="stch-craft-clear-btn">全部清零</div>
              <div class="stch-btn disabled" id="stch-craft-submit-btn">确认合成</div>
            </div>
          </div>
          <div class="stch-progress" id="stch-craft-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-craft-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-craft-progress-text">0/0</div>
          </div>
          <div class="stch-summary" id="stch-craft-summary-row" style="display:none">
            <span class="stch-summary-text" id="stch-craft-summary"></span>
          </div>
          <div class="stch-status-text" id="stch-craft-status"></div>
          <div class="stch-game-list stch-craft-list" id="stch-craft-list"></div>
          <div class="stch-log-resizer" data-log="stch-craft-log" data-content="stch-craft-list" title="上下拖动调整日志区域"></div>
          <div id="stch-craft-log"></div>
        </div>
        <div class="stch-tab-content ${activeClass("seasonal")}" id="stch-tab-seasonal">
          <div class="stch-toolbar">
            <label class="stch-primary-label">目标等级 <input id="stch-seasonal-target" class="stch-input" type="number" min="1" max="${SEASONAL_BADGE_MAX_LEVEL}" step="1" value="${state.cfg.seasonalTargetLevel}" style="width:56px"></label>
          </div>
          <div class="stch-scan-actions">
            <div class="stch-btn" id="stch-seasonal-buy-btn">开始购买</div>
            <div class="stch-btn alt disabled" id="stch-seasonal-stop-btn">停止</div>
          </div>
          <div class="stch-progress" id="stch-seasonal-progress-wrap" style="display:none">
            <div class="stch-progress-bar" id="stch-seasonal-progress-bar" style="width:0"></div>
            <div class="stch-progress-text" id="stch-seasonal-progress-text">0/0</div>
          </div>
          <div class="stch-seasonal-panel" id="stch-seasonal-summary">
            2026 夏季徽章
          </div>
          <div class="stch-status-text" id="stch-seasonal-status"></div>
          <div class="stch-log-resizer" data-log="stch-seasonal-log" title="上下拖动调整日志区域"></div>
          <div id="stch-seasonal-log"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-blacklist">
          <div class="stch-bl-form">
            <label>输入游戏 AppID <input id="stch-bl-appid" class="stch-input" type="text" style="width:100px" placeholder="例如: 1144400"></label>
            <div class="stch-btn alt" id="stch-bl-lookup">查询游戏</div>
            <div class="stch-btn" id="stch-bl-add" style="display:none;">加入游戏黑名单</div>
            <div class="stch-btn" id="stch-bl-add-fixed" style="display:none;">加入固定游戏黑名单</div>
            <div class="stch-btn alt stch-btn-danger disabled" id="stch-bl-del-sel" style="display:none;">删除选中项</div>
            <div class="stch-btn alt disabled" id="stch-bl-fix-sel" style="display:none;">加入固定游戏黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-unfix-sel" style="display:none;">移除固定游戏黑名单</div>
            <div class="stch-btn alt disabled" id="stch-bl-cleanup">一键清理过期</div>
            <span class="stch-bl-result" id="stch-bl-result"></span>
          </div>
          <div class="stch-bl-form">
            <label>
              <input id="stch-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动游戏黑名单
            </label>
            <label class="stch-primary-label">价格上限 ¥ <input id="stch-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <span style="color:#8f98a0;font-size:12px;">扫描时超过此价格的游戏会自动加入游戏/AppID黑名单</span>
          </div>
          <div class="stch-bl-list" id="stch-bl-list"></div>
          <div class="stch-bl-list" id="stch-bl-list-fixed" style="max-height:100px;margin-top:8px;"></div>
          <div class="stch-bl-count" id="stch-bl-count"></div>
        </div>
        <div class="stch-tab-content" id="stch-tab-surplus">
          <div class="stch-toolbar stch-surplus-main-toolbar">
            <label class="stch-primary-label">处理类型
              <select id="stch-surplus-item-mode" class="stch-input" style="width:92px">
                <option value="card" ${state.cfg.surplusItemMode === "card" ? "selected" : ""}>卡牌</option>
                <option value="background" ${state.cfg.surplusItemMode === "background" ? "selected" : ""}>背景</option>
                <option value="emoticon" ${state.cfg.surplusItemMode === "emoticon" ? "selected" : ""}>表情</option>
              </select>
            </label>
            <label class="stch-card-only-control">
              <input id="stch-surplus-only-maxed" type="checkbox" ${state.cfg.surplusOnlyMaxed ? "checked" : ""}>
              只显示当前已满级徽章
            </label>
            <label>
              <input id="stch-surplus-only-tradable" type="checkbox" ${state.cfg.surplusOnlyTradable ? "checked" : ""}>
              只显示可交易
            </label>
            <label class="stch-card-only-control" title="按宝石袋税后价值与卡牌出售税后到手价比较；分解更值时以绿色覆盖">
              <input id="stch-surplus-compare-gems" type="checkbox" ${state.cfg.surplusCompareGems ? "checked" : ""}>
              宝石比较
            </label>
            <label class="stch-grind-only-control">
              <input id="stch-grind-only-recommended" type="checkbox" ${state.cfg.grindOnlyRecommended ? "checked" : ""}>
              只显示建议分解
            </label>
            <label class="stch-primary-label">出售价格
              <span class="stch-help" title="在售最低：当前最低卖单价格&#10;平均价格：Steam 返回的 median_price&#10;求购最高：当前最高买单价格&#10;提交出售时会换算为 Steam 接口需要的卖家到手价">?</span>
              <select id="stch-surplus-sell-price-source" class="stch-input" style="width:118px">
                <option value="lowest" ${state.cfg.surplusSellPriceSource === "lowest" ? "selected" : ""}>在售最低</option>
                <option value="median" ${state.cfg.surplusSellPriceSource === "median" ? "selected" : ""}>平均价格</option>
                <option value="highest" ${state.cfg.surplusSellPriceSource === "highest" ? "selected" : ""}>求购最高</option>
              </select>
            </label>
            <label class="stch-primary-label">售价调整 ¥ <input id="stch-surplus-sell-adjustment" class="stch-input" type="number" step="0.01" value="${state.cfg.surplusSellPriceAdjustment}" style="width:68px"></label>
          </div>
          <div class="stch-scan-actions stch-surplus-action-row">
            <div class="stch-btn stch-card-scan-action" id="stch-surplus-scan-btn">开始检测</div>
            <div class="stch-btn alt disabled stch-card-scan-action" id="stch-surplus-stop-btn">停止</div>
            <div class="stch-btn stch-grind-scan-action" id="stch-grind-scan-btn">扫描可分解物品</div>
            <div class="stch-btn alt disabled stch-grind-scan-action" id="stch-grind-stop-btn">停止</div>
            <div class="stch-surplus-action-spacer"></div>
            <span class="stch-selected-count stch-processing-selected-count" id="stch-surplus-selected-count">选择 0 项</span>
            <div class="stch-btn alt disabled" id="stch-surplus-select-all-btn">全选</div>
            <div class="stch-surplus-action-buttons">
              <div class="stch-btn alt disabled" id="stch-surplus-sell-btn" title="按所选价格源提交 Steam 市场出售请求">出售</div>
              <div class="stch-btn stch-btn-danger disabled" id="stch-surplus-gem-btn" title="读取 Steam 当前宝石值后提交转化宝石请求">转化宝石</div>
            </div>
          </div>
          <div class="stch-surplus-mode-panel" id="stch-surplus-card-panel">
            <div class="stch-progress" id="stch-surplus-progress-wrap" style="display:none">
              <div class="stch-progress-bar" id="stch-surplus-progress-bar" style="width:0"></div>
              <div class="stch-progress-text" id="stch-surplus-progress-text">0/0</div>
            </div>
            <div class="stch-summary" id="stch-surplus-summary-row" style="display:none">
              <span class="stch-summary-text" id="stch-surplus-summary"></span>
            </div>
            <div class="stch-status-text" id="stch-surplus-status"></div>
            <div class="stch-game-list stch-surplus-list" id="stch-surplus-list"></div>
            <div class="stch-log-resizer" data-log="stch-surplus-log" data-content="stch-surplus-list" title="上下拖动调整日志区域"></div>
            <div id="stch-surplus-log"></div>
          </div>
          <div class="stch-surplus-mode-panel" id="stch-surplus-grind-panel">
            <div class="stch-progress" id="stch-grind-progress-wrap" style="display:none">
              <div class="stch-progress-bar" id="stch-grind-progress-bar" style="width:0"></div>
              <div class="stch-progress-text" id="stch-grind-progress-text">0/0</div>
            </div>
            <div class="stch-summary" id="stch-grind-summary-row" style="display:none">
              <span class="stch-summary-text" id="stch-grind-summary"></span>
            </div>
            <div class="stch-status-text" id="stch-grind-status"></div>
            <div class="stch-game-list stch-grind-list" id="stch-grind-list"></div>
            <div class="stch-log-resizer" data-log="stch-grind-log" data-content="stch-grind-list" title="上下拖动调整日志区域"></div>
            <div id="stch-grind-log"></div>
          </div>
        </div>
        <div class="stch-tab-content ${activeClass("settings")}" id="stch-tab-settings">
          <div style="color:#fff;font-weight:bold;font-size:16px;margin-bottom:4px;">全局设定</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>priceoverview请求间隔 <input id="stch-req-interval" class="stch-input" type="number" min="100" step="10" value="${state.cfg.requestInterval}" style="width:70px"> ms</label>
            <label>每 <input id="stch-batch-size" class="stch-input" type="number" min="5" step="1" value="${state.cfg.batchSize}" style="width:55px"> 次priceoverview请求后暂停</label>
            <label><input id="stch-batch-pause" class="stch-input" type="number" min="500" step="500" value="${state.cfg.batchPause}" style="width:75px"> ms</label>
          </div>
          <div class="stch-toolbar">
            <label title="显示扫描过程中没有产生结果的常规信息">
              <input id="stch-show-no-result-logs" type="checkbox" ${state.cfg.showNoResultLogs ? "checked" : ""}>
              显示无结果日志
            </label>
            <span class="stch-settings-hint">包括“没有升满后剩余”等常规信息，默认隐藏</span>
          </div>
          <div class="stch-settings-hint stch-settings-hint-block">价格 API 默认使用 330ms 间隔，每 20 次请求主动冷却 53s；如遇 429 可适当调高。</div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">卡牌价格扫描</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label><input id="stch-early-price-prediction" type="checkbox" ${state.cfg.earlyPricePrediction ? "checked" : ""}> 价格预测提早跳过</label>
            <span class="stch-settings-hint">扫描部分卡牌后保守预测全套价格，超过扫描上限时提前跳过</span>
          </div>
          <div class="stch-toolbar">
            <label>订购卡牌缓存 <input id="stch-order-cache-days" class="stch-input" type="number" min="0" step="1" value="${state.cfg.orderCacheDays}" style="width:55px"> 天</label>
            <label><input id="stch-skip-cached-orders" type="checkbox" ${state.cfg.skipCachedOrderResults ? "checked" : ""}> 扫描时跳过缓存内结果</label>
            <span class="stch-settings-hint">缓存超期会自动删除；天数显示与黑名单一致，0 为今天</span>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">游戏/AppID 黑名单</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>
              <input id="stch-settings-auto-bl-enabled" type="checkbox" ${state.cfg.autoBlackEnabled ? "checked" : ""}>
              启用自动游戏黑名单
            </label>
            <label class="stch-primary-label">价格上限 ¥ <input id="stch-settings-auto-bl-threshold" class="stch-input" type="number" min="0" step="0.5" value="${state.cfg.autoBlackThreshold}" style="width:70px"></label>
            <label><input id="stch-settings-early-prediction-auto-blacklist" type="checkbox" ${state.cfg.earlyPredictionAutoBlacklist ? "checked" : ""}> 预测跳过时加入自动黑名单</label>
            <span class="stch-settings-hint">预测价格也必须超过自动黑名单价格上限才会加入</span>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">徽章合成</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>每次合成请求间隔 <input id="stch-craft-interval" class="stch-input" type="number" min="200" step="100" value="${state.cfg.craftInterval}" style="width:70px"> ms</label>
            <span class="stch-settings-hint">逐级升级按每一级等待；一次升满按每个徽章等待</span>
          </div>
          <div style="color:#fff;font-weight:bold;font-size:16px;margin:18px 0 4px;">多余物品处理</div>
          <div style="border-bottom:1px solid #45556b;margin-bottom:12px;"></div>
          <div class="stch-toolbar">
            <label>默认保留 <input id="stch-grind-reserve-copies" class="stch-input" type="number" min="0" step="1" value="${state.cfg.grindReserveCopies}" style="width:55px"> 份背景/表情</label>
            <label title="点数商店类副本按不可交易且不可上架的背景/表情识别">
              <input id="stch-grind-include-points-shop" type="checkbox" ${state.cfg.grindIncludePointsShopItems ? "checked" : ""}>
              重复物品计算包含点数商店物品
            </label>
          </div>
          ${seasonalOnly ? "" : `
          <div class="stch-settings-page-actions">
            <span class="stch-footer-status" id="stch-settings-action-status"></span>
            <div class="stch-btn alt" id="stch-onboarding-open">重新查看使用说明</div>
            <div class="stch-btn alt" id="stch-settings-clear-cache" title="清除订购卡牌缓存">清除缓存</div>
            <div class="stch-btn stch-btn-danger" id="stch-settings-reset">恢复默认设定</div>
          </div>
          `}
        </div>
      </div>
      <div class="stch-footer">
        <span class="stch-label">V2.0.5 · 默认货币：人民币(CNY)</span>
      </div>
    `;
    document.body.appendChild(modal);
    modalEl = modal;
    initLogResizers(modal);
    modal.querySelector(".stch-close").addEventListener("click", closeModal);
    const readNumberInput = (id, fallback, options2 = {}) => {
      const raw = document.getElementById(id)?.value;
      let value = options2.integer ? parseInt(raw, 10) : parseFloat(raw);
      if (!Number.isFinite(value)) return fallback;
      if (options2.integer) value = Math.floor(value);
      if (Number.isFinite(options2.min)) value = Math.max(options2.min, value);
      if (Number.isFinite(options2.max)) value = Math.min(options2.max, value);
      return value;
    };
    const getSurplusItemMode = () => {
      const value = document.getElementById("stch-surplus-item-mode")?.value || state.cfg.surplusItemMode || DEFAULT_CONFIG.surplusItemMode;
      return ["card", "background", "emoticon"].includes(value) ? value : "card";
    };
    const applySurplusItemMode = () => {
      const mode = getSurplusItemMode();
      const cardPanel = document.getElementById("stch-surplus-card-panel");
      const grindPanel = document.getElementById("stch-surplus-grind-panel");
      cardPanel?.classList.toggle("active", mode === "card");
      grindPanel?.classList.toggle("active", mode !== "card");
      modal.querySelectorAll(".stch-card-only-control").forEach((element) => {
        element.style.display = mode === "card" ? "" : "none";
      });
      modal.querySelectorAll(".stch-grind-only-control").forEach((element) => {
        element.style.display = mode === "card" ? "none" : "";
      });
      modal.querySelectorAll(".stch-card-scan-action").forEach((element) => {
        element.style.display = mode === "card" ? "" : "none";
      });
      modal.querySelectorAll(".stch-grind-scan-action").forEach((element) => {
        element.style.display = mode === "card" ? "none" : "";
      });
      const grindButton = document.getElementById("stch-grind-scan-btn");
      if (grindButton) {
        grindButton.textContent = mode === "emoticon" ? "扫描可分解表情" : "扫描可分解背景";
      }
      renderSurplusResults();
      renderGrindResults();
      updateSurplusActionState();
      updateGrindActionState();
    };
    const syncConfigFromInputs = (changedId) => {
      const previousSurplusItemMode = state.cfg.surplusItemMode || DEFAULT_CONFIG.surplusItemMode;
      state.cfg.threshold = readNumberInput(
        "stch-threshold",
        state.cfg.threshold ?? DEFAULT_CONFIG.threshold,
        { min: 0 }
      );
      state.cfg.requestInterval = readNumberInput(
        "stch-req-interval",
        state.cfg.requestInterval ?? DEFAULT_CONFIG.requestInterval,
        { integer: true, min: 0 }
      );
      state.cfg.maxBadgePages = readNumberInput(
        "stch-max-pages",
        state.cfg.maxBadgePages ?? DEFAULT_CONFIG.maxBadgePages,
        { integer: true, min: 1 }
      );
      state.cfg.includeDrops = !!document.getElementById("stch-include-drops")?.checked;
      state.cfg.foilScanMode = !!document.getElementById("stch-foil-scan-mode")?.checked;
      state.cfg.batchSize = readNumberInput(
        "stch-batch-size",
        state.cfg.batchSize ?? DEFAULT_CONFIG.batchSize,
        { integer: true, min: 1 }
      );
      state.cfg.batchPause = readNumberInput(
        "stch-batch-pause",
        state.cfg.batchPause ?? DEFAULT_CONFIG.batchPause,
        { integer: true, min: 0 }
      );
      state.cfg.showNoResultLogs = !!document.getElementById("stch-show-no-result-logs")?.checked;
      const buyModeEl = document.getElementById("stch-buy-mode");
      if (state.cfg.foilScanMode) {
        state.cfg.buyMode = buyModeEl?.dataset.normalValue || state.cfg.buyMode || DEFAULT_CONFIG.buyMode;
      } else {
        state.cfg.buyMode = buyModeEl?.dataset.normalValue || buyModeEl?.value || state.cfg.buyMode;
        if (buyModeEl) delete buyModeEl.dataset.normalValue;
      }
      state.cfg.orderPriceSource = document.getElementById("stch-order-price-source")?.value || state.cfg.orderPriceSource;
      state.cfg.priceAdjustment = readNumberInput(
        "stch-price-adjustment",
        state.cfg.priceAdjustment ?? DEFAULT_CONFIG.priceAdjustment
      );
      state.cfg.earlyPricePrediction = !!document.getElementById("stch-early-price-prediction")?.checked;
      state.cfg.earlyPredictionAutoBlacklist = !!document.getElementById("stch-settings-early-prediction-auto-blacklist")?.checked;
      state.cfg.orderCacheDays = readNumberInput(
        "stch-order-cache-days",
        state.cfg.orderCacheDays ?? DEFAULT_CONFIG.orderCacheDays,
        { integer: true, min: 0 }
      );
      state.cfg.skipCachedOrderResults = !!document.getElementById("stch-skip-cached-orders")?.checked;
      state.cfg.surplusOnlyMaxed = !!document.getElementById("stch-surplus-only-maxed")?.checked;
      state.cfg.surplusOnlyTradable = !!document.getElementById("stch-surplus-only-tradable")?.checked;
      state.cfg.surplusCompareGems = !!document.getElementById("stch-surplus-compare-gems")?.checked;
      state.cfg.surplusItemMode = getSurplusItemMode();
      state.cfg.surplusSellPriceSource = document.getElementById("stch-surplus-sell-price-source")?.value || state.cfg.surplusSellPriceSource || DEFAULT_CONFIG.surplusSellPriceSource;
      state.cfg.surplusSellPriceAdjustment = readNumberInput(
        "stch-surplus-sell-adjustment",
        state.cfg.surplusSellPriceAdjustment ?? DEFAULT_CONFIG.surplusSellPriceAdjustment
      );
      state.cfg.grindOnlyRecommended = !!document.getElementById("stch-grind-only-recommended")?.checked;
      state.cfg.grindReserveCopies = readNumberInput(
        "stch-grind-reserve-copies",
        state.cfg.grindReserveCopies ?? DEFAULT_CONFIG.grindReserveCopies,
        { integer: true, min: 0 }
      );
      state.cfg.grindIncludePointsShopItems = !!document.getElementById("stch-grind-include-points-shop")?.checked;
      const includeSurplusCards = document.getElementById("stch-grind-include-surplus-cards");
      if (includeSurplusCards) {
        state.cfg.grindIncludeSurplusCards = !!includeSurplusCards.checked;
      }
      state.cfg.craftInterval = readNumberInput(
        "stch-craft-interval",
        state.cfg.craftInterval ?? DEFAULT_CONFIG.craftInterval,
        { integer: true, min: 200 }
      );
      state.cfg.craftMode = document.getElementById("stch-craft-mode")?.value || state.cfg.craftMode;
      state.cfg.seasonalTargetLevel = readNumberInput(
        "stch-seasonal-target",
        state.cfg.seasonalTargetLevel ?? DEFAULT_CONFIG.seasonalTargetLevel,
        { integer: true, min: 1, max: SEASONAL_BADGE_MAX_LEVEL }
      );
      saveConfig(state.cfg);
      const craftMaxPages = document.getElementById("stch-craft-max-pages");
      if (craftMaxPages) craftMaxPages.value = String(state.cfg.maxBadgePages);
      updateResultColumns();
      applyScanModeTheme();
      if (changedId === "stch-order-cache-days") {
        pruneOrderCache(true);
        renderOrderResults();
      }
      if (changedId === "stch-craft-mode") renderCraftResults();
      if (["stch-surplus-only-maxed", "stch-surplus-only-tradable", "stch-surplus-compare-gems"].includes(changedId)) {
        renderSurplusResults();
        renderGrindResults();
      }
      if (changedId === "stch-surplus-item-mode") {
        if (state.cfg.surplusItemMode !== previousSurplusItemMode) {
          state.grindResults = [];
          state.selectedGrindResults = /* @__PURE__ */ new Set();
          state.grindGemPrice = null;
        }
        applySurplusItemMode();
      }
      if (["stch-grind-reserve-copies", "stch-grind-include-points-shop"].includes(changedId)) {
        state.grindResults = [];
        state.selectedGrindResults = /* @__PURE__ */ new Set();
        state.grindGemPrice = null;
      }
      if (changedId?.startsWith("stch-grind-")) renderGrindResults();
      if (changedId?.startsWith("stch-seasonal-")) {
        normalizeSeasonalInputs();
        updateSeasonalSummary();
      }
    };
    const cfgIds = [
      "stch-threshold",
      "stch-req-interval",
      "stch-max-pages",
      "stch-include-drops",
      "stch-foil-scan-mode",
      "stch-batch-size",
      "stch-batch-pause",
      "stch-show-no-result-logs",
      "stch-buy-mode",
      "stch-early-price-prediction",
      "stch-settings-early-prediction-auto-blacklist",
      "stch-order-cache-days",
      "stch-skip-cached-orders",
      "stch-craft-interval",
      "stch-craft-mode",
      "stch-seasonal-target",
      "stch-surplus-item-mode",
      "stch-surplus-only-maxed",
      "stch-surplus-only-tradable",
      "stch-surplus-compare-gems",
      "stch-surplus-sell-price-source",
      "stch-surplus-sell-adjustment",
      "stch-grind-only-recommended",
      "stch-grind-include-surplus-cards",
      "stch-grind-reserve-copies",
      "stch-grind-include-points-shop"
    ];
    cfgIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", () => syncConfigFromInputs(id));
      el.addEventListener("change", () => syncConfigFromInputs(id));
    });
    const orderPriceSourceIds = [
      "stch-order-price-source",
      "stch-order-page-price-source"
    ];
    const orderPriceAdjustmentIds = [
      "stch-price-adjustment",
      "stch-order-page-price-adjustment"
    ];
    const refreshPricingSummaries = () => {
      updateSummary();
      updateOrderSummary();
    };
    const renderOrderPricingControls = (exceptId = "") => {
      orderPriceSourceIds.forEach((id) => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.value = state.cfg.orderPriceSource || DEFAULT_CONFIG.orderPriceSource;
      });
      orderPriceAdjustmentIds.forEach((id) => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.value = String(state.cfg.priceAdjustment ?? DEFAULT_CONFIG.priceAdjustment);
      });
    };
    orderPriceSourceIds.forEach((id) => {
      document.getElementById(id)?.addEventListener("change", (event) => {
        state.cfg.orderPriceSource = event.currentTarget.value;
        renderOrderPricingControls();
        saveConfig(state.cfg);
        refreshPricingSummaries();
      });
    });
    const syncOrderPriceAdjustment = (event, normalizeSource = false) => {
      const parsed = parseFloat(event.currentTarget.value);
      state.cfg.priceAdjustment = Number.isFinite(parsed) ? parsed : 0;
      renderOrderPricingControls(normalizeSource ? "" : event.currentTarget.id);
      saveConfig(state.cfg);
      refreshPricingSummaries();
    };
    orderPriceAdjustmentIds.forEach((id) => {
      const input = document.getElementById(id);
      input?.addEventListener("input", (event) => syncOrderPriceAdjustment(event, false));
      input?.addEventListener("change", (event) => syncOrderPriceAdjustment(event, true));
    });
    renderOrderPricingControls();
    const activateTab = (tabName) => {
      modal.querySelectorAll(".stch-tab").forEach((tab) => {
        tab.classList.toggle("active", tab.dataset.tab === tabName);
      });
      modal.querySelectorAll(".stch-tab-content").forEach((content) => {
        content.classList.toggle("active", content.id === `stch-tab-${tabName}`);
      });
      if (tabName === "blacklist") renderBlacklist();
      if (tabName === "orders") renderOrderResults();
      if (tabName === "surplus") applySurplusItemMode();
    };
    const showOnboarding = () => {
      GM_setValue(ONBOARDING_SEEN_KEY, true);
      activateTab("scan");
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "flex";
    };
    const closeOnboarding = () => {
      const onboarding = document.getElementById("stch-onboarding");
      if (onboarding) onboarding.style.display = "none";
    };
    let settingsStatusTimer = null;
    const setSettingsActionStatus = (text) => {
      const status = document.getElementById("stch-settings-action-status");
      if (!status) return;
      status.textContent = text;
      if (settingsStatusTimer) clearTimeout(settingsStatusTimer);
      settingsStatusTimer = text ? setTimeout(() => {
        status.textContent = "";
      }, 3500) : null;
    };
    const clearCachedOrders = (event) => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const cachedCount = readRawOrderCache().length;
      if (cachedCount === 0) {
        clearOrderCache();
        renderOrderResults();
        updateAllActionStates();
        setSettingsActionStatus("订购缓存为空");
        return;
      }
      if (!confirm(`将移除 ${cachedCount} 项订购卡牌缓存，确定？`)) return;
      clearOrderCache();
      renderOrderResults();
      updateAllActionStates();
      setSettingsActionStatus(`已移除 ${cachedCount} 项缓存`);
    };
    const restoreDefaultSettings = (event) => {
      if (event.currentTarget.classList.contains("disabled")) return;
      if (!confirm("将恢复所有设置项为默认值。游戏/AppID黑名单和订购缓存会保留，确定？")) return;
      const preservedKeys = [
        "blacklist",
        "blacklistNames",
        "blacklistSources",
        "blacklistDates",
        "blacklistFixed"
      ];
      const preserved = Object.fromEntries(
        preservedKeys.map((key) => [key, state.cfg[key] ?? DEFAULT_CONFIG[key]])
      );
      state.cfg = { ...DEFAULT_CONFIG, ...preserved };
      saveConfig(state.cfg);
      modal.remove();
      document.getElementById("stch-backdrop")?.remove();
      modalEl = null;
      buildModal({ initialTab: "settings", suppressOnboarding: true });
      const status = document.getElementById("stch-settings-action-status");
      if (status) status.textContent = "已恢复默认设定";
    };
    modal.querySelectorAll(".stch-tab[data-tab]").forEach((tab) => {
      tab.addEventListener("click", () => {
        activateTab(tab.dataset.tab);
      });
    });
    document.getElementById("stch-onboarding-close").addEventListener("click", closeOnboarding);
    document.getElementById("stch-onboarding-open")?.addEventListener("click", showOnboarding);
    document.getElementById("stch-settings-clear-cache")?.addEventListener("click", clearCachedOrders);
    document.getElementById("stch-settings-reset")?.addEventListener("click", restoreDefaultSettings);
    document.getElementById("stch-scan-btn").addEventListener("click", startScan);
    document.getElementById("stch-stop-btn").addEventListener("click", requestStop);
    document.getElementById("stch-skip-btn").addEventListener("click", skipCurrentBadge);
    document.getElementById("stch-recalculate-btn").addEventListener("click", recalculateSelectedResults);
    document.getElementById("stch-submit-orders-btn").addEventListener("click", submitSelectedBuyOrders);
    document.getElementById("stch-order-add-btn").addEventListener("click", addManualOrderAppid);
    document.getElementById("stch-order-recalculate-btn").addEventListener("click", recalculateSelectedOrderResults);
    document.getElementById("stch-order-submit-orders-btn").addEventListener("click", submitSelectedOrderBuyOrders);
    document.getElementById("stch-order-delete-btn").addEventListener("click", deleteExpiredOrderResults);
    document.getElementById("stch-craft-scan-btn").addEventListener("click", startCraftScan);
    document.getElementById("stch-craft-stop-btn").addEventListener("click", requestCraftStop);
    document.getElementById("stch-craft-one-btn").addEventListener("click", () => setAllCraftCounts("one"));
    document.getElementById("stch-craft-max-btn").addEventListener("click", () => setAllCraftCounts("max"));
    document.getElementById("stch-craft-clear-btn").addEventListener("click", () => setAllCraftCounts("clear"));
    document.getElementById("stch-craft-submit-btn").addEventListener("click", submitCraftPlan);
    document.getElementById("stch-seasonal-buy-btn").addEventListener("click", startSeasonalPurchase);
    document.getElementById("stch-seasonal-stop-btn").addEventListener("click", requestSeasonalStop);
    document.getElementById("stch-surplus-scan-btn").addEventListener("click", startSurplusScan);
    document.getElementById("stch-surplus-stop-btn").addEventListener("click", requestSurplusStop);
    document.getElementById("stch-grind-scan-btn").addEventListener("click", startGrindScan);
    document.getElementById("stch-grind-stop-btn").addEventListener("click", requestGrindStop);
    document.getElementById("stch-surplus-select-all-btn").addEventListener("click", (event) => {
      if (event.currentTarget.classList.contains("disabled")) return;
      const mode = getSurplusItemMode();
      const list = document.getElementById(mode === "card" ? "stch-surplus-list" : "stch-grind-list");
      const tiles = list ? [...list.querySelectorAll(".stch-inv-tile")] : [];
      const allSelected = tiles.length > 0 && tiles.every((tile) => tile.classList.contains("selected"));
      if (mode === "card") setAllVisibleSurplusSelection(!allSelected);
      else setAllVisibleGrindSelection(!allSelected);
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-sell-btn").addEventListener("click", (event) => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingSell();
      updateAllActionStates();
    });
    document.getElementById("stch-surplus-gem-btn").addEventListener("click", (event) => {
      if (event.currentTarget.classList.contains("disabled")) return;
      submitSelectedProcessingGems();
      updateAllActionStates();
    });
    const syncCraftMaxPages = (event) => {
      state.cfg.maxBadgePages = Math.max(
        1,
        parseInt(event.target.value, 10) || DEFAULT_CONFIG.maxBadgePages
      );
      const scanMaxPages = document.getElementById("stch-max-pages");
      if (scanMaxPages) scanMaxPages.value = String(state.cfg.maxBadgePages);
      saveConfig(state.cfg);
    };
    const craftMaxPagesInput = document.getElementById("stch-craft-max-pages");
    craftMaxPagesInput.addEventListener("input", syncCraftMaxPages);
    craftMaxPagesInput.addEventListener("change", syncCraftMaxPages);
    const autoBlacklistEnabledIds = [
      "stch-auto-bl-enabled",
      "stch-settings-auto-bl-enabled"
    ];
    const autoBlacklistThresholdIds = [
      "stch-auto-bl-threshold",
      "stch-settings-auto-bl-threshold"
    ];
    const renderAutoBlacklistControls = (exceptId = "") => {
      autoBlacklistEnabledIds.forEach((id) => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.checked = !!state.cfg.autoBlackEnabled;
      });
      autoBlacklistThresholdIds.forEach((id) => {
        if (id === exceptId) return;
        const input = document.getElementById(id);
        if (input) input.value = String(state.cfg.autoBlackThreshold ?? 0);
      });
    };
    autoBlacklistEnabledIds.forEach((id) => {
      document.getElementById(id)?.addEventListener("change", (event) => {
        state.cfg.autoBlackEnabled = !!event.currentTarget.checked;
        renderAutoBlacklistControls();
        saveConfig(state.cfg);
      });
    });
    const syncAutoBlacklistThreshold = (event, normalizeSource = false) => {
      const parsed = parseFloat(event.currentTarget.value);
      state.cfg.autoBlackThreshold = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
      renderAutoBlacklistControls(normalizeSource ? "" : event.currentTarget.id);
      saveConfig(state.cfg);
    };
    autoBlacklistThresholdIds.forEach((id) => {
      const input = document.getElementById(id);
      input?.addEventListener("input", (event) => syncAutoBlacklistThreshold(event, false));
      input?.addEventListener("change", (event) => syncAutoBlacklistThreshold(event, true));
    });
    renderAutoBlacklistControls();
    applyScanModeTheme();
    if (!options.suppressOnboarding && !isPointsShopPage() && !GM_getValue(ONBOARDING_SEEN_KEY, false)) {
      showOnboarding();
    }
    document.getElementById("stch-bl-lookup").addEventListener("click", () => {
      const appid = document.getElementById("stch-bl-appid").value.trim();
      if (!appid || !/^\d+$/.test(appid)) {
        document.getElementById("stch-bl-result").textContent = "请输入有效的 AppID";
        return;
      }
      document.getElementById("stch-bl-result").textContent = "查询中...";
      lookupGameName(appid).then((name) => {
        state.blLookupAppid = appid;
        state.blLookupName = name;
        document.getElementById("stch-bl-result").textContent = name ? `${appid} — ${name}` : "未找到该游戏";
        updateBlRow();
      });
    });
    document.getElementById("stch-bl-add").addEventListener("click", () => {
      if (!state.blLookupAppid || !state.blLookupName) return;
      addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 0);
      document.getElementById("stch-bl-result").textContent = `${state.blLookupName} 已加入游戏黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      state.blLookupAppid = "";
      state.blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });
    document.getElementById("stch-bl-add-fixed").addEventListener("click", () => {
      if (!state.blLookupAppid || !state.blLookupName) return;
      addToBlacklist(state.blLookupAppid, state.blLookupName, 0, 1);
      document.getElementById("stch-bl-result").textContent = `${state.blLookupName} 已加入固定游戏黑名单`;
      document.getElementById("stch-bl-appid").value = "";
      state.blLookupAppid = "";
      state.blLookupName = "";
      updateBlRow();
      renderBlacklist();
    });
    document.getElementById("stch-bl-del-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map((s2) => s2.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try {
        n = JSON.parse(state.cfg.blacklistNames || "{}");
      } catch (_) {
        n = {};
      }
      try {
        s = JSON.parse(state.cfg.blacklistSources || "{}");
      } catch (_) {
        s = {};
      }
      try {
        d = JSON.parse(state.cfg.blacklistDates || "{}");
      } catch (_) {
        d = {};
      }
      try {
        f = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
        f = {};
      }
      allCbs.forEach((cb) => {
        const appid = cb.dataset.appid;
        const idx = bl.indexOf(appid);
        if (idx >= 0) bl.splice(idx, 1);
        delete n[appid];
        delete s[appid];
        delete d[appid];
        delete f[appid];
      });
      state.cfg.blacklist = bl.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });
    document.getElementById("stch-bl-fix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      let f = {};
      try {
        f = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
        f = {};
      }
      allCbs.forEach((cb) => {
        f[cb.dataset.appid] = 1;
      });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });
    document.getElementById("stch-bl-unfix-sel").addEventListener("click", () => {
      const list = document.getElementById("stch-bl-list");
      const listFixed = document.getElementById("stch-bl-list-fixed");
      if (!list) return;
      const allCbs = [...list.querySelectorAll(".stch-bl-cb:checked")];
      if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));
      if (allCbs.length === 0) return;
      let f = {};
      try {
        f = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
        f = {};
      }
      allCbs.forEach((cb) => {
        f[cb.dataset.appid] = 0;
      });
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      updateBlRow();
      renderBlacklist();
    });
    document.getElementById("stch-bl-cleanup").addEventListener("click", () => {
      const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map((s2) => s2.trim()).filter(Boolean) : [];
      let n, s, d, f;
      try {
        n = JSON.parse(state.cfg.blacklistNames || "{}");
      } catch (_) {
        n = {};
      }
      try {
        s = JSON.parse(state.cfg.blacklistSources || "{}");
      } catch (_) {
        s = {};
      }
      try {
        d = JSON.parse(state.cfg.blacklistDates || "{}");
      } catch (_) {
        d = {};
      }
      try {
        f = JSON.parse(state.cfg.blacklistFixed || "{}");
      } catch (_) {
        f = {};
      }
      const now = Date.now();
      const expired = bl.filter((a) => !f[a] && d[a] && now - d[a] > 7 * 864e5);
      if (expired.length === 0) {
        document.getElementById("stch-bl-result").textContent = "没有可清理的过期项";
        return;
      }
      if (!confirm(`将清理 ${expired.length} 项过期（>7天）游戏黑名单，确定？`)) return;
      const keep = bl.filter((a) => !expired.includes(a));
      expired.forEach((a) => {
        delete n[a];
        delete s[a];
        delete d[a];
        delete f[a];
      });
      state.cfg.blacklist = keep.join(",");
      state.cfg.blacklistNames = JSON.stringify(n);
      state.cfg.blacklistSources = JSON.stringify(s);
      state.cfg.blacklistDates = JSON.stringify(d);
      state.cfg.blacklistFixed = JSON.stringify(f);
      saveConfig(state.cfg);
      document.getElementById("stch-bl-result").textContent = `已清理 ${expired.length} 项`;
      renderBlacklist();
    });
    renderBlacklist();
    normalizeSeasonalInputs();
    updateSeasonalActionState();
    updateSeasonalSummary();
    applySurplusItemMode();
    updateSurplusActionState();
    renderSurplusResults();
    updateGrindActionState();
    renderGrindResults();
    pruneOrderCache(true);
    renderOrderResults();
    renderResults();
    updateAllActionStates();
  }
  function closeModal() {
    const backdrop = document.getElementById("stch-backdrop");
    if (backdrop) backdrop.style.display = "none";
    if (modalEl) modalEl.style.display = "none";
  }

  // src/ui/entry.js
  function findPointsBalanceContainer() {
    const candidates = Array.from(document.querySelectorAll("a, span, div"));
    const label = candidates.find(
      (el) => /^(您的点数余额|your points balance)$/i.test((el.textContent || "").trim())
    ) || candidates.find((el) => {
      const text = (el.textContent || "").trim();
      return text.length <= 80 && /您的点数余额|your points balance/i.test(text);
    });
    const container = label?.parentElement;
    if (container) return container;
    return null;
  }
  function getEntryBtn() {
    let btn = document.getElementById("stch-entry-btn");
    if (btn) return btn;
    btn = document.createElement("span");
    btn.id = "stch-entry-btn";
    btn.className = "stch-btn-entry";
    btn.textContent = "Steam Trading Card Helper";
    btn.addEventListener("click", openModal);
    return btn;
  }
  function placeInventoryEntryBtn(btn) {
    const nav = document.querySelector(".inventory_rightnav");
    if (!nav) return false;
    const reload = nav.querySelector("#inventory_reload_button, .reload_inventory");
    const trade = nav.querySelector(".new_trade_offer_btn, a[href*='/tradeoffers/']");
    if (!reload && !trade) return false;
    btn.classList.add("stch-inventory-entry");
    if (trade?.parentElement === nav) {
      nav.insertBefore(btn, trade);
    } else if (reload?.parentElement === nav && reload.nextSibling) {
      nav.insertBefore(btn, reload.nextSibling);
    } else {
      nav.appendChild(btn);
    }
    return true;
  }
  function injectEntryBtn() {
    const btn = getEntryBtn();
    btn.classList.remove("stch-inventory-entry");
    if (isPointsShopPage()) {
      const container = findPointsBalanceContainer();
      if (!container) return false;
      const wrapper = document.createElement("div");
      wrapper.className = "stch-store-entry-wrap";
      wrapper.appendChild(btn);
      container.appendChild(wrapper);
      return true;
    }
    if (isInventoryPage()) {
      return placeInventoryEntryBtn(btn);
    }
    const target = document.querySelector(".profile_xp_block") || document.querySelector(".badges_header") || document.body;
    if (target.classList.contains("profile_xp_block")) {
      target.appendChild(btn);
    } else {
      target.insertBefore(btn, target.firstChild);
    }
    return true;
  }
  function observeEntryBtn() {
    if (injectEntryBtn()) return;
    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts += 1;
      if (injectEntryBtn() || attempts >= 80) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 2e4);
  }

  // src/utils/xp.js
  function xpRequiredForLevel(level) {
    let total = 0;
    for (let current = 0; current < level; current++) {
      total += (Math.floor(current / 10) + 1) * 100;
    }
    return total;
  }
  function xpStepForLevel(level) {
    return (Math.floor(Math.max(0, level) / 10) + 1) * 100;
  }

  // src/sidebar/profile.js
  async function resolveSidebarSteamId(profileUrl, badgeHtml) {
    const known = getSteamId() || parseSteamIdFromText(badgeHtml) || parseSteamIdFromProfileUrl(profileUrl);
    if (known) return known;
    if (!profileUrl) return "";
    try {
      const xml = await stchRequestText(`${profileUrl}/?xml=1`);
      const match = xml.match(/<steamID64>(\d{17})<\/steamID64>/);
      return match ? match[1] : "";
    } catch (_) {
      return "";
    }
  }
  function parseSidebarProfileInfo(doc, html, profileUrl, steamId) {
    const bodyText = (doc.body?.innerText || doc.body?.textContent || "").replace(/\u00a0/g, " ");
    const rawName = getFirstText(doc, [
      ".profile_small_header_name > a",
      ".profile_small_header_name",
      ".profile_header .persona_name .actual_persona_name",
      ".profile_header .persona_name_text_content",
      ".actual_persona_name",
      "#global_actions .persona"
    ]) || getFirstText(document, ["#global_actions .persona"]);
    const name = rawName.replace(/\s*».*$/, "").trim();
    const avatarSelectors = [
      ".profile_small_header_avatar > .playerAvatar > picture img",
      ".profile_small_header_avatar > .playerAvatar > img",
      ".profile_header .playerAvatar > picture img",
      ".profile_header .playerAvatar > img",
      ".playerAvatarAutoSizeInner > img",
      "#global_actions a.user_avatar > img"
    ];
    const avatar = getFirstImageUrl(doc, avatarSelectors) || getFirstImageUrl(document, avatarSelectors) || normalizeSteamAvatarUrl(getFirstAttr(doc, [
      "meta[property='og:image']",
      "meta[name='twitter:image']",
      "link[rel='image_src']"
    ], "content") || getFirstAttr(doc, ["link[rel='image_src']"], "href"));
    const level = parseIntLoose(getFirstText(doc, [
      ".profile_xp_block .friendPlayerLevelNum",
      ".friendPlayerLevelNum"
    ]));
    const xpMatches = [...bodyText.matchAll(/([\d,，]+)\s*(?:点经验值|XP)/gi)].map((match) => parseIntLoose(match[1])).filter(Boolean);
    const totalXp = xpMatches.length > 0 ? Math.max(...xpMatches) : 0;
    let nextLevel = level ? level + 1 : 0;
    let remainingXp = 0;
    const zhNextMatch = bodyText.match(/升到\s*(\d+)\s*级还需\s*([\d,，]+)\s*点经验值/i);
    const enNextMatch = bodyText.match(/([\d,，]+)\s*XP\s*(?:needed|required).*?Level\s*(\d+)/i);
    if (zhNextMatch) {
      nextLevel = parseIntLoose(zhNextMatch[1]) || nextLevel;
      remainingXp = parseIntLoose(zhNextMatch[2]);
    } else if (enNextMatch) {
      remainingXp = parseIntLoose(enNextMatch[1]);
      nextLevel = parseIntLoose(enNextMatch[2]) || nextLevel;
    } else if (level && totalXp) {
      remainingXp = Math.max(0, xpRequiredForLevel(level + 1) - totalXp);
    }
    const stepXp = level ? xpStepForLevel(level) : 0;
    const earnedThisLevel = stepXp ? Math.max(0, stepXp - remainingXp) : 0;
    return {
      avatar,
      name: name || "Steam 用户",
      level,
      totalXp,
      nextLevel,
      remainingXp,
      stepXp,
      earnedThisLevel,
      profileUrl,
      steamId,
      html
    };
  }
  async function loadSidebarProfileInfo() {
    const profileUrl = getProfileUrl();
    if (!profileUrl) throw new Error("未找到个人资料地址");
    let html = "";
    if (location.hostname === "steamcommunity.com" && location.pathname.includes("/badges")) {
      html = document.documentElement.outerHTML;
    } else {
      html = await stchRequestText(`${profileUrl}/badges/`);
    }
    const steamId = await resolveSidebarSteamId(profileUrl, html);
    const doc = new DOMParser().parseFromString(html, "text/html");
    return parseSidebarProfileInfo(doc, html, profileUrl, steamId);
  }

  // src/sidebar/sidebar.js
  var sidebarLoading = false;
  var sidebarData = {
    profile: null,
    gems: null,
    gemPrice: null,
    error: ""
  };
  function setSidebarText(id, text, title = "") {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.title = title || text;
  }
  function renderSidebar() {
    const profile = sidebarData.profile || {};
    const gems = sidebarData.gems || {};
    const gemPrice = sidebarData.gemPrice || {};
    const avatar = document.getElementById("stch-sidebar-avatar");
    if (avatar && profile.avatar) avatar.src = profile.avatar;
    const hasRemainingXp = Number.isFinite(Number(profile.remainingXp)) && Number.isFinite(Number(profile.stepXp)) && Number(profile.stepXp) > 0;
    setSidebarText("stch-sidebar-name", profile.name || "Steam 用户");
    setSidebarText("stch-sidebar-level", profile.level ? `Lv ${formatInt(profile.level)}` : "—");
    setSidebarText("stch-sidebar-xp", profile.totalXp ? `${formatInt(profile.totalXp)} 点` : "—");
    setSidebarText(
      "stch-sidebar-next",
      hasRemainingXp ? `${formatInt(profile.remainingXp)} / ${formatInt(profile.stepXp)}` : "—"
    );
    const progress = document.getElementById("stch-sidebar-progress-bar");
    if (progress) {
      const pct = profile.stepXp ? Math.min(100, Math.max(0, profile.earnedThisLevel / profile.stepXp * 100)) : 0;
      progress.style.width = `${pct}%`;
    }
    const gemText = Number.isFinite(gems.totalGems) ? `${formatInt(gems.totalGems)} 宝石${gems.sackCount ? `（${formatInt(gems.sackCount)} 宝石袋）` : ""}` : "—";
    setSidebarText("stch-sidebar-gems", gemText);
    const priceEl = document.getElementById("stch-sidebar-gem-price");
    if (priceEl) {
      priceEl.replaceChildren();
      if (gemPrice.priceCents) {
        const previousPriceCents = Number(gemPrice.previousPriceCents) || 0;
        if (previousPriceCents > 0) {
          const changeCents = gemPrice.priceCents - previousPriceCents;
          const change = document.createElement("span");
          change.className = changeCents > 0 ? "stch-sidebar-price-rise" : changeCents < 0 ? "stch-sidebar-price-fall" : "stch-sidebar-price-flat";
          change.textContent = changeCents === 0 ? `(±¥${formatCNY(0)}) ` : `(${changeCents > 0 ? "+" : "-"}¥${formatCNY(Math.abs(changeCents))}) `;
          priceEl.appendChild(change);
        }
        priceEl.appendChild(
          document.createTextNode(`${GEM_SACK_SIZE}宝石/¥${formatCNY(gemPrice.priceCents)}`)
        );
      } else {
        priceEl.textContent = "—";
      }
    }
    const gemSackNetCents = gemPrice.priceCents ? getGemSackSellerNetCents(gemPrice.priceCents) : 0;
    const priceTitle = gemPrice.priceCents ? `${gemPrice.source}${gemPrice.volume ? `，成交量 ${formatInt(gemPrice.volume)}` : ""}，税后到手约 ¥${formatCNY(gemSackNetCents)}` : "暂无宝石袋市场价格";
    if (priceEl) priceEl.title = priceTitle;
    const breakEven10 = gemPrice.priceCents ? getGemBreakEvenBuyerPrice(10, gemPrice.priceCents) : 0;
    const breakEvenTitle = breakEven10 ? `按宝石袋税后到手 ¥${formatCNY(gemSackNetCents)} 计算；物品卖出税后低于该值时，分解成宝石更值` : "暂无宝石袋市场价格";
    setSidebarText(
      "stch-sidebar-grind-threshold",
      breakEven10 ? `10宝石/¥${formatCNY(breakEven10)}` : "—",
      breakEvenTitle
    );
    const status = document.getElementById("stch-sidebar-status");
    if (status) {
      status.textContent = sidebarLoading ? "正在刷新账号信息、库存宝石和市场价格..." : sidebarData.error || (profile.name ? "已同步当前账号信息" : "鼠标移入侧栏后可查看信息");
    }
    const refresh = document.getElementById("stch-sidebar-refresh");
    if (refresh) refresh.disabled = sidebarLoading;
  }
  async function refreshSidebarData() {
    if (sidebarLoading) return;
    sidebarLoading = true;
    sidebarData.error = "";
    renderSidebar();
    try {
      const profile = await loadSidebarProfileInfo();
      sidebarData.profile = profile;
      renderSidebar();
      const [gemsResult, priceResult] = await Promise.allSettled([
        loadSidebarGemInfo(profile.steamId),
        loadSidebarGemPrice()
      ]);
      if (gemsResult.status === "fulfilled") {
        sidebarData.gems = gemsResult.value;
      } else {
        sidebarData.error = gemsResult.reason?.message || "库存宝石读取失败";
      }
      if (priceResult.status === "fulfilled") {
        const currentPriceCents = Number(priceResult.value?.priceCents) || 0;
        const savedGemPrice = GM_getValue(SIDEBAR_GEM_PRICE_KEY, null);
        const previousPriceCents = Number(
          typeof savedGemPrice === "object" ? savedGemPrice?.priceCents : savedGemPrice
        ) || 0;
        sidebarData.gemPrice = {
          ...priceResult.value,
          previousPriceCents
        };
        if (currentPriceCents > 0) {
          GM_setValue(SIDEBAR_GEM_PRICE_KEY, {
            priceCents: currentPriceCents,
            observedAt: Date.now()
          });
        }
      } else if (!sidebarData.error) {
        sidebarData.error = priceResult.reason?.message || "宝石价格读取失败";
      }
    } catch (error) {
      sidebarData.error = error?.message || "侧栏信息读取失败";
    } finally {
      sidebarLoading = false;
      renderSidebar();
    }
  }
  function setSidebarPinned(pinned) {
    const sidebar = document.getElementById("stch-sidebar");
    if (!sidebar) return;
    sidebar.classList.toggle("pinned", pinned);
    GM_setValue(SIDEBAR_PINNED_KEY, !!pinned);
    const pin = document.getElementById("stch-sidebar-pin");
    if (pin) pin.textContent = pinned ? "收起" : "固定";
  }
  function injectSidebar() {
    if (document.getElementById("stch-sidebar")) return;
    const sidebar = document.createElement("aside");
    sidebar.id = "stch-sidebar";
    sidebar.innerHTML = `
      <div class="stch-sidebar-panel">
        <div class="stch-sidebar-head">
          <img id="stch-sidebar-avatar" class="stch-sidebar-avatar" alt="">
          <div class="stch-sidebar-title">
            <div id="stch-sidebar-name" class="stch-sidebar-name">Steam 用户</div>
          </div>
          <button id="stch-sidebar-pin" class="stch-sidebar-pin" type="button">固定</button>
        </div>
        <div class="stch-sidebar-body">
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前等级</span><span id="stch-sidebar-level" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前经验值</span><span id="stch-sidebar-xp" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">距离下一级</span><span id="stch-sidebar-next" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-progress"><div id="stch-sidebar-progress-bar" class="stch-sidebar-progress-bar"></div></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">当前宝石</span><span id="stch-sidebar-gems" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">宝石价格参考</span><span id="stch-sidebar-gem-price" class="stch-sidebar-value">—</span></div>
          <div class="stch-sidebar-row"><span class="stch-sidebar-key">分解临界点</span><span id="stch-sidebar-grind-threshold" class="stch-sidebar-value">—</span></div>
          <div id="stch-sidebar-status" class="stch-sidebar-status">正在准备侧栏信息...</div>
          <div class="stch-sidebar-actions"><button id="stch-sidebar-refresh" class="stch-sidebar-refresh" type="button">刷新</button></div>
        </div>
      </div>
      <div id="stch-sidebar-handle" class="stch-sidebar-handle" aria-label="侧栏"></div>
    `;
    document.body.appendChild(sidebar);
    const initialPinned = !!GM_getValue(SIDEBAR_PINNED_KEY, false);
    setSidebarPinned(initialPinned);
    document.getElementById("stch-sidebar-pin")?.addEventListener("click", (event) => {
      event.stopPropagation();
      setSidebarPinned(!sidebar.classList.contains("pinned"));
    });
    document.getElementById("stch-sidebar-handle")?.addEventListener("click", (event) => {
      event.stopPropagation();
      setSidebarPinned(!sidebar.classList.contains("pinned"));
    });
    document.getElementById("stch-sidebar-refresh")?.addEventListener("click", (event) => {
      event.stopPropagation();
      refreshSidebarData();
    });
    renderSidebar();
    refreshSidebarData();
  }

  // src/index.js
  GM_addStyle(style_default);
  state.orderResults = loadOrderCache();
  pruneOrderCache(true);
  var pageUrl = window.location.href;
  var initWhenReady = (callback) => {
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
  } else if (isPointsShopPage()) {
    initWhenReady(() => {
      observeEntryBtn();
      injectSidebar();
    });
  } else {
    initWhenReady(() => {
      observeEntryBtn();
      injectSidebar();
    });
  }
})();
