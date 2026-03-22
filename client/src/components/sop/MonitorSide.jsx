import React from "react";
import TempChart from "./TempChart";
import ExecutionInfoPanel from "./ExecutionInfoPanel";

const DEVICE_IDS = [
  "KSON_CH01",
  "KSON_CH02",
  "KSON_CH03",
  "KSON_CH04",
  "KSON_CH05",
];

const STATUS_CONFIG = {
  OFFLINE: { color: "#484f58", bg: "#21262d" },
  IDLE: { color: "#8b949e", bg: "#21262d" },
  RUNNING: { color: "#3fb950", bg: "#0f2318" },
  PAUSED: { color: "#f0a500", bg: "#2d1f00" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f" },
};

const MonitorSide = ({
  selectedDevice,
  allDevices,
  data,
  ds,
  doneCnt,
  isActive,
  isOffline,
  isEmergency,
  onSelectDevice,
}) => {
  const sc = STATUS_CONFIG[data.status] || STATUS_CONFIG.OFFLINE;

  return (
    <aside className="monitor-side">
      {/* Brand + status */}
      <div className="brand-box">
        <h1 className="main-title">KSON AICM | Digital Twin</h1>
        <div className="status-row">
          <span className={`status-dot ${data.status.toLowerCase()}`} />
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 700,
              color: sc.color,
              background: sc.bg,
              border: `1px solid ${sc.color}44`,
              letterSpacing: 0.5,
            }}
          >
            {data.status}
          </span>
          <span className="update-time">{data.timestamp}</span>
        </div>
      </div>

      {/* Device selector */}
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#484f58",
            letterSpacing: 1,
            marginBottom: 8,
            fontWeight: 600,
          }}
        >
          SELECT DEVICE
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {DEVICE_IDS.map((id) => {
            const d = allDevices[id];
            const s = STATUS_CONFIG[d?.status] || STATUS_CONFIG.OFFLINE;
            const isSelected = id === selectedDevice;
            return (
              <button
                key={id}
                onClick={() => onSelectDevice(id)}
                style={{
                  padding: "5px 10px",
                  borderRadius: 6,
                  fontSize: 11,
                  cursor: "pointer",
                  fontFamily: "monospace",
                  fontWeight: isSelected ? 700 : 400,
                  border: `1px solid ${isSelected ? s.color : "#30363d"}`,
                  background: isSelected ? s.bg : "#0d1117",
                  color: isSelected ? s.color : "#8b949e",
                  transition: "all .15s",
                }}
              >
                {id.replace("KSON_", "")}
              </button>
            );
          })}
        </div>
      </div>

      {/* Current mission */}
      <div className="info-card highlight">
        <label>CURRENT MISSION</label>
        <div className="value-large" style={{ fontSize: 13 }}>
          {isActive
            ? data.running_sop_name || "執行中"
            : isEmergency
              ? "⚠️ 緊急停止已觸發"
              : isOffline
                ? "等待後端連線"
                : "STANDBY (IDLE)"}
        </div>
      </div>

      {/* Execution info panel */}
      {isActive && ds.activeSop && (
        <ExecutionInfoPanel
          sop={ds.activeSop}
          startedAt={data.started_at}
          simCycle={allDevices[selectedDevice]?.sim_cycle}
          doneCnt={doneCnt}
        />
      )}

      {/* Trend chart */}
      <div className="info-card" style={{ padding: "14px 16px 10px" }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <label style={{ fontSize: 11, color: "#484f58", letterSpacing: 1 }}>
            TEMP / HUMI TREND
          </label>
          <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
            <span style={{ color: "#555e6b" }}>── SP</span>
            <span style={{ color: "#ff7b72" }}>── PV Temp</span>
            <span style={{ color: "#a5d6ff" }}>── PV Humi</span>
          </div>
        </div>
        <TempChart
          sop={ds.activeSop}
          pvData={ds.chartHistory}
          startedAt={ds.chartStartedAt}
        />
      </div>
    </aside>
  );
};

export default MonitorSide;
