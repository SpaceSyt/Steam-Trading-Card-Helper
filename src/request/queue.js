const CANCELLED = Symbol("request-queue-cancelled");

const DEFAULT_POLICY = Object.freeze({
  name: "default",
  applyInterval: false,
  applyBatchCooldown: false,
  retry429: false,
});

const PRICEOVERVIEW_POLICY = Object.freeze({
  name: "priceoverview",
  applyInterval: true,
  applyBatchCooldown: true,
  retry429: true,
});

export const REQUEST_POLICIES = Object.freeze({
  default: DEFAULT_POLICY,
  priceoverview: PRICEOVERVIEW_POLICY,
});

function stoppedError() {
  return { status: 0, error: "stopped" };
}

function firstDefined(...values) {
  return values.find(value => value !== undefined);
}

export class RequestQueue {
  constructor(
    interval = 330,
    batchSize = 20,
    batchPause = 53000,
    state = null,
    onStatus = null,
    onLog = null,
    dependencies = {}
  ) {
    this.interval = interval;
    this.batchSize = batchSize;
    this.batchPause = batchPause;
    this.state = state;
    this.onStatus = onStatus;
    this.onLog = onLog;
    this.queue = [];
    this.running = false;
    this.cooling = false;
    this.stopped = false;
    this._consecutive429 = 0;
    this._429Warned = false;
    this._reqCount = 0;
    this._currentJob = null;
    this._currentController = null;
    this._waiters = new Set();

    const runtime = dependencies && typeof dependencies === "object"
      ? dependencies
      : {};
    const timerOption = runtime.timer || runtime.timers || runtime.clock || {};
    const timer = typeof timerOption === "function"
      ? { setTimeout: timerOption }
      : timerOption;
    const setTimeoutImpl = runtime.setTimeout || timer.setTimeout || globalThis.setTimeout;
    const clearTimeoutImpl = runtime.clearTimeout || timer.clearTimeout || globalThis.clearTimeout;
    const setTimeoutContext = runtime.setTimeout ? runtime : (timer.setTimeout ? timer : globalThis);
    const clearTimeoutContext = runtime.clearTimeout
      ? runtime
      : (timer.clearTimeout ? timer : globalThis);

    this._setTimeout = (...args) => setTimeoutImpl.apply(setTimeoutContext, args);
    this._clearTimeout = (...args) => clearTimeoutImpl.apply(clearTimeoutContext, args);
    this._now = () => {
      const nowValue = runtime.now ?? timer.now ?? Date.now;
      const nowContext = runtime.now != null ? runtime : (timer.now != null ? timer : Date);
      return Number(typeof nowValue === "function" ? nowValue.call(nowContext) : nowValue);
    };
    this._fetchImpl = runtime.fetch || runtime.fetchImpl || null;
    this._stopPredicate = runtime.stopPredicate || runtime.shouldStop || null;
    this._AbortController = Object.prototype.hasOwnProperty.call(runtime, "AbortController")
      ? runtime.AbortController
      : (globalThis.AbortController || null);
  }

  async fetch(url, options = {}) {
    if (this.stopped) throw stoppedError();
    if (this._externalStopRequested()) {
      this.stop();
      throw stoppedError();
    }

    const {
      policy: policyOption,
      requestPolicy,
      endpointPolicy,
      ...fetchOptions
    } = options || {};
    const policyOverride = firstDefined(policyOption, requestPolicy, endpointPolicy);
    const policy = this._resolvePolicy(url, policyOverride);

    return new Promise((resolve, reject) => {
      if (this.stopped) {
        reject(stoppedError());
        return;
      }
      this.queue.push({
        url,
        fetchOptions,
        policy,
        resolve,
        reject,
        settled: false,
        cancelActive: null,
      });
      void this._run();
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

  _batchSizeLimit() {
    return Math.max(1, Math.floor(this._cfgNumber("batchSize", this.batchSize, 1)));
  }

  _batchPauseMs() {
    return this._cfgNumber("batchPause", this.batchPause, 0);
  }

  _urlText(url) {
    if (typeof url === "string") return url;
    if (url && typeof url.url === "string") return url.url;
    return String(url || "");
  }

  _detectedPolicy(url) {
    return /\/market\/priceoverview(?:\/|[?#]|$)/i.test(this._urlText(url))
      ? PRICEOVERVIEW_POLICY
      : DEFAULT_POLICY;
  }

  _namedPolicy(name, detectedPolicy) {
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized || normalized === "auto") return detectedPolicy;
    if (normalized === "priceoverview" || normalized === "price-overview") {
      return PRICEOVERVIEW_POLICY;
    }
    if (
      normalized === "default"
      || normalized === "ordinary"
      || normalized === "normal"
      || normalized === "none"
    ) {
      return DEFAULT_POLICY;
    }
    throw new TypeError(`Unknown request policy: ${name}`);
  }

  _resolvePolicy(url, override) {
    const detected = this._detectedPolicy(url);
    if (override == null || override === "auto") return detected;
    if (typeof override === "string") return this._namedPolicy(override, detected);
    if (typeof override === "boolean") {
      return override ? PRICEOVERVIEW_POLICY : DEFAULT_POLICY;
    }
    if (typeof override !== "object") {
      throw new TypeError("Request policy must be a policy name or object");
    }

    const baseName = firstDefined(override.base, override.name, override.type);
    const base = baseName == null ? detected : this._namedPolicy(baseName, detected);
    const intervalOption = firstDefined(
      override.applyInterval,
      override.interval,
      override.pace
    );
    const batchOption = firstDefined(
      override.applyBatchCooldown,
      override.batchCooldown,
      override.proactiveCooldown,
      override.countTowardBatch
    );
    const retryOption = firstDefined(override.retry429, override.retryOn429);
    const numericInterval = typeof intervalOption === "number" && Number.isFinite(intervalOption)
      ? Math.max(0, intervalOption)
      : null;

    return {
      name: base.name,
      applyInterval: intervalOption === undefined
        ? base.applyInterval
        : (numericInterval != null || Boolean(intervalOption)),
      applyBatchCooldown: batchOption === undefined
        ? base.applyBatchCooldown
        : Boolean(batchOption),
      retry429: retryOption === undefined ? base.retry429 : Boolean(retryOption),
      intervalMs: numericInterval ?? this._optionalNumber(override.intervalMs, 0),
      batchSize: this._optionalNumber(override.batchSize, 1, true),
      batchPauseMs: this._optionalNumber(
        firstDefined(override.batchPauseMs, override.batchPause),
        0
      ),
    };
  }

  _optionalNumber(value, min, integer = false) {
    if (value == null || value === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    const normalized = Math.max(min, number);
    return integer ? Math.floor(normalized) : normalized;
  }

  _policyInterval(policy) {
    return policy.intervalMs == null ? this._priceInterval() : policy.intervalMs;
  }

  _policyBatchSize(policy) {
    return policy.batchSize == null ? this._batchSizeLimit() : policy.batchSize;
  }

  _policyBatchPause(policy) {
    return policy.batchPauseMs == null ? this._batchPauseMs() : policy.batchPauseMs;
  }

  _defaultStateStopRequested() {
    return Boolean(
      this.state?.stopRequested
      || this.state?.craftStopRequested
      || this.state?.surplusStopRequested
      || this.state?.grindStopRequested
    );
  }

  _externalStopRequested() {
    if (!this._stopPredicate) return this._defaultStateStopRequested();
    return Boolean(this._stopPredicate(this.state, this));
  }

  _sleepShouldStop() {
    return this.stopped
      || this.state?.skipCurrent
      || this._externalStopRequested();
  }

  _wait(ms) {
    const delay = Math.max(0, Number(ms) || 0);
    if (delay === 0) return Promise.resolve(!this._sleepShouldStop());

    return new Promise((resolve, reject) => {
      const waiter = {
        id: null,
        settled: false,
        finish: completed => {
          if (waiter.settled) return;
          waiter.settled = true;
          this._waiters.delete(waiter);
          if (!completed && waiter.id != null) {
            try { this._clearTimeout(waiter.id); } catch (_) {}
          }
          resolve(completed);
        },
      };

      this._waiters.add(waiter);
      try {
        waiter.id = this._setTimeout(() => waiter.finish(true), delay);
      } catch (error) {
        this._waiters.delete(waiter);
        waiter.settled = true;
        reject(error);
        return;
      }

      if (this._sleepShouldStop()) waiter.finish(false);
    });
  }

  _interruptWaits() {
    for (const waiter of [...this._waiters]) waiter.finish(false);
  }

  async _sleep(ms) {
    const endAt = this._now() + Math.max(0, Number(ms) || 0);
    while (this._now() < endAt) {
      if (this._sleepShouldStop()) return false;
      const remainingMs = Math.max(0, endAt - this._now());
      if (!await this._wait(Math.min(250, remainingMs))) return false;
    }
    return !this._sleepShouldStop();
  }

  async _sleepWithCountdown(ms, labelFactory) {
    const duration = Math.max(0, Number(ms) || 0);
    if (duration === 0 || this._sleepShouldStop()) {
      this.cooling = false;
      return !this._sleepShouldStop();
    }

    const endAt = this._now() + duration;
    let lastSeconds = null;
    this.cooling = true;
    try {
      while (this._now() < endAt) {
        if (this._sleepShouldStop()) return false;
        const remainingMs = Math.max(0, endAt - this._now());
        const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
        if (seconds !== lastSeconds && this.onStatus && !this._sleepShouldStop()) {
          lastSeconds = seconds;
          this.onStatus(labelFactory(seconds), false);
        }
        if (this._sleepShouldStop()) return false;
        if (!await this._wait(Math.min(250, remainingMs))) return false;
      }
      return !this._sleepShouldStop();
    } finally {
      this.cooling = false;
    }
  }

  _resolveJob(job, value) {
    if (job.settled) return;
    job.settled = true;
    job.resolve(value);
  }

  _rejectJob(job, reason) {
    if (job.settled) return;
    job.settled = true;
    job.reject(reason);
  }

  _callFetch(url, options) {
    if (this._fetchImpl) return this._fetchImpl(url, options);
    const host = typeof window !== "undefined" ? window : globalThis;
    if (typeof host.fetch !== "function") {
      throw new Error("fetch is not available");
    }
    return host.fetch(url, options);
  }

  _prepareFetch(job) {
    const options = {
      credentials: "include",
      ...job.fetchOptions,
    };
    let controller = null;
    let removeExternalAbort = null;

    if (typeof this._AbortController === "function") {
      try {
        controller = new this._AbortController();
        const externalSignal = options.signal;
        if (externalSignal && externalSignal !== controller.signal) {
          const forwardAbort = () => {
            try { controller.abort(externalSignal.reason); } catch (_) {
              try { controller.abort(); } catch (_) {}
            }
          };
          if (externalSignal.aborted) {
            forwardAbort();
          } else if (typeof externalSignal.addEventListener === "function") {
            externalSignal.addEventListener("abort", forwardAbort, { once: true });
            removeExternalAbort = () => {
              externalSignal.removeEventListener?.("abort", forwardAbort);
            };
          }
        }
        options.signal = controller.signal;
      } catch (_) {
        controller = null;
      }
    }

    this._currentController = controller;
    return {
      options,
      controller,
      cleanup: () => {
        removeExternalAbort?.();
        if (this._currentController === controller) this._currentController = null;
      },
    };
  }

  async _awaitActive(job, operation) {
    const operationResult = Promise.resolve()
      .then(() => {
        if (this.stopped) throw CANCELLED;
        return operation();
      })
      .then(
        value => ({ value }),
        error => ({ error })
      );
    const result = await Promise.race([operationResult, job.cancelPromise]);
    if (result === CANCELLED) throw CANCELLED;
    if (Object.prototype.hasOwnProperty.call(result, "error")) throw result.error;
    return result.value;
  }

  async _attempt(job) {
    const requestStartedAt = this._now();
    let attempted = false;
    let cancelActive;
    job.cancelPromise = new Promise(resolve => {
      cancelActive = () => resolve(CANCELLED);
    });
    job.cancelActive = cancelActive;
    this._currentJob = job;
    const prepared = this._prepareFetch(job);

    try {
      if (this.stopped) throw CANCELLED;
      attempted = true;
      const response = await this._awaitActive(
        job,
        () => this._callFetch(job.url, prepared.options)
      );
      if (this.stopped) throw CANCELLED;

      if (response.status === 429 && job.policy.retry429) {
        this._consecutive429++;
        this._reqCount = 0;
        const pauseMs = this._policyBatchPause(job.policy);
        if (this._consecutive429 >= 3 && !this._429Warned && this.onLog) {
          this._429Warned = true;
          this.onLog(
            "Steam 可能已临时限制此 IP 访问价格 API；建议等待至少半小时或者更换 IP 后再继续",
            "warn-ip"
          );
        }
        const completed = await this._sleepWithCountdown(
          pauseMs,
          seconds => `429 限流冷却中 (第${this._consecutive429}次, ${seconds}s)`
        );
        if (!completed) {
          if (this.state?.skipCurrent) {
            this._rejectJob(job, { status: 429, error: "skipped by user" });
          } else {
            if (!this.stopped) this.stop();
            this._rejectJob(job, stoppedError());
          }
          return { attempted: false, retry: false, requestStartedAt };
        }
        if (this.state?.skipCurrent) {
          this._rejectJob(job, { status: 429, error: "skipped by user" });
          return { attempted: false, retry: false, requestStartedAt };
        }
        if (this.stopped || this._externalStopRequested()) {
          if (!this.stopped) this.stop();
          this._rejectJob(job, stoppedError());
          return { attempted: false, retry: false, requestStartedAt };
        }
        return { attempted: false, retry: true, requestStartedAt };
      }

      if (job.policy.retry429) this._consecutive429 = 0;
      if (
        job.policy.name === "priceoverview"
        && this.onStatus
        && !this._sleepShouldStop()
      ) {
        this.onStatus("扫描卡牌价格中", true);
      }

      if (response.status >= 500 && job.policy.applyInterval) {
        await this._sleep(this._policyInterval(job.policy) * 3);
        if (this._externalStopRequested() && !this.stopped) this.stop();
        if (this.stopped) throw CANCELLED;
      }

      const text = await this._awaitActive(job, () => response.text());
      if (this.stopped) throw CANCELLED;
      let data = null;
      try { data = JSON.parse(text); } catch (_) {}

      if (!response.ok) {
        this._rejectJob(job, { status: response.status, text, data });
      } else {
        this._resolveJob(job, { status: response.status, text, data });
      }
      return { attempted, retry: false, requestStartedAt };
    } catch (error) {
      if (error === CANCELLED || this.stopped) {
        this._rejectJob(job, stoppedError());
        return { attempted: false, retry: false, requestStartedAt };
      }
      this._rejectJob(job, { error: error?.message || String(error) });
      return { attempted, retry: false, requestStartedAt };
    } finally {
      prepared.cleanup();
      job.cancelActive = null;
      job.cancelPromise = null;
      if (this._currentJob === job) this._currentJob = null;
    }
  }

  async _applyPolicy(job, requestStartedAt) {
    if (this.stopped) return;
    const policy = job.policy;

    if (policy.applyBatchCooldown) {
      this._reqCount++;
      if (this._reqCount >= this._policyBatchSize(policy)) {
        this._reqCount = 0;
        if (this.stopped) return;
        await this._sleepWithCountdown(
          this._policyBatchPause(policy),
          seconds => `主动冷却中 (${seconds}s)`
        );
        if (this._externalStopRequested() && !this.stopped) this.stop();
        return;
      }
    }

    if (policy.applyInterval && !this.stopped) {
      const elapsed = this._now() - requestStartedAt;
      await this._sleep(Math.max(0, this._policyInterval(policy) - elapsed));
      if (this._externalStopRequested() && !this.stopped) this.stop();
    }
  }

  async _run() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.queue.length > 0 && !this.stopped) {
        if (this._externalStopRequested()) {
          this.stop();
          break;
        }

        const job = this.queue.shift();
        const result = await this._attempt(job);
        if (this.stopped) {
          this._rejectJob(job, stoppedError());
          break;
        }
        if (result.retry && !job.settled) {
          this.queue.unshift(job);
          continue;
        }
        if (result.attempted) {
          await this._applyPolicy(job, result.requestStartedAt);
        }
      }
    } finally {
      this.cooling = false;
      this._currentJob = null;
      this._currentController = null;
      if (this.stopped) {
        this._reqCount = 0;
        this._consecutive429 = 0;
        this._429Warned = false;
      }
      this.running = false;
    }

    if (this.queue.length > 0 && !this.stopped) void this._run();
  }

  stop() {
    this.stopped = true;
    this.cooling = false;
    this._reqCount = 0;
    this._consecutive429 = 0;
    this._429Warned = false;

    this._interruptWaits();

    const currentJob = this._currentJob;
    if (currentJob) {
      this._rejectJob(currentJob, stoppedError());
      currentJob.cancelActive?.();
    }
    if (this._currentController) {
      try { this._currentController.abort(); } catch (_) {}
    }

    for (const job of this.queue) this._rejectJob(job, stoppedError());
    this.queue = [];
  }

  clear() {
    this.queue = [];
  }
}
