  export async function stchRequestText(url) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          timeout: 20000,
          anonymous: false,
          withCredentials: true,
          onload: response => {
            if (response.status >= 200 && response.status < 300) {
              resolve(response.responseText || "");
            } else {
              reject(new Error(`HTTP ${response.status}`));
            }
          },
          onerror: () => reject(new Error("网络请求失败")),
          ontimeout: () => reject(new Error("网络请求超时")),
        });
      });
    }

    const response = await window.fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  export async function stchRequestJson(url) {
    const text = await stchRequestText(url);
    try {
      return JSON.parse(text || "{}");
    } catch (_) {
      throw new Error("返回内容不是 JSON");
    }
  }

  export function requestExternalText({ method = "GET", url, headers = {}, data = null, timeout = 20000 }) {
    if (typeof GM_xmlhttpRequest === "function") {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          headers,
          data,
          timeout,
          anonymous: false,
          responseType: "text",
          onload: response => resolve({
            status: response.status || 0,
            text: response.responseText || "",
            finalUrl: response.finalUrl || url,
          }),
          onerror: response => {
            const error = new Error(`网络错误 (${response?.status || "unknown"})`);
            error.status = response?.status || 0;
            reject(error);
          },
          ontimeout: () => {
            const error = new Error("请求超时");
            error.uncertain = true;
            reject(error);
          },
        });
      });
    }

    return window.fetch(url, {
      method,
      credentials: "include",
      headers,
      body: data,
    }).then(async response => ({
      status: response.status,
      text: await response.text(),
      finalUrl: response.url || url,
    }));
  }

  export function buildHttpError(status, message) {
    const error = new Error(message || `请求失败 (${status})`);
    error.status = status;
    if (status === 429) {
      error.message = "Steam 返回 429";
    }
    return error;
  }

  export function appendQuery(url, params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value == null || value === "") return;
      query.set(key, String(value));
    });
    const qs = query.toString();
    return qs ? `${url}?${qs}` : url;
  }
