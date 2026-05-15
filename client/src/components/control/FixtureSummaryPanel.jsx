export default function FixtureSummaryPanel({ fixtureSummary }) {
  const items = [
    { label: "借出中", value: fixtureSummary.total_loaned ?? "—", color: "#f0a500" },
    { label: "今日到期", value: fixtureSummary.due_today ?? "—", color: (fixtureSummary.due_today ?? 0) > 0 ? "#f0a500" : "#8b949e" },
    { label: "逾期未還", value: fixtureSummary.overdue ?? "—", color: (fixtureSummary.overdue ?? 0) > 0 ? "#f85149" : "#8b949e" },
    { label: "庫存不足", value: fixtureSummary.shortage_count ?? "—", color: (fixtureSummary.shortage_count ?? 0) > 0 ? "#f85149" : "#8b949e" },
  ];
  return (
    <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: "6px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d" }}>
          <div style={{ fontSize: 9, color: "#484f58", marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
        </div>
      ))}
    </div>
  );
}
