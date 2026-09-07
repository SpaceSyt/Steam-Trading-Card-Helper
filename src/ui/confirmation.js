export function showConfirmation(options, renderRows) {
  return new Promise(resolve => {
    const backdrop = document.createElement("div");
    backdrop.id = "stch-order-dialog-backdrop";
    backdrop.innerHTML = `<div class="stch-order-dialog"><h3></h3><div class="stch-order-summary"></div><div class="stch-order-list"></div><div class="stch-order-note"></div><div class="stch-order-dialog-actions"><div class="stch-btn alt" data-action="cancel">取消</div><div class="stch-btn${options.danger ? " stch-btn-danger" : ""}" data-action="confirm"></div></div></div>`;
    backdrop.querySelector("h3").textContent = options.title;
    backdrop.querySelector(".stch-order-summary").innerHTML = options.summaryHtml;
    backdrop.querySelector(".stch-order-note").textContent = options.note || "";
    backdrop.querySelector('[data-action="confirm"]').textContent = options.confirmLabel;
    renderRows(backdrop.querySelector(".stch-order-list"), backdrop);
    const finish = confirmed => {
      backdrop.remove();
      resolve(confirmed);
    };
    backdrop.querySelector('[data-action="cancel"]').addEventListener("click", () => finish(false));
    backdrop.querySelector('[data-action="confirm"]').addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", event => {
      if (event.target === backdrop) finish(false);
    });
    document.body.appendChild(backdrop);
  });
}
