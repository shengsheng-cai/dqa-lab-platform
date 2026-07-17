import { useState, useEffect } from "react";
import ControlCenter from "./ControlCenter";
import { ToastProvider } from "./components/Toast";
import { API_BASE } from "./api";
import api from "./api";
import { SESSION_DURATION } from "./constants";

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
  const [demoHint, setDemoHint] = useState(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/guest-hint`)
      .then((r) => r.json())
      .then((d) => { if (d.token) setDemoHint(d.token); })
      .catch(() => {});
  }, []);

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

  const handleDemoLogin = async (tokenOverride = null) => {
    const token = tokenOverride ?? pwdInput;
    if (!token.trim()) return;
    setLoading(true);
    setError("");
    setBackendOffline(false);
    try {
      const res = await fetch(`${API_BASE}/api/auth/demo-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.status === 401 || res.status === 429) {
        const data = await res.json();
        setError(data.detail || "Token 無效");
      } else {
        const keysToRemove = [
          "user_token",
          "user_role",
          "user_display_name",
          "dqa_ai_chats_v2",
        ];
        keysToRemove.forEach(k => localStorage.removeItem(k));

        localStorage.setItem("demo_password", token);
        localStorage.setItem("demo_login_at", Date.now().toString());
        localStorage.setItem("user_role", "guest");

        Promise.resolve().then(onLogin);
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
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 28, letterSpacing: -0.5 }}>
          DQA Lab
        </span>
        <span style={{ color: "#6e7681", fontSize: 12, marginTop: -6 }}>
          環境測試實驗室管理平台
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
                請在專案根目錄執行 <code>make dev</code> 啟動後端。
              </div>
            </div>
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
                    transition: "border-color .15s",
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
                    transition: "border-color .15s",
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
                {demoHint && (
                  <button
                    onClick={() => handleDemoLogin(demoHint)}
                    style={{
                      padding: "10px",
                      borderRadius: 6,
                      background: "#1f6feb",
                      color: "#fff",
                      border: "none",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    🚀 一鍵訪客體驗
                  </button>
                )}
                <input
                  type="text"
                  placeholder="請輸入訪客 Token（8 碼）"
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
                    transition: "border-color .15s",
                  }}
                />
                <button
                  onClick={() => handleDemoLogin()}
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
                  Token 由管理者生成，Session 有效期限：8 小時
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
      try { await api.post("/api/auth/logout"); } catch { /* ignore */ }
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
    <ToastProvider>
      <div style={{ height: "100vh", backgroundColor: "#0d1117", overflow: "hidden" }}>
        <ControlCenter role={role} displayName={displayName} onLogout={handleLogout} />
      </div>
    </ToastProvider>
  );
}

export default App;
