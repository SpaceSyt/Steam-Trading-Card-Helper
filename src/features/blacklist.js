import { state } from "../state.js";

import { saveConfig } from "../config.js";

import { getProfileUrl } from "../utils/steam.js";

import { createTextSpan } from "../utils/dom.js";
import { formatMoney } from "../utils/format.js";
import { normalizeBlacklistPriceEntry } from "../services/blacklist-price.js";
import {
  describeBlacklistStorageError,
  mutateBlacklistStorage,
  readBlacklistStorage,
} from "../services/blacklist-storage.js";
import { enableCheckboxDragSelection } from "../ui/checkbox-drag.js";

function showBlacklistStorageError(result) {
  const message = describeBlacklistStorageError(result);
  if (!message) return "";
  console.warn(`[STCH] ${message}`, result.diagnostics);
  const resultEl = document.getElementById("stch-bl-result");
  if (resultEl) {
    resultEl.dataset.storageError = "true";
    resultEl.textContent = message;
    resultEl.style.color = "#d94126";
  }
  return message;
}

function clearBlacklistStorageError() {
  const resultEl = document.getElementById("stch-bl-result");
  if (!resultEl || resultEl.dataset.storageError !== "true") return;
  delete resultEl.dataset.storageError;
  resultEl.textContent = "";
  resultEl.style.removeProperty("color");
}

function persistBlacklistMutation(mutate) {
  const result = mutateBlacklistStorage(state.cfg, mutate);
  if (!result.ok) {
    showBlacklistStorageError(result);
    return result;
  }
  clearBlacklistStorageError();
  if (result.changed) saveConfig(state.cfg);
  return result;
}

export function getBlacklistSnapshot() {
  return readBlacklistStorage(state.cfg);
}

export function addToBlacklist(appid, name, source, fixedVal = 0, priceEntry = null) {
  const key = String(appid || "");
  if (!/^\d+$/.test(key)) {
    return {
      ok: false,
      changed: false,
      diagnostics: [{ field: "blacklist", label: "AppID", reason: "invalid-appid", appid: key }],
    };
  }
  const normalizedPrice = normalizeBlacklistPriceEntry(priceEntry);
  return persistBlacklistMutation(storage => {
    const existing = storage.appids.includes(key);
    let changed = false;
    if (!existing) {
      storage.appids.push(key);
      storage.names[key] = String(name || "");
      storage.sources[key] = source;
      storage.dates[key] = Date.now();
      changed = true;
    }
    if (fixedVal && !storage.fixed[key]) {
      storage.fixed[key] = 1;
      changed = true;
    }
    if (normalizedPrice) {
      storage.priceData[key] = normalizedPrice;
      changed = true;
    }
    return changed;
  });
}

export function removeBlacklistEntries(appids) {
  const targets = new Set(appids.map(value => String(value || "")).filter(Boolean));
  return persistBlacklistMutation(storage => {
    const next = storage.appids.filter(appid => !targets.has(appid));
    if (next.length === storage.appids.length) return false;
    storage.appids = next;
    for (const appid of targets) {
      delete storage.names[appid];
      delete storage.sources[appid];
      delete storage.dates[appid];
      delete storage.fixed[appid];
      delete storage.priceData[appid];
    }
    return true;
  });
}

export function setBlacklistEntriesFixed(appids, isFixed) {
  const targets = new Set(appids.map(value => String(value || "")).filter(Boolean));
  return persistBlacklistMutation(storage => {
    let changed = false;
    for (const appid of storage.appids) {
      if (!targets.has(appid)) continue;
      if (isFixed && !storage.fixed[appid]) {
        storage.fixed[appid] = 1;
        changed = true;
      } else if (!isFixed && Object.hasOwn(storage.fixed, appid)) {
        delete storage.fixed[appid];
        changed = true;
      }
    }
    return changed;
  });
}

export function findExpiredBlacklistEntries(expiryDays, now = Date.now()) {
  const storage = getBlacklistSnapshot();
  if (!storage.ok) return { ...storage, appids: [] };
  const threshold = Math.max(1, Number(expiryDays) || 1) * 86400000;
  return {
    ok: true,
    diagnostics: [],
    appids: storage.appids.filter(appid => (
      !storage.fixed[appid]
      && storage.dates[appid]
      && now - storage.dates[appid] > threshold
    )),
  };
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

    const storage = getBlacklistSnapshot();
    const writesAllowed = storage.ok;
    if (writesAllowed) clearBlacklistStorageError();
    else showBlacklistStorageError(storage);
    const anyChecked = writesAllowed && cbs.length > 0;
    const fixed = storage.fixed;
    const hasNormal = cbs.some(cb => {
      return !fixed[cb.dataset.appid];
    });
    const hasFixed = cbs.some(cb => {
      return !!fixed[cb.dataset.appid];
    });

    add.style.display = (writesAllowed && state.blLookupName && !anyChecked) ? "" : "none";
    addF.style.display = (writesAllowed && state.blLookupName && !anyChecked) ? "" : "none";
    del.style.display = anyChecked ? "" : "none";
    fix.style.display = (anyChecked && hasNormal) ? "" : "none";
    unfix.style.display = (anyChecked && hasFixed) ? "" : "none";

    del.classList.toggle("disabled", !anyChecked);
    del.classList.toggle("stch-btn-danger", anyChecked);
    fix.classList.toggle("disabled", fix.style.display === "none");
    unfix.classList.toggle("disabled", unfix.style.display === "none");
    if (anyChecked && document.getElementById("stch-bl-result")?.dataset.storageError !== "true") {
      document.getElementById("stch-bl-result").textContent = "";
    }
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
    const storage = getBlacklistSnapshot();
    const {
      appids: bl,
      names,
      sources,
      dates,
      fixed,
      priceData,
    } = storage;
    if (storage.ok) clearBlacklistStorageError();
    else showBlacklistStorageError(storage);

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
      const fragment = document.createDocumentFragment();
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
        checkbox.setAttribute("aria-label", `选择 ${names[appid] || appid}`);
        checkbox.disabled = !storage.ok;
        checkboxCell.appendChild(checkbox);
        row.appendChild(checkboxCell);
        fragment.appendChild(row);
      }
      target.appendChild(fragment);
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
    let updateFrame = 0;
    allCbs.forEach(cb => {
      cb.addEventListener("change", () => {
        if (updateFrame) return;
        updateFrame = requestAnimationFrame(() => {
          updateFrame = 0;
          updateBlRow();
        });
      });
    });

    if (cleanupBtn && storage.ok) {
      const expiryDays = Math.max(
        1,
        Number(state.cfg.blacklistExpiryDays) || 7
      );
      const hasExpired = bl.some(a => (
        !fixed[a] && dates[a] && (Date.now() - dates[a] > expiryDays * 86400000)
      ));
      if (hasExpired) { cleanupBtn.classList.remove("disabled"); cleanupBtn.classList.add("stch-btn-danger"); }
    }
  }
