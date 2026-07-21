import { state } from "../state.js";

import { saveConfig } from "../config.js";

import { getProfileUrl } from "../utils/steam.js";

import { createTextSpan } from "../utils/dom.js";
import { formatMoney } from "../utils/format.js";
import {
  normalizeBlacklistPriceEntry,
  parseBlacklistPriceData,
  setBlacklistPriceEntry,
} from "../services/blacklist-price.js";
import { enableCheckboxDragSelection } from "../ui/checkbox-drag.js";

  export function addToBlacklist(appid, name, source, fixedVal = 0, priceEntry = null) {
    appid = String(appid || "");
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
    const normalizedPrice = normalizeBlacklistPriceEntry(priceEntry);

    // Existing rows can still be promoted to fixed or receive fresher scan data.
    if (bl.includes(appid)) {
      let changed = false;
      if (fixedVal) {
        let fixed = {};
        try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
        if (!fixed[appid]) {
          fixed[appid] = 1;
          state.cfg.blacklistFixed = JSON.stringify(fixed);
          changed = true;
        }
      }
      if (normalizedPrice) {
        state.cfg.blacklistPriceData = JSON.stringify(setBlacklistPriceEntry(
          state.cfg.blacklistPriceData,
          appid,
          normalizedPrice
        ));
        changed = true;
      }
      if (changed) saveConfig(state.cfg);
      return;
    }

    bl.push(appid);
    state.cfg.blacklist = bl.join(",");

    let names = {};
    try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}
    names[appid] = name;
    state.cfg.blacklistNames = JSON.stringify(names);

    let sources = {};
    try { sources = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) {}
    sources[appid] = source;
    state.cfg.blacklistSources = JSON.stringify(sources);

    let dates = {};
    try { dates = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) {}
    dates[appid] = Date.now();
    state.cfg.blacklistDates = JSON.stringify(dates);

    if (normalizedPrice) {
      state.cfg.blacklistPriceData = JSON.stringify(setBlacklistPriceEntry(
        state.cfg.blacklistPriceData,
        appid,
        normalizedPrice
      ));
    }

    if (fixedVal) {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      fixed[appid] = 1;
      state.cfg.blacklistFixed = JSON.stringify(fixed);
    }

    saveConfig(state.cfg);
  }

  export async function lookupGameName(appid) {
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
        return (titleEl.querySelector(".badge_title_row")?.textContent || titleEl.textContent)
          .replace(/(?:View badge progress|查看徽章进度|View details|查看详情|[\u200B\u200C\u200D\ufeff])/gi, "")
          .trim()
          .replace(/\s*徽章\s*$/, "")
          .trim() || null;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  export function updateBlRow() {
    const add = document.getElementById("stch-bl-add");
    const addF = document.getElementById("stch-bl-add-fixed");
    const del = document.getElementById("stch-bl-del-sel");
    const fix = document.getElementById("stch-bl-fix-sel");
    const unfix = document.getElementById("stch-bl-unfix-sel");
    if (!add) return;

    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const cbs = [...(list ? list.querySelectorAll(".stch-bl-cb:checked") : [])];
    if (listFixed) cbs.push(...listFixed.querySelectorAll(".stch-bl-cb:checked"));

    const anyChecked = cbs.length > 0;
    const hasNormal = cbs.some(cb => {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      return !fixed[cb.dataset.appid];
    });
    const hasFixed = cbs.some(cb => {
      let fixed = {};
      try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
      return !!fixed[cb.dataset.appid];
    });

    add.style.display = (state.blLookupName && !anyChecked) ? "" : "none";
    addF.style.display = (state.blLookupName && !anyChecked) ? "" : "none";
    del.style.display = anyChecked ? "" : "none";
    fix.style.display = (anyChecked && hasNormal) ? "" : "none";
    unfix.style.display = (anyChecked && hasFixed) ? "" : "none";

    if (anyChecked) { del.classList.remove("disabled"); del.classList.add("stch-btn-danger"); }
    if (fix.style.display !== "none") fix.classList.remove("disabled");
    if (unfix.style.display !== "none") unfix.classList.remove("disabled");
    if (anyChecked) document.getElementById("stch-bl-result").textContent = "";
  }

  export function renderBlacklist() {
    const list = document.getElementById("stch-bl-list");
    const listFixed = document.getElementById("stch-bl-list-fixed");
    const countEl = document.getElementById("stch-bl-count");
    if (!list) return;
    enableCheckboxDragSelection(document.getElementById("stch-tab-blacklist"), {
      checkboxSelector: ".stch-bl-cb",
      activationSelector: ".stch-bl-cb, .stch-bl-cb-hd",
      rowSelector: ".stch-bl-row",
    });
    const bl = state.cfg.blacklist ? state.cfg.blacklist.split(",").map(s => s.trim()).filter(Boolean) : [];
    let names = {};
    try { names = JSON.parse(state.cfg.blacklistNames || "{}"); } catch (_) {}
    let sources = {};
    try { sources = JSON.parse(state.cfg.blacklistSources || "{}"); } catch (_) {}
    let dates = {};
    try { dates = JSON.parse(state.cfg.blacklistDates || "{}"); } catch (_) {}
    let fixed = {};
    try { fixed = JSON.parse(state.cfg.blacklistFixed || "{}"); } catch (_) {}
    const priceData = parseBlacklistPriceData(state.cfg.blacklistPriceData);

    const sourceLabels = { "0": "手动", "1": "自动" };
    const normal = bl.filter(a => !fixed[a]);
    const fixedList = bl.filter(a => fixed[a]);

    const formatDays = ts => {
      if (!ts) return "—";
      return String(Math.floor((Date.now() - ts) / 86400000));
    };

    const createHeader = () => {
      const header = document.createElement("div");
      header.className = "stch-bl-row stch-row-header";
      header.appendChild(createTextSpan("stch-bl-id", "游戏ID"));
      header.appendChild(createTextSpan("stch-bl-name", "游戏名"));
      header.appendChild(createTextSpan("stch-bl-fixed-col", ""));
      header.appendChild(createTextSpan("stch-bl-source", "来源"));
      const priceHeader = createTextSpan("stch-bl-price", "单套价格");
      priceHeader.title = "绿色：完整查价且无估算\n黄色：提前预测跳过或价格包含估算";
      header.appendChild(priceHeader);
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
        const priceEntry = priceData[appid];
        const priceCell = createTextSpan(
          `stch-bl-price ${priceEntry?.accuracy === "exact" ? "exact" : priceEntry ? "estimated" : ""}`,
          priceEntry ? formatMoney(priceEntry.priceMinor, priceEntry.currencyId) : "—"
        );
        if (priceEntry) {
          priceCell.title = priceEntry.accuracy === "exact"
            ? "完整查价"
            : priceEntry.reason === "prediction"
              ? "提前预测后跳过"
              : "价格包含中位价或缺价估算";
        }
        row.appendChild(priceCell);
        row.appendChild(createTextSpan("stch-bl-days", dates[appid] ? formatDays(dates[appid]) : "—"));

        const checkboxCell = document.createElement("span");
        checkboxCell.className = "stch-bl-cb-hd";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.className = "stch-bl-cb";
        checkbox.dataset.appid = appid;
        checkbox.title = "按住并上下拖动可连续选择或取消";
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
    if (delBtn) { delBtn.classList.add("disabled"); delBtn.classList.remove("stch-btn-danger"); }
    const cleanupBtn = document.getElementById("stch-bl-cleanup");
    if (cleanupBtn) { cleanupBtn.classList.add("disabled"); cleanupBtn.classList.remove("stch-btn-danger"); }

    const allCbs = [...list.querySelectorAll(".stch-bl-cb")];
    if (listFixed) allCbs.push(...listFixed.querySelectorAll(".stch-bl-cb"));
    allCbs.forEach(cb => {
      cb.addEventListener("change", () => {
        const delBtn2 = document.getElementById("stch-bl-del-sel");
        const anyChecked = [...list.querySelectorAll(".stch-bl-cb:checked")].length > 0
          || (listFixed && [...listFixed.querySelectorAll(".stch-bl-cb:checked")].length > 0);
        if (delBtn2) {
          if (anyChecked) { delBtn2.classList.remove("disabled"); delBtn2.classList.add("stch-btn-danger"); }
          else { delBtn2.classList.add("disabled"); delBtn2.classList.remove("stch-btn-danger"); }
        }
        updateBlRow();
      });
    });

    if (cleanupBtn) {
      const hasExpired = bl.some(a => !fixed[a] && dates[a] && (Date.now() - dates[a] > 7 * 86400000));
      if (hasExpired) { cleanupBtn.classList.remove("disabled"); cleanupBtn.classList.add("stch-btn-danger"); }
    }
  }
