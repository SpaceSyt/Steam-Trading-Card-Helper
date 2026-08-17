import { normalizeTabOrder } from "../services/tab-preferences.js";

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

export function enableTabDragReordering(container, onOrderChange) {
  if (!container || container.dataset.dragReordering === "1") return;
  container.dataset.dragReordering = "1";
  let dragged = null;
  let initialOrder = "";
  let suppressClickUntil = 0;

  for (const tab of container.querySelectorAll(".stch-tab[data-tab]")) {
    tab.draggable = true;
    tab.addEventListener("dragstart", event => {
      dragged = tab;
      initialOrder = readTabOrder(container).join(",");
      tab.classList.add("stch-tab-dragging");
      event.dataTransfer?.setData("text/plain", tab.dataset.tab);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    tab.addEventListener("dragend", () => {
      if (!dragged) return;
      dragged.classList.remove("stch-tab-dragging");
      const order = readTabOrder(container);
      syncSettingsSpacer(container);
      suppressClickUntil = Date.now() + 100;
      if (order.join(",") !== initialOrder) {
        onOrderChange?.(order);
      }
      dragged = null;
      initialOrder = "";
    });
  }

  container.addEventListener("dragover", event => {
    if (!dragged) return;
    const target = event.target instanceof Element
      ? event.target.closest(".stch-tab[data-tab]")
      : null;
    if (!target || target === dragged || !container.contains(target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    const rect = target.getBoundingClientRect();
    const insertBefore = event.clientX < rect.left + rect.width / 2;
    container.insertBefore(dragged, insertBefore ? target : target.nextSibling);
    syncSettingsSpacer(container);
  });
  container.addEventListener("drop", event => {
    if (dragged) event.preventDefault();
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
