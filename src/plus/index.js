if (window.location.pathname.startsWith("/tradeoffer/")) {
  const start = () => import("./trade-offer.js").then(module => module.initTradeOffer());
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
} else {
  void import("../index.js");
}
