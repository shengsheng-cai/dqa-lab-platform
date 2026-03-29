import React from "react";

const ConditionCard = ({ test }) => {
  if (!test) return null;
  const rows = [
    [
      "高溫上限",
      test.high_temperature != null ? `${test.high_temperature} °C` : "—",
    ],
    [
      "低溫下限",
      test.low_temperature != null ? `${test.low_temperature} °C` : "—",
    ],
    ["升降溫速率", test.ramp_rate != null ? `${test.ramp_rate} °C/min` : "—"],
    [
      "停留時間",
      test.dwell_time_hours != null ? `${test.dwell_time_hours} h` : "—",
    ],
    [
      "濕度設定",
      test.humidity_rh_percent != null
        ? test.low_temperature != null && test.low_temperature < 0
          ? `${test.humidity_rh_percent} %RH（低溫段 <0°C 無濕度）`
          : `${test.humidity_rh_percent} %RH`
        : "N/A（無濕度控制）",
    ],
    ["通電狀態", test.power_on ? "通電 (Powered)" : "非通電 (Unpowered)"],
    ["溫度容差", `± ${test.temp_tolerance} °C`],
    ["濕度容差", `± ${test.humi_tolerance} %RH`],
  ];

  return (
    <div
      style={{
        background: "#0d1117",
        border: "1px solid #30363d",
        borderLeft: "3px solid #a371f7",
        borderRadius: 8,
        padding: "14px 16px",
        marginTop: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#a371f7",
          fontWeight: 700,
          marginBottom: 6,
          letterSpacing: 1,
        }}
      >
        📋 測試條件摘要
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#8b949e",
          marginBottom: 10,
          lineHeight: 1.5,
        }}
      >
        {test.description}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "3px 12px",
        }}
      >
        {rows.map(([label, value]) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "4px 0",
              borderBottom: "1px solid #21262d",
            }}
          >
            <span style={{ color: "#8b949e", fontSize: 11 }}>{label}</span>
            <span style={{ color: "#cdd9e5", fontSize: 11, fontWeight: 600 }}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 10, color: "#484f58" }}>
        📖 {test.reference}
      </div>
    </div>
  );
};

export default ConditionCard;
