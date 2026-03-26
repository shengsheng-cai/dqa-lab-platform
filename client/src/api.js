import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

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
    return Promise.reject(err);
  },
);

export default api;
export { API_BASE };
