const unsafeWindow = (typeof globalThis.unsafeWindow !== "undefined") ? globalThis.unsafeWindow : window;
const $J = unsafeWindow.jQuery || unsafeWindow.$ || window.jQuery || window.$ || null;
export { unsafeWindow, $J };
