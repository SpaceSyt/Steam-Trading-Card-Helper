  export function createStatusController({
    tag,
    logId = null,
    statusId = null,
    progressWrapId = null,
    progressBarId = null,
    progressTextId = null,
  }) {
    let statusTimer = null;

    function log(msg, type = "") {
      const box = logId ? document.getElementById(logId) : null;
      if (!box) { console.log(`[${tag}]`, msg); return; }
      const line = document.createElement("div");
      if (type) line.className = type;
      line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
    }

    function setStatus(text, animate = true) {
      if (!statusId) return;
      const el = document.getElementById(statusId);
      if (!el) return;
      if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
      if (!text) { el.textContent = ""; el.style.display = "none"; return; }
      el.style.display = "";
      el.textContent = text;
      if (!animate) return;
      let dots = 0;
      statusTimer = setInterval(() => {
        dots = (dots + 1) % 4;
        el.textContent = text + " " + ".".repeat(dots);
      }, 500);
    }

    function setProgress(done, total, text = "") {
      if (!progressWrapId) return;
      const wrap = document.getElementById(progressWrapId);
      const bar = document.getElementById(progressBarId);
      const label = document.getElementById(progressTextId);
      if (!wrap || !bar || !label) return;
      wrap.style.display = "";
      const pct = total > 0 ? Math.min(100, done / total * 100) : 0;
      bar.style.width = `${pct}%`;
      label.textContent = text || `${done}/${total}`;
    }

    function hideProgress() {
      if (!progressWrapId) return;
      const wrap = document.getElementById(progressWrapId);
      if (wrap) wrap.style.display = "none";
    }

    return { log, setStatus, setProgress, hideProgress };
  }
