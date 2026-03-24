import { useState, useEffect } from "react";
import ControlCenter from "./ControlCenter";
import { API_BASE } from "./api";
import api from "./api";

const SESSION_DURATION = 8 * 60 * 60 * 1000;

function isSessionValid() {
  const userToken = localStorage.getItem("user_token");
  if (userToken) return true;
  const pwd = localStorage.getItem("demo_password");
  const loginAt = parseInt(localStorage.getItem("demo_login_at") || "0");
  if (pwd && Date.now() - loginAt < SESSION_DURATION) return true;
  clearSession();
  return false;
}

function clearSession() {
  localStorage.removeItem("demo_password");
  localStorage.removeItem("demo_login_at");
  localStorage.removeItem("user_token");
  localStorage.removeItem("user_role");
  localStorage.removeItem("user_display_name");
}

function getCurrentRole() {
  return localStorage.getItem("user_role") || "guest";
}


function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pwdInput, setPwdInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);

  const handleUserLogin = async () => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    setBackendOffline(false);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.detail || "登入失敗");
      } else {
        localStorage.setItem("user_token", data.token);
        localStorage.setItem("user_role", data.role);
        localStorage.setItem("user_display_name", data.display_name);
        onLogin();
      }
    } catch {
      setBackendOffline(true);
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async () => {
    if (!pwdInput.trim()) return;
    setLoading(true);
    setError("");
    setBackendOffline(false);
    try {
      const res = await fetch(`${API_BASE}/api/devices`, {
        headers: { "X-Demo-Password": pwdInput },
      });
      if (res.status === 401 || res.status === 429) {
        const data = await res.json();
        setError(data.detail || "密碼錯誤");
      } else {
        localStorage.setItem("demo_password", pwdInput);
        localStorage.setItem("demo_login_at", Date.now().toString());
        localStorage.setItem("user_role", "guest");
        onLogin();
      }
    } catch {
      setBackendOffline(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        backgroundColor: "#0d1117",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: "40px 48px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          minWidth: 340,
          maxWidth: 400,
        }}
      >
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 22 }}>
          DQA Lab
        </span>
        <span style={{ color: "#8b949e", fontSize: 13 }}>
          DQA Lab Digital Twin
        </span>

        {backendOffline ? (
          <div
            style={{
              width: "100%",
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                background: "#2d1f00",
                border: "1px solid #f0a50044",
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  color: "#f0a500",
                  fontWeight: 700,
                  fontSize: 13,
                  marginBottom: 6,
                }}
              >
                後端目前 offline
              </div>
              <div style={{ color: "#8b949e", fontSize: 12, lineHeight: 1.6 }}>
                這是 Railway Trial 方案，平常處於休眠狀態。請依以下步驟喚醒：
              </div>
            </div>
            <ol
              style={{
                color: "#8b949e",
                fontSize: 12,
                lineHeight: 2,
                paddingLeft: 20,
                margin: 0,
              }}
            >
              <li>前往 Railway Dashboard</li>
              <li>找到 dqa-lab-digital-twin 專案</li>
              <li>點選 Redeploy</li>
              <li>等待約 30 秒後重新整理此頁</li>
            </ol>
            <a
              href="https://railway.app"
              target="_blank"
              rel="noreferrer"
              style={{
                display: "block",
                textAlign: "center",
                padding: "9px",
                background: "#21262d",
                color: "#58a6ff",
                borderRadius: 6,
                fontSize: 12,
                textDecoration: "none",
                fontWeight: 600,
                border: "1px solid #30363d",
              }}
            >
              前往 Railway Dashboard
            </a>
            <button
              onClick={() => setBackendOffline(false)}
              style={{
                padding: "7px",
                background: "transparent",
                color: "#484f58",
                border: "1px solid #30363d",
                borderRadius: 6,
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              返回登入
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 6, width: "100%" }}>
              <button
                onClick={() => {
                  setMode("user");
                  setError("");
                }}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: "5px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: mode === "user" ? "#21262d" : "transparent",
                  color: mode === "user" ? "#cdd9e5" : "#8b949e",
                  border: `1px solid ${mode === "user" ? "#30363d" : "transparent"}`,
                  fontWeight: mode === "user" ? 600 : 400,
                }}
              >
                帳號登入
              </button>
              <button
                onClick={() => {
                  setMode("demo");
                  setError("");
                }}
                style={{
                  flex: 1,
                  fontSize: 12,
                  padding: "5px",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: mode === "demo" ? "#21262d" : "transparent",
                  color: mode === "demo" ? "#cdd9e5" : "#8b949e",
                  border: `1px solid ${mode === "demo" ? "#30363d" : "transparent"}`,
                  fontWeight: mode === "demo" ? 600 : 400,
                }}
              >
                訪客模式
              </button>
            </div>

            {mode === "user" ? (
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <input
                  type="text"
                  placeholder="帳號"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUserLogin()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid #30363d",
                    background: "#0d1117",
                    color: "#cdd9e5",
                    fontSize: 14,
                    width: "100%",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
                <input
                  type="password"
                  placeholder="密碼"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleUserLogin()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid #30363d",
                    background: "#0d1117",
                    color: "#cdd9e5",
                    fontSize: 14,
                    width: "100%",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleUserLogin}
                  disabled={loading}
                  style={{
                    padding: "10px",
                    borderRadius: 6,
                    background: loading ? "#21262d" : "#238636",
                    color: loading ? "#484f58" : "#fff",
                    border: "none",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {loading ? "驗證中..." : "登入"}
                </button>
              </div>
            ) : (
              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <input
                  type="password"
                  placeholder="請輸入存取密碼"
                  value={pwdInput}
                  onChange={(e) => setPwdInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleDemoLogin()}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 6,
                    border: "1px solid #30363d",
                    background: "#0d1117",
                    color: "#cdd9e5",
                    fontSize: 14,
                    width: "100%",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleDemoLogin}
                  disabled={loading}
                  style={{
                    padding: "10px",
                    borderRadius: 6,
                    background: loading ? "#21262d" : "#238636",
                    color: loading ? "#484f58" : "#fff",
                    border: "none",
                    cursor: loading ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {loading ? "驗證中..." : "進入系統"}
                </button>
                <span style={{ color: "#484f58", fontSize: 11 }}>
                  Session 有效期限：8 小時
                </span>
              </div>
            )}
            {error && (
              <span style={{ color: "#f85149", fontSize: 13 }}>{error}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => isSessionValid());
  const [role, setRole] = useState(getCurrentRole);
  const [displayName, setDisplayName] = useState(
    () => localStorage.getItem("user_display_name") || ""
  );

  // 有 token 時，從後端驗證並刷新 role（防止 localStorage 被竄改）
  useEffect(() => {
    if (!authed) return;
    const token = localStorage.getItem("user_token");
    if (!token) return;
    api.get("/api/auth/me").then((res) => {
      const { role: r, display_name: dn } = res.data;
      localStorage.setItem("user_role", r);
      localStorage.setItem("user_display_name", dn);
      setRole(r);
      setDisplayName(dn);
    }).catch(() => {});
  }, [authed]);

  const handleLogout = async () => {
    const token = localStorage.getItem("user_token");
    if (token) {
      try { await api.post("/api/auth/logout"); } catch (_) {}
    }
    clearSession();
    setAuthed(false);
  };

  const handleLogin = () => {
    setRole(getCurrentRole());
    setDisplayName(localStorage.getItem("user_display_name") || "");
    setAuthed(true);
  };
  if (!authed) return <LoginPage onLogin={handleLogin} />;

  return (
    <div style={{ height: "100vh", backgroundColor: "#0d1117", overflow: "hidden" }}>
      <ControlCenter role={role} displayName={displayName} onLogout={handleLogout} />
    </div>
  );
}

export default App;
