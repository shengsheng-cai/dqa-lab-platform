import { UnknownStat } from "../ListState";

/**
 * 左欄的人員摘要。資料由 ControlCenter 抓、寫入後也由它刷新——這裡只負責顯示。
 *
 * 以前是這個面板自己抓、自己輪詢，所以在人員管理頁生成或撤銷 Token、停用或刪除人員後，
 * 表格已經更新、toast 也說成功了，左欄的數字卻要等最多 60 秒才跟上。
 */
export default function UsersSummaryPanel({ summary, loadError }) {
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
            <UnknownStat label={label} error={loadError} style={{ fontSize: 14, fontWeight: 700 }} />
          ) : (
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
          )}
        </div>
      ))}
    </div>
  );
}
