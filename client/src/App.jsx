import { useState } from "react";
import Dashboard from "./Dashboard";
import SOPPage from "./SOPPage";
import ErrorLog from "./ErrorLog";
import AIPage from "./AIPage";
import { API_BASE } from "./api";

const PAGES = [
  { key: "/", label: "儀表板" },
  { key: "/sop", label: "SOP 執行" },
  { key: "/errors", label: "異常看板" },
  { key: "/ai", label: "AI 諮詢" },
];

const SESSION_DURATION = 8 * 60 * 60 * 1000; // 8 小時

function isSessionValid() {
  const pwd = localStorage.getItem("demo_password");
  const loginAt = parseInt(localStorage.getItem("demo_login_at") || "0");
  if (pwd && Date.now() - loginAt < SESSION_DURATION) return true;
  localStorage.removeItem("demo_password");
  localStorage.removeItem("demo_login_at");
  return false;
}

const NavBar = ({ current, onChange, onLogout }) => (
  <nav
    style={{
      padding: "10px 24px",
      backgroundColor: "#161b22",
      display: "flex",
      alignItems: "center",
      gap: "8px",
      borderBottom: "1px solid #30363d",
      zIndex: 1000,
      flexShrink: 0,
    }}
  >
    <span
      style={{
        color: "#58a6ff",
        fontWeight: 700,
        fontSize: 14,
        marginRight: 16,
      }}
    >
      DQA Lab
    </span>
    {PAGES.map(({ key, label }) => {
      const active = current === key;
      return (
        <button
          key={key}
          onClick={() => onChange(key)}
          style={{
            color: active ? "#cdd9e5" : "#8b949e",
            background: active ? "#21262d" : "transparent",
            border: `1px solid ${active ? "#30363d" : "transparent"}`,
            fontWeight: 600,
            fontSize: 14,
            padding: "4px 12px",
            borderRadius: 6,
            cursor: "pointer",
            transition: "all .15s",
          }}
        >
          {label}
        </button>
      );
    })}
    <button
      onClick={onLogout}
      style={{
        marginLeft: "auto",
        color: "#8b949e",
        background: "transparent",
        border: "1px solid #30363d",
        fontWeight: 600,
        fontSize: 12,
        padding: "4px 12px",
        borderRadius: 6,
        cursor: "pointer",
        transition: "all .15s",
      }}
    >
      登出
    </button>
  </nav>
);

function LoginPage({ onLogin }) {
  const [pwdInput, setPwdInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!pwdInput.trim()) return;
    setLoading(true);
    setError("");
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
        onLogin();
      }
    } catch {
      setError("連線失敗，請確認後端是否正常啟動");
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
          minWidth: 320,
        }}
      >
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 22 }}>
          DQA Lab
        </span>
        <span style={{ color: "#8b949e", fontSize: 13 }}>
          KSON AICM Digital Twin
        </span>
        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
          }}
        >
          <input
            type="password"
            placeholder="請輸入存取密碼"
            value={pwdInput}
            onChange={(e) => setPwdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
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
            onClick={handleLogin}
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
              transition: "all .15s",
            }}
          >
            {loading ? "驗證中..." : "進入系統"}
          </button>
        </div>
        {error && (
          <span style={{ color: "#f85149", fontSize: 13 }}>{error}</span>
        )}
        <span style={{ color: "#484f58", fontSize: 11 }}>
          Session 有效期限：8 小時
        </span>
      </div>
    </div>
  );
}

function App() {
  const [authed, setAuthed] = useState(() => isSessionValid());
  const [page, setPage] = useState("/");

  const handleLogout = () => {
    localStorage.removeItem("demo_password");
    localStorage.removeItem("demo_login_at");
    setAuthed(false);
  };

  if (!authed) return <LoginPage onLogin={() => setAuthed(true)} />;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#0d1117",
      }}
    >
      <NavBar current={page} onChange={setPage} onLogout={handleLogout} />
      <main
        style={{
          width: "100%",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        <div
          style={{ display: page === "/" ? "block" : "none", height: "100%" }}
        >
          <Dashboard active={page === "/"} />
        </div>
        <div
          style={{
            display: page === "/sop" ? "block" : "none",
            height: "100%",
          }}
        >
          <SOPPage active={page === "/sop"} />
        </div>
        <div
          style={{
            display: page === "/errors" ? "block" : "none",
            height: "100%",
          }}
        >
          <ErrorLog />
        </div>
        <div
          style={{
            display: page === "/ai" ? "flex" : "none",
            flexDirection: "column",
            height: "100%",
          }}
        >
          <AIPage />
        </div>
      </main>
    </div>
  );
}

export default App;
