import { normalizeTabColors, normalizeTabOrder } from "../services/tab-preferences.js";

export function readTabOrder(container) {
  return normalizeTabOrder(
    [...(container?.querySelectorAll?.(".stch-tab[data-tab]") || [])]
      .map(tab => tab.dataset.tab)
  );
}

function syncSettingsSpacer(container) {
  const tabs = [...container.querySelectorAll(".stch-tab[data-tab]")];
  for (const tab of tabs) tab.classList.remove("stch-tab-right");
  const last = tabs.at(-1);
  if (last?.dataset.tab === "settings") last.classList.add("stch-tab-right");
}

export function applyTabOrder(container, value) {
  if (!container) return [];
  const byId = new Map(
    [...container.querySelectorAll(".stch-tab[data-tab]")]
      .map(tab => [tab.dataset.tab, tab])
  );
  const order = normalizeTabOrder(value);
  for (const id of order) {
    const tab = byId.get(id);
    if (tab) container.appendChild(tab);
  }
  syncSettingsSpacer(container);
  return readTabOrder(container);
}

export function applyTabColors(container, value) {
  const colors = normalizeTabColors(value);
  for (const tab of container?.querySelectorAll?.(".stch-tab[data-tab]") || []) {
    const color = colors[tab.dataset.tab] || "";
    tab.classList.toggle("stch-tab-custom-color", !!color);
    if (color) tab.style.setProperty("--stch-tab-label-color", color);
    else tab.style.removeProperty("--stch-tab-label-color");
  }
  return colors;
}

export function enableTabDragReordering(container, onOrderChange) {
  if (!container || container.dataset.dragReordering === "1") return;
  container.dataset.dragReordering = "1";
  let mouseDrag = null;
  let suppressClickUntil = 0;

  const finish = () => {
    if (!mouseDrag) return;
    const { tab, initialOrder, active } = mouseDrag;
    mouseDrag = null;
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", finish);
    window.removeEventListener("blur", finish);
    tab.classList.remove("stch-tab-dragging");
    container.classList.remove("stch-tabs-dragging");
    if (!active) return;
    suppressClickUntil = Date.now() + 250;
    const order = readTabOrder(container);
    syncSettingsSpacer(container);
    if (order.join(",") !== initialOrder) onOrderChange?.(order);
  };

  const move = event => {
    if (!mouseDrag) return;
    if (!mouseDrag.active) {
      const distance = Math.hypot(
        event.clientX - mouseDrag.startX,
        event.clientY - mouseDrag.startY
      );
      if (distance < 5) return;
      mouseDrag.active = true;
      mouseDrag.tab.classList.add("stch-tab-dragging");
      container.classList.add("stch-tabs-dragging");
    }
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.(
      ".stch-tab[data-tab]"
    );
    if (target && target !== mouseDrag.tab && container.contains(target)) {
      const rect = target.getBoundingClientRect();
      const insertBefore = event.clientX < rect.left + rect.width / 2;
      container.insertBefore(
        mouseDrag.tab,
        insertBefore ? target : target.nextSibling
      );
      syncSettingsSpacer(container);
    }
    event.preventDefault();
  };

  container.addEventListener("mousedown", event => {
    if (event.button !== 0) return;
    const tab = event.target instanceof Element
      ? event.target.closest(".stch-tab[data-tab]")
      : null;
    if (!tab || !container.contains(tab)) return;
    finish();
    mouseDrag = {
      tab,
      startX: event.clientX,
      startY: event.clientY,
      initialOrder: readTabOrder(container).join(","),
      active: false,
    };
    document.addEventListener("mousemove", move, { passive: false });
    document.addEventListener("mouseup", finish);
    window.addEventListener("blur", finish);
  });
  container.addEventListener("click", event => {
    if (Date.now() > suppressClickUntil) return;
    const tab = event.target instanceof Element
      ? event.target.closest(".stch-tab[data-tab]")
      : null;
    if (!tab || !container.contains(tab)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
