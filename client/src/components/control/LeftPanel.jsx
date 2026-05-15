import DeviceCard from "./DeviceCard";
import FixtureSummaryPanel from "./FixtureSummaryPanel";
import ScheduleSummaryPanel from "./ScheduleSummaryPanel";
import UsersSummaryPanel from "./UsersSummaryPanel";
import CalibrationSummaryPanel from "./CalibrationSummaryPanel";

export default function LeftPanel({ devices, selectedDevice, onSelectDevice, activeTab, fixtureSummary, onOpenRecords, pendingByDevice, onConfirmCondition, scheduleCounts, onShowQc, calibrationStatusMap }) {
  const title = activeTab === "schedule" ? "本欄：排程概況"
    : activeTab === "fixture" ? "本欄：治具概況"
    : activeTab === "users" ? "本欄：人員概況"
    : activeTab === "maintenance" ? "本欄：校驗狀態"
    : "本欄：設備狀態";

  return (
    <div style={{ width: 155, flexShrink: 0, borderRight: "1px solid #30363d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "7px 10px 4px", fontSize: 10, color: "#6e7681", fontWeight: 600, letterSpacing: 0.5, flexShrink: 0 }}>
        {title}
      </div>

      <div style={{
        flex: 1,
        padding: (activeTab === "fixture" || activeTab === "schedule" || activeTab === "users" || activeTab === "maintenance") ? 0 : "0 8px",
        display: "flex",
        flexDirection: "column",
        gap: (activeTab === "fixture" || activeTab === "schedule" || activeTab === "users" || activeTab === "maintenance") ? 0 : 4,
        overflowY: activeTab === "schedule" ? "hidden" : "auto",
      }}>
        {activeTab === "fixture" ? (
          <FixtureSummaryPanel fixtureSummary={fixtureSummary} />
        ) : activeTab === "schedule" ? (
          <ScheduleSummaryPanel devices={devices} pendingByDevice={pendingByDevice} onConfirmCondition={onConfirmCondition} counts={scheduleCounts} onShowQc={onShowQc} calibrationStatusMap={calibrationStatusMap} />
        ) : activeTab === "users" ? (
          <UsersSummaryPanel />
        ) : activeTab === "maintenance" ? (
          <CalibrationSummaryPanel calibrationStatusMap={calibrationStatusMap} />
        ) : (
          devices.map((d) => (
            <DeviceCard
              key={d.device_id}
              device={d}
              isSelected={d.device_id === selectedDevice}
              onClick={() => onSelectDevice(d.device_id)}
              onShowQc={onShowQc}
              calibrationStatus={calibrationStatusMap?.[d.device_id]?.status}
            />
          ))
        )}
      </div>

      {activeTab === "device" && selectedDevice && (
        <button
          onClick={onOpenRecords}
          style={{ margin: "8px", padding: "6px 0", fontSize: 11, background: "transparent", border: "1px solid #30363d", borderRadius: 6, color: "#8b949e", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#58a6ff"; e.currentTarget.style.color = "#58a6ff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#30363d"; e.currentTarget.style.color = "#8b949e"; }}
        >
          📋 紀錄
        </button>
      )}
    </div>
  );
}
