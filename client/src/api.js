import axios from "axios";
import { translateErrorMessage, getRecoveryHint } from "./errorMessages";

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
    if (err.response?.status === 401) {
      localStorage.removeItem("demo_password");
      localStorage.removeItem("demo_login_at");
      localStorage.removeItem("user_token");
      localStorage.removeItem("user_role");
      localStorage.removeItem("user_display_name");
      localStorage.removeItem("user_id");
      window.location.href = "/";
    }
    // 轉譯錯誤訊息為使用者友善版本，並附上恢復建議
    if (err.response?.data?.detail) {
      const translated = translateErrorMessage(err.response.data.detail);
      err.response.data.detail = translated;
      err.response.data.hint = getRecoveryHint(translated);
    }
    return Promise.reject(err);
  },
);

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
