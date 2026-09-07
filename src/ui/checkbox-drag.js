const initializedRoots = new WeakSet();

function enableDragSelection(root, { findItem, isSelected, setSelected, clickTarget, toggleClick }) {
  if (!root || initializedRoots.has(root)) return;
  initializedRoots.add(root);
  let drag = null;
  let suppressClickUntil = 0;
  const apply = item => {
    if (!drag || drag.visited.has(item)) return;
    drag.visited.add(item);
    if (isSelected(item) !== drag.selected) setSelected(item, drag.selected);
  };
  const finish = () => {
    if (!drag) return;
    const { pointerId } = drag;
    drag = null;
    suppressClickUntil = Date.now() + 80;
    root.classList.remove("stch-checkbox-dragging");
    try {
      if (root.hasPointerCapture?.(pointerId)) root.releasePointerCapture(pointerId);
    } catch (_) {}
  };
  root.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const item = findItem(event.target);
    if (!item) return;
    drag = { pointerId: event.pointerId, selected: !isSelected(item), visited: new Set() };
    root.classList.add("stch-checkbox-dragging");
    try { root.setPointerCapture?.(event.pointerId); } catch (_) {}
    apply(item);
    suppressClickUntil = Date.now() + 80;
    event.preventDefault();
    event.stopPropagation();
  });
  root.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const item = findItem(document.elementFromPoint(event.clientX, event.clientY));
    if (item) apply(item);
    event.preventDefault();
  }, { passive: false });
  for (const type of ["pointerup", "pointercancel"]) {
    root.addEventListener(type, event => {
      if (drag && event.pointerId === drag.pointerId) finish();
    });
  }
  root.addEventListener("lostpointercapture", finish);
  root.addEventListener("click", event => {
    const item = clickTarget(event.target);
    if (!item) return;
    if (Date.now() <= suppressClickUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    } else if (toggleClick) {
      setSelected(item, !isSelected(item));
    }
  }, true);
}

export function enableCheckboxDragSelection(root, options = {}) {
  const checkboxSelector = options.checkboxSelector || 'input[type="checkbox"]';
  const activationSelector = options.activationSelector || checkboxSelector;
  const findActivation = element => {
    if (!(element instanceof Element) || !root?.contains(element)) return null;
    return element.closest(activationSelector);
  };
  enableDragSelection(root, {
    findItem: element => {
      if (!(element instanceof Element) || !root.contains(element)) return null;
      let checkbox = element.closest(checkboxSelector);
      if (!checkbox) {
        const activation = findActivation(element);
        checkbox = activation?.matches(checkboxSelector)
          ? activation
          : activation?.querySelector(checkboxSelector);
      }
      if (!checkbox && options.rowSelector) {
        checkbox = element.closest(options.rowSelector)?.querySelector(checkboxSelector);
      }
      return checkbox && root.contains(checkbox) && !checkbox.disabled
        && !(options.excludeSelector && checkbox.matches(options.excludeSelector))
        ? checkbox : null;
    },
    isSelected: checkbox => checkbox.checked,
    setSelected: (checkbox, selected) => {
      checkbox.checked = selected;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    },
    clickTarget: element => {
      const activation = findActivation(element);
      return activation && root.contains(activation) ? activation : null;
    },
  });
}

export function enableTileDragSelection(root, options = {}) {
  const findItem = element => {
    if (!(element instanceof Element) || !root?.contains(element)) return null;
    const item = element.closest(options.itemSelector || ".stch-inv-tile");
    return item && root.contains(item) ? item : null;
  };
  enableDragSelection(root, {
    findItem,
    clickTarget: findItem,
    toggleClick: true,
    isSelected: item => options.isSelected?.(item) === true,
    setSelected: (item, selected) => {
      options.setSelected?.(item, selected);
      item.classList.toggle("selected", selected);
      options.onSelectionChange?.(item, selected);
    },
  });
}
