import { useState, useEffect } from "react";
import api from "../../api";
import { POLL_GENERAL_MS } from "../../constants";
import { C } from "../../styles/theme";
import { describeLoadError } from "../../utils/loadError";

export default function UsersSummaryPanel() {
  const [summary, setSummary] = useState({ admin: 0, validTokens: 0 });
  // 讀不到就不要顯示數字。以前失敗被吞掉，兩個數字停在初值 0，
  // 看起來就像「一個管理者也沒有、一把有效 Token 也沒有」。
  const [loadError, setLoadError] = useState("");

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
        setLoadError("");
      } catch (e) {
        setLoadError(describeLoadError(e));
      }
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
          {loadError ? (
            <span
              // 沒有 role 的 span，aria-label 可以被輔助技術忽略，名稱要掛在有角色的元素上
              role="img"
              style={{ fontSize: 14, fontWeight: 700, color: C.warning }}
              aria-label={`${label}：讀取失敗`}
              title={loadError}
            >
              ⚠ —
            </span>
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
          )}
        </div>
      ))}
    </div>
  );
}
