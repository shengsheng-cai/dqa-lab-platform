import React, { useState, useEffect } from "react";
import { generateSP } from "./generateSP";
import { parseUtcDate } from "../../constants";
import { formatLocal } from "../../utils/timezone";

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

// 執行中資訊面板（左側欄，顯示 Pgm / Step / Free Time / Cycle / Now Time / End Time）
const ExecutionInfoPanel = ({ sop, startedAt, simCycle, doneCnt }) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!sop || !startedAt) return null;

  const startedAtDate = parseUtcDate(startedAt);

  const elapsedMin = Math.floor((now - startedAtDate) / 60000);
  const spData = generateSP(sop);
  const totalMin = spData.length > 0 ? spData[spData.length - 1].min : 0;
  const endTime = new Date(startedAtDate.getTime() + totalMin * 60000);
  const freeTimeMin = Math.max(0, totalMin - elapsedMin);
  const freeH = Math.floor(freeTimeMin / 60);
  const freeM = freeTimeMin % 60;
  const totalStepCount = sop.steps?.length ?? 0;
  const cycles = sop.cycles ?? 1;

  const fmt = (d) => formatLocal(d, "datetime");

  const rows = [
    ["Pgm", sop.sop_id || "—"],
    [
      "Step",
      `${doneCnt.toString().padStart(3, "0")}/${totalStepCount.toString().padStart(3, "0")}`,
    ],
    [
      "Free Time",
      `${String(freeH).padStart(4, "0")}:${String(freeM).padStart(2, "0")}`,
    ],
    [
      "Cycle",
      `${String((simCycle ?? 0) + 1).padStart(4, "0")}/${String(cycles).padStart(4, "0")}`,
    ],
    ["Now Time", fmt(now)],
    ["End Time", fmt(endTime)],
  ];

  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #30363d",
        borderLeft: "3px solid #58a6ff",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 10,
        fontFamily: "monospace",
      }}
    >
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "3px 0",
            borderBottom: "1px solid #161b22",
          }}
        >
          <span style={{ color: "#484f58", fontSize: 11 }}>{label}</span>
          <span style={{ color: "#cdd9e5", fontSize: 11, fontWeight: 600 }}>
            {value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default ExecutionInfoPanel;
