import DeviceCard from "./DeviceCard";
import { C } from "../../styles/theme";

export default function ScheduleSummaryPanel({ devices, pendingByDevice, onConfirmCondition, counts = {}, onShowQc, calibrationStatusMap }) {
  const summaryItems = [
    { label: "待審核", value: counts.pending, color: counts.pending > 0 ? C.warningAlt : C.textMuted },
    { label: "進行中", value: counts.running, color: counts.running > 0 ? C.success : C.textMuted },
    { label: "已確認", value: counts.confirmed, color: counts.confirmed > 0 ? C.accent : C.textMuted },
    { label: "已完成", value: counts.done, color: counts.done > 0 ? C.violetText : C.textMuted },
    // 異常是例外狀態，正常營運為 0；只在真的有壞排程時顯示，避免長駐一個 0 增加雜訊
    // 洋紅：與「待審核」金色、「已取消」紅色都明顯區隔，避免左側計數撞色
    ...(counts.error > 0 ? [{ label: "異常", value: counts.error, color: C.magentaText }] : []),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflowY: "auto" }}>
      <div style={{ padding: "0 8px 6px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        {summaryItems.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "5px 8px", borderRadius: 5, background: C.surface, border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: C.textDim }}>{label}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: C.textDim, padding: "4px 16px 4px", letterSpacing: 1, flexShrink: 0 }}>設備可用性</div>
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
