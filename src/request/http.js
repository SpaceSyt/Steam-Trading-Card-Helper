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
