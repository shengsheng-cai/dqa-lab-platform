import React from "react";
import {
  ComposedChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Brush,
  ResponsiveContainer,
} from "recharts";
import { generateSP, mergeSpPv, toElapsedMin } from "./generateSP";
import { parseUtcDate } from "../../constants";

function fmtWallClock(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const TempChart = ({ sop, pvData, startedAt }) => {
  const spData = React.useMemo(() => generateSP(sop), [sop]);

  const pvWithMin = React.useMemo(() => {
    if (!pvData || !startedAt) return [];
    return pvData
      .map((p) => ({ ...p, min: toElapsedMin(startedAt, p.full_time) }))
      .filter((p) => p.min != null);
  }, [pvData, startedAt]);

  const merged = React.useMemo(() => {
    const base = mergeSpPv(spData, pvWithMin);
    const startDate = parseUtcDate(startedAt);
    if (!startDate) return base;
    const startMs = startDate.getTime();
    return base.map((p) => ({ ...p, label: fmtWallClock(startMs + p.min * 60000) }));
  }, [spData, pvWithMin, startedAt]);

  if (spData.length === 0) {
    return (
      <div
        style={{
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#484f58",
          fontSize: 11,
        }}
      >
        等待測試啟動...
      </div>
    );
  }

  // 預設視窗跟著最新 PV 資料走，讓使用者看到目前進度而非 SP 末端
  let brushEnd = merged.length - 1;
  if (pvWithMin.length > 0) {
    const latestMin = pvWithMin[pvWithMin.length - 1].min;
    const idx = merged.findIndex((p) => p.min > latestMin + 60);
    brushEnd = idx === -1 ? merged.length - 1 : idx;
  }
  const brushStart = Math.max(0, brushEnd - 119);
  const spTemps = spData.map((p) => p.sp_temp);
  const tempMin = Math.min(...spTemps) - 10;
  const tempMax = Math.max(...spTemps) + 10;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart
        data={merged}
        margin={{ top: 8, right: 44, bottom: 28, left: 4 }}
      >
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="#1c2128"
          vertical={false}
        />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 9, fill: "#484f58" }}
          tickLine={false}
          axisLine={{ stroke: "#30363d" }}
          interval={Math.max(1, Math.floor(merged.length / 8))}
          label={{
            value: startedAt ? "時刻 (HH:MM)" : "時長 (hr:min)",
            position: "insideBottom",
            offset: -16,
            fontSize: 9,
            fill: "#484f58",
          }}
        />
        <YAxis
          yAxisId="temp"
          orientation="left"
          domain={[tempMin, tempMax]}
          tick={{ fontSize: 9, fill: "#ff7b72" }}
          width={32}
          tickFormatter={(v) => `${v}°`}
        />
        {sop?.humidity_control && (
          <YAxis
            yAxisId="humi"
            orientation="right"
            domain={[0, 100]}
            tick={{ fontSize: 9, fill: "#a5d6ff" }}
            width={28}
            tickFormatter={(v) => `${v}%`}
          />
        )}
        <Tooltip
          contentStyle={{
            background: "#1c2128",
            border: "1px solid #30363d",
            fontSize: 10,
            borderRadius: 6,
          }}
          labelStyle={{ color: "#8b949e", marginBottom: 4 }}
          formatter={(v, name) => {
            if (name === "sp_temp") return [`${v?.toFixed(1)} °C`, "SP 溫度"];
            if (name === "pv_temp") return [`${v?.toFixed(1)} °C`, "PV 溫度"];
            if (name === "sp_humi") return [`${v?.toFixed(1)} %RH`, "SP 濕度"];
            if (name === "pv_humi") return [`${v?.toFixed(1)} %RH`, "PV 濕度"];
            return [v, name];
          }}
        />
        <Brush
          dataKey="label"
          startIndex={brushStart}
          endIndex={brushEnd}
          height={16}
          stroke="#30363d"
          fill="#0d1117"
          travellerWidth={5}
          style={{ fontSize: 8 }}
        />
        <Line
          yAxisId="temp"
          type="monotone"
          dataKey="pv_temp"
          name="pv_temp"
          stroke="#ff7b72"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        <Line
          yAxisId="temp"
          type="linear"
          dataKey="sp_temp"
          name="sp_temp"
          stroke="#8b949e"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
          connectNulls
        />
        {sop?.humidity_control && (
          <Line
            yAxisId="humi"
            type="linear"
            dataKey="sp_humi"
            name="sp_humi"
            stroke="#3a6b99"
            strokeWidth={1}
            strokeDasharray="5 3"
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
        {sop?.humidity_control && (
          <Line
            yAxisId="humi"
            type="monotone"
            dataKey="pv_humi"
            name="pv_humi"
            stroke="#a5d6ff"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default TempChart;
