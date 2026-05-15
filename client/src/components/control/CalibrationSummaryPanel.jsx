export default function CalibrationSummaryPanel({ calibrationStatusMap }) {
  const counts = { ok: 0, due_soon: 0, overdue: 0, unknown: 0 };
  Object.values(calibrationStatusMap || {}).forEach(v => {
    if (counts[v.status] !== undefined) counts[v.status]++;
    else counts.unknown++;
  });
  const items = [
    { label: "正常", value: counts.ok, color: "#3fb950" },
    { label: "即將到期", value: counts.due_soon, color: counts.due_soon > 0 ? "#e3b341" : "#8b949e" },
    { label: "逾期", value: counts.overdue, color: counts.overdue > 0 ? "#f85149" : "#8b949e" },
    { label: "未知", value: counts.unknown, color: counts.unknown > 0 ? "#484f58" : "#8b949e" },
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
