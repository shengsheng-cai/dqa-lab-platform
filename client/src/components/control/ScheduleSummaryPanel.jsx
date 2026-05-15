import DeviceCard from "./DeviceCard";

export default function ScheduleSummaryPanel({ devices, pendingByDevice, onConfirmCondition, counts = {}, onShowQc, calibrationStatusMap }) {
  const summaryItems = [
    { label: "待審核", value: counts.pending, color: counts.pending > 0 ? "#e3b341" : "#8b949e" },
    { label: "進行中", value: counts.running, color: counts.running > 0 ? "#3fb950" : "#8b949e" },
    { label: "已確認", value: counts.confirmed, color: counts.confirmed > 0 ? "#58a6ff" : "#8b949e" },
    { label: "已完成", value: counts.done, color: counts.done > 0 ? "#bc8cff" : "#8b949e" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflowY: "auto" }}>
      <div style={{ padding: "0 8px 6px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        {summaryItems.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "5px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#484f58" }}>{label}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#484f58", padding: "4px 16px 4px", letterSpacing: 1, flexShrink: 0 }}>設備可用性</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 8px", overflowY: "auto" }}>
        {devices.map(d => (
          <DeviceCard
            key={d.device_id}
            device={d}
            isSelected={false}
            onClick={null}
            pendingSchedule={pendingByDevice?.[d.device_id]}
            onConfirmCondition={onConfirmCondition}
            onShowQc={onShowQc}
            calibrationStatus={calibrationStatusMap?.[d.device_id]?.status}
          />
        ))}
      </div>
    </div>
  );
}
