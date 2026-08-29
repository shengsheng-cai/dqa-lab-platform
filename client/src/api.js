import axios from "axios";
import { translateErrorMessage, getRecoveryHint } from "./errorMessages";
import { clearSession } from "./utils/session";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const userToken = localStorage.getItem("user_token");
  if (userToken) {
    config.headers["X-User-Token"] = userToken;
  } else {
    const pwd = localStorage.getItem("demo_password") || "";
    if (pwd) config.headers["X-Demo-Password"] = pwd;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) handleUnauthorized();
    // 轉譯錯誤訊息為使用者友善版本，並附上恢復建議
    if (err.response?.data?.detail) {
      const translated = translateErrorMessage(err.response.data.detail);
      err.response.data.detail = translated;
      err.response.data.hint = getRecoveryHint(translated);
    }
    return Promise.reject(err);
  },
);

/**
 * Token 失效時：清掉登入痕跡並回登入頁。
 *
 * 跟 buildAuthHeaders 同一個理由放在這裡——走原生 fetch 的呼叫（AI 串流要邊收邊顯示，
 * 用不了 axios）繞過上面的攔截器，請求那一半靠 buildAuthHeaders，回應這一半靠這支。
 * 沒有它的話，Token 過期只會在畫面上留下一句話，人得等下一次背景輪詢才被踢回登入頁。
 */
export function handleUnauthorized() {
  clearSession();
  window.location.href = "/";
}

export function buildAuthHeaders() {
  const userToken = localStorage.getItem("user_token");
  if (userToken) {
    return { "Content-Type": "application/json", "X-User-Token": userToken };
  }
  const pwd = localStorage.getItem("demo_password") || "";
  return {
    "Content-Type": "application/json",
    ...(pwd ? { "X-Demo-Password": pwd } : {}),
  };
}

const WS_BASE = import.meta.env.VITE_WS_BASE_URL
  || (API_BASE === ""
    ? (window.location.protocol === "https:" ? "wss://" : "ws://") + window.location.host
    : API_BASE.replace(/^http/, "ws"));

export default api;
export { API_BASE, WS_BASE };
