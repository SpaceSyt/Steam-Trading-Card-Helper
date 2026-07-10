  export class RequestQueue {
    constructor(
      interval = 330,
      batchSize = 20,
      batchPause = 53000,
      state = null,
      onStatus = null,
      onLog = null,
      otherInterval = 0
    ) {
      this.interval = interval;
      this.batchSize = batchSize;
      this.batchPause = batchPause;
      this.otherInterval = otherInterval;
      this.state = state;
      this.onStatus = onStatus;
      this.onLog = onLog;
      this.queue = [];
      this.running = false;
      this.stopped = false;
      this._consecutive429 = 0;
      this._429Warned = false;
      this._reqCount = 0;
    }

    async fetch(url, options = {}) {
      return new Promise((resolve, reject) => {
        if (this.stopped) { reject({ status: 0, error: "stopped" }); return; }
        this.queue.push({ url, options, resolve, reject });
        this._run();
      });
    }

    _cfgNumber(key, fallback, min = 0) {
      const value = Number(this.state?.cfg?.[key]);
      if (!Number.isFinite(value)) return fallback;
      return Math.max(min, value);
    }

    _priceInterval() {
      return this._cfgNumber("requestInterval", this.interval, 0);
    }

    _otherRequestInterval() {
      return this._cfgNumber("scanInterval", this.otherInterval, 0);
    }

    _batchSizeLimit() {
      return Math.max(1, Math.floor(this._cfgNumber("batchSize", this.batchSize, 1)));
    }

    _batchPauseMs() {
      return this._cfgNumber("batchPause", this.batchPause, 0);
    }

    _sleepShouldStop() {
      return this.stopped
        || this.state?.stopRequested
        || this.state?.skipCurrent
        || this.state?.craftStopRequested
        || this.state?.surplusStopRequested
        || this.state?.seasonalStopRequested
        || this.state?.grindStopRequested;
    }

    async _sleep(ms) {
      const endAt = Date.now() + Math.max(0, ms);
      while (Date.now() < endAt) {
        if (this._sleepShouldStop()) {
          return false;
        }
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(250, endAt - Date.now()))
        );
      }
      return true;
    }

    async _sleepWithCountdown(ms, labelFactory) {
      const endAt = Date.now() + Math.max(0, ms);
      let lastSeconds = null;
      while (Date.now() < endAt) {
        if (this._sleepShouldStop()) {
          return false;
        }
        const remainingMs = Math.max(0, endAt - Date.now());
        const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
        if (seconds !== lastSeconds && this.onStatus) {
          lastSeconds = seconds;
          this.onStatus(labelFactory(seconds), false);
        }
        await new Promise(resolve =>
          setTimeout(resolve, Math.min(250, remainingMs))
        );
      }
      return true;
    }

    async _run() {
      if (this.running) return;
      this.running = true;
      try {
        while (this.queue.length > 0 && !this.stopped) {
          const job = this.queue.shift();
          const isPriceOverview = job.url.includes("/market/priceoverview/");
          const requestStartedAt = Date.now();
          try {
            const res = await window.fetch(job.url, {
              credentials: "include",
              ...job.options,
            });

            if (res.status === 429) {
              this._consecutive429++;
              this._reqCount = 0;
              const pauseMs = this._batchPauseMs();
              if (this._consecutive429 >= 3 && !this._429Warned && this.onLog) {
                this._429Warned = true;
                this.onLog("Steam 可能已临时限制此 IP 访问价格 API；建议等待至少半小时或者更换 IP 后再继续", "warn-ip");
              }
              await this._sleepWithCountdown(
                pauseMs,
                seconds => `429 限流冷却中 (第${this._consecutive429}次, ${seconds}s)`
              );
              if (this.state?.skipCurrent) {
                job.reject({ status: 429, error: "skipped by user" });
                continue;
              }
              if (
                this.state?.stopRequested
                || this.state?.craftStopRequested
                || this.state?.surplusStopRequested
                || this.state?.seasonalStopRequested
                || this.state?.grindStopRequested
                || this.stopped
              ) {
                job.reject({ status: 0, error: "stopped" });
                continue;
              }
              this.queue.unshift(job);
              continue;
            }
            this._consecutive429 = 0;
            if (isPriceOverview && this.onStatus) {
              this.onStatus("扫描卡牌价格中", true);
            }

            if (res.status >= 500) {
              await this._sleep(this._priceInterval() * 3);
            }

            const text = await res.text();
            let data = null;
            try { data = JSON.parse(text); } catch (_) {}

            if (!res.ok) {
              job.reject({ status: res.status, text, data });
            } else {
              job.resolve({ status: res.status, text, data });
            }
          } catch (e) {
            job.reject({ error: e?.message || String(e) });
          }

          // Only priceoverview calls count toward the proactive market API cooldown.
          if (isPriceOverview) {
            this._reqCount++;
            if (this._reqCount >= this._batchSizeLimit()) {
              this._reqCount = 0;
              const pauseMs = this._batchPauseMs();
              await this._sleepWithCountdown(
                pauseMs,
                seconds => `主动冷却中 (${seconds}s)`
              );
              continue;
            }
          }

          const targetInterval = isPriceOverview
            ? this._priceInterval()
            : this._otherRequestInterval();
          const elapsed = Date.now() - requestStartedAt;
          await this._sleep(Math.max(0, targetInterval - elapsed));
        }
      } finally {
        this.running = false;
      }

      if (this.queue.length > 0 && !this.stopped) this._run();
    }

    stop() {
      this.stopped = true;
      // reject all pending jobs so their promises resolve and loops can exit
      for (const job of this.queue) {
        if (job.reject) job.reject({ status: 0, error: "stopped" });
      }
      this.queue = [];
    }
    clear() { this.queue = []; }
  }
