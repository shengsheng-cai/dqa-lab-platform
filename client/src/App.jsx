import { useState } from "react";
import Dashboard from "./Dashboard";
import SOPPage from "./SOPPage";
import ErrorLog from "./ErrorLog";
import AIPage from "./AIPage";

const PAGES = [
  { key: "/", label: "儀表板" },
  { key: "/sop", label: "SOP 執行" },
  { key: "/errors", label: "異常看板" },
  { key: "/ai", label: "AI 諮詢" },
];

const NavBar = ({ current, onChange }) => (
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
  </nav>
);

function App() {
  const [page, setPage] = useState("/");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        backgroundColor: "#0d1117",
      }}
    >
      <NavBar current={page} onChange={setPage} />
      <main
        style={{
          width: "100%",
          flex: 1,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* fix: 傳入 active prop，讓各頁面在隱藏時暫停輪詢 */}
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
