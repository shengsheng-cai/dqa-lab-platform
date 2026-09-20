import React, { useState, useEffect } from "react";
import { formatLocal } from "../../utils/timezone";
import { formatFreeTime, formatCycle, formatStep } from "../../utils/executionInfo";
import useCountdown from "../../useCountdown";

/**
 * 執行中資訊面板（左側欄，顯示 Pgm / Step / Free Time / Cycle / Now Time / End Time）。
 *
 * 結束與剩餘時間一律顯示後端算好的那一份（estimatedEndAt），和設備卡的倒數同一個來源。
 * 這裡以前拿測試條件自己重算一條曲線，少算了常溫穩定與暫停的時間，於是同一台設備在
 * 兩個畫面講出不同的結束時間。曲線算法留給溫度圖，不再拿來算時間。
 */
const ExecutionInfoPanel = ({ sop, startedAt, estimatedEndAt, simCycle, doneCnt }) => {
  const [now, setNow] = useState(new Date());
  const remainingSec = useCountdown(estimatedEndAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!sop || !startedAt) return null;

  const fmt = (d) => formatLocal(d, "datetime");

  const rows = [
    ["Pgm", sop.sop_id || "—"],
    ["Step", formatStep(doneCnt, sop.steps?.length)],
    ["Free Time", formatFreeTime(remainingSec)],
    ["Cycle", formatCycle(simCycle, sop.cycles)],
    ["Now Time", fmt(now)],
    ["End Time", fmt(estimatedEndAt)],
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
