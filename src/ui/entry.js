import { isInventoryPage } from "../utils/steam.js";

import { openModal } from "./modal.js";

  export function getEntryBtn() {
    let btn = document.getElementById("stch-entry-btn");
    if (btn) return btn;
    btn = document.createElement("span");
    btn.id = "stch-entry-btn";
    btn.className = "stch-btn-entry";
    btn.textContent = "Steam Trading Card Helper";
    btn.addEventListener("click", openModal);
    return btn;
  }

  export function placeInventoryEntryBtn(btn) {
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

  export function injectEntryBtn() {
    const btn = getEntryBtn();
    btn.classList.remove("stch-inventory-entry");

    if (isInventoryPage()) {
      return placeInventoryEntryBtn(btn);
    }

    const target = document.querySelector(".profile_xp_block")
      || document.querySelector(".badges_header")
      || document.body;

    if (target.classList.contains("profile_xp_block")) {
      target.appendChild(btn);
    } else {
      target.insertBefore(btn, target.firstChild);
    }
    return true;
  }

  export function observeEntryBtn() {
    if (injectEntryBtn()) return;

    let attempts = 0;
    const observer = new MutationObserver(() => {
      attempts += 1;
      if (injectEntryBtn() || attempts >= 80) {
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => observer.disconnect(), 20000);
  }
