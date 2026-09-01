import React from "react";
import TempChart from "./TempChart";
import ExecutionInfoPanel from "./ExecutionInfoPanel";
import { deviceStatusZh, ACTIVE_STATUSES, FINISHING_STATUS, IDLE_STATUS, OFFLINE_STATUS, EMERGENCY_STATUS } from "../../constants";
import { formatLocal } from "../../utils/timezone";

const MonitorSide = ({
  data,
  ds,
  doneCnt,
}) => {
  const isActive = ACTIVE_STATUSES.includes(data.status);
  const isFinishing = data.status === FINISHING_STATUS;
  const isOffline = data.status === OFFLINE_STATUS;
  const isEmergency = data.status === EMERGENCY_STATUS;

  return (
    // 這個元件只有 SOP 頁的嵌入版面在用，embedded 是它唯一的樣式
    <aside className="monitor-side embedded">
      <div style={{ paddingBottom: 4, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 10, color: "#484f58" }}>updated {formatLocal(data.timestamp, "time")}</span>
      </div>

      {/* Current mission */}
      <div className="info-card highlight">
        <label>CURRENT MISSION</label>
        <div className="value-large" style={{ fontSize: 13 }}>
          {isActive
            ? data.running_sop_name || "執行中"
            : isFinishing
              ? data.running_sop_name || "系統自動降溫收尾中..."
              : isEmergency
                ? "⚠️ 緊急停止已觸發"
                : isOffline
                  ? "等待後端連線"
                  : deviceStatusZh(IDLE_STATUS)}
        </div>
      </div>

      {/* Execution info panel */}
      {isActive && ds.activeSop && (
        <ExecutionInfoPanel
          sop={ds.activeSop}
          startedAt={data.started_at}
          simCycle={data.sim_cycle}
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
            {ds.activeSop?.humidity_control ? "TEMP / HUMI TREND" : "TEMP TREND"}
          </label>
          <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
            <span style={{ color: "#8b949e" }}>── SP 設定值</span>
            <span style={{ color: "#ff7b72" }}>── PV 實測溫</span>
            {ds.activeSop?.humidity_control && (
              <span style={{ color: "#a5d6ff" }}>── PV 實測濕</span>
            )}
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
