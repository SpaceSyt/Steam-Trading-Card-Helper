const initializedRoots = new WeakSet();

/** Enable mouse press-and-drag selection for a delegated checkbox list. */
export function enableCheckboxDragSelection(root, options = {}) {
  if (!root || initializedRoots.has(root)) return;
  initializedRoots.add(root);
  const checkboxSelector = options.checkboxSelector || 'input[type="checkbox"]';
  const activationSelector = options.activationSelector || checkboxSelector;
  const rowSelector = options.rowSelector || "";
  const excludeSelector = options.excludeSelector || "";
  let drag = null;
  let suppressClickUntil = 0;

  const findCheckbox = element => {
    if (!(element instanceof Element) || !root.contains(element)) return null;
    let checkbox = element.closest(checkboxSelector);
    if (!checkbox) {
      const activation = element.closest(activationSelector);
      checkbox = activation?.matches?.(checkboxSelector)
        ? activation
        : activation?.querySelector?.(checkboxSelector);
    }
    if (!checkbox && rowSelector) {
      checkbox = element.closest(rowSelector)?.querySelector?.(checkboxSelector);
    }
    if (
      !checkbox
      || !root.contains(checkbox)
      || checkbox.disabled
      || (excludeSelector && checkbox.matches(excludeSelector))
    ) return null;
    return checkbox;
  };

  const apply = checkbox => {
    if (!drag || drag.visited.has(checkbox)) return;
    drag.visited.add(checkbox);
    if (checkbox.checked === drag.checked) return;
    checkbox.checked = drag.checked;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const finish = () => {
    if (!drag) return;
    drag = null;
    suppressClickUntil = Date.now() + 80;
    root.classList.remove("stch-checkbox-dragging");
  };

  root.addEventListener("pointerdown", event => {
    if (event.button !== 0 || event.pointerType === "touch") return;
    const checkbox = findCheckbox(event.target);
    if (!checkbox) return;
    drag = {
      pointerId: event.pointerId,
      checked: !checkbox.checked,
      visited: new Set(),
    };
    root.classList.add("stch-checkbox-dragging");
    apply(checkbox);
    suppressClickUntil = Date.now() + 80;
    event.preventDefault();
    event.stopPropagation();
  });

  document.addEventListener("pointermove", event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const checkbox = findCheckbox(document.elementFromPoint(event.clientX, event.clientY));
    if (checkbox) apply(checkbox);
    event.preventDefault();
  }, { passive: false });
  document.addEventListener("pointerup", event => {
    if (drag && event.pointerId === drag.pointerId) finish();
  });
  document.addEventListener("pointercancel", event => {
    if (drag && event.pointerId === drag.pointerId) finish();
  });
  window.addEventListener("blur", finish);

  root.addEventListener("click", event => {
    if (Date.now() > suppressClickUntil) return;
    const activation = event.target instanceof Element
      ? event.target.closest(activationSelector)
      : null;
    if (!activation || !root.contains(activation)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}
