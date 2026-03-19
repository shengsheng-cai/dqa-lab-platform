// client/src/api.js
import axios from "axios";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const api = axios.create({
  baseURL: API_BASE,
});

api.interceptors.request.use((config) => {
  const pwd = localStorage.getItem("demo_password") || "";
  if (pwd) config.headers["X-Demo-Password"] = pwd;
  return config;
});

export default api;
export { API_BASE };
