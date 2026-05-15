import { useState, useEffect } from "react";
import api from "../../api";
import { POLL_GENERAL_MS } from "../../constants";

export default function UsersSummaryPanel() {
  const [summary, setSummary] = useState({ admin: 0, validTokens: 0 });

  useEffect(() => {
    const fetch = async () => {
      try {
        const [usersRes, tokensRes] = await Promise.all([
          api.get("/api/auth/users"),
          api.get("/api/auth/demo-tokens"),
        ]);
        const users = usersRes.data;
        const tokens = tokensRes.data;
        setSummary({
          admin: users.filter(u => u.role === "admin" && u.is_active).length,
          validTokens: tokens.filter(t => t.is_active && !t.expired && !t.used_up).length,
        });
      } catch (_) {}
    };
    fetch();
    const t = setInterval(fetch, POLL_GENERAL_MS);
    return () => clearInterval(t);
  }, []);

  const items = [
    { label: "管理者", value: summary.admin, color: "#f85149" },
    { label: "有效 Token", value: summary.validTokens, color: summary.validTokens > 0 ? "#3fb950" : "#8b949e" },
  ];

  return (
    <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: "5px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#484f58" }}>{label}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
        </div>
      ))}
    </div>
  );
}
