import React from "react";
import {
  ComposedChart,
  Line,
  Scatter,
  ReferenceLine,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

function AnomalyDot({ cx, cy }) {
  if (cx == null || cy == null) return null;
  return <circle cx={cx} cy={cy} r={4} fill="#f85149" stroke="#ff7b72" strokeWidth={1} />;
}

function ChartSection({ data, dataKey, anomalyKey, label, unit, color, mean, ucl, lcl, domain, height = 180 }) {
  const anomalies = data.filter((d) => d[anomalyKey]);
  const interval = Math.max(1, Math.floor(data.length / 6));

  return (
    <>
      <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>{label} ({unit})</div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={data} margin={{ top: 4, right: 44, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1c2128" vertical={false} />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 8, fill: "#484f58" }}
            tickLine={false}
            axisLine={{ stroke: "#30363d" }}
            interval={interval}
          />
          <YAxis
            domain={domain}
            tick={{ fontSize: 8, fill: color }}
            width={30}
            tickFormatter={(v) => unit.includes("%") ? `${v}%` : `${v}°`}
          />
          <Tooltip
            contentStyle={{ background: "#1c2128", border: "1px solid #30363d", fontSize: 10, borderRadius: 6 }}
            labelStyle={{ color: "#8b949e" }}
            formatter={(v, name) => name === dataKey ? [`${v?.toFixed(1)} ${unit}`, `${label} PV`] : [v, name]}
          />
          {ucl != null && (
            <ReferenceLine y={ucl} stroke="#f85149" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `UCL ${ucl}${unit.includes("%") ? "%" : "°"}`, position: "right", fontSize: 8, fill: "#f85149" }} />
          )}
          {mean != null && (
            <ReferenceLine y={mean} stroke="#484f58" strokeDasharray="2 4" strokeWidth={1}
              label={{ value: `μ ${mean}${unit.includes("%") ? "%" : "°"}`, position: "right", fontSize: 8, fill: "#484f58" }} />
          )}
          {lcl != null && (
            <ReferenceLine y={lcl} stroke="#f85149" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `LCL ${lcl}${unit.includes("%") ? "%" : "°"}`, position: "right", fontSize: 8, fill: "#f85149" }} />
          )}
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
            connectNulls
          />
          {anomalies.length > 0 && (
            <Scatter
              data={anomalies}
              dataKey={dataKey}
              fill="#f85149"
              shape={<AnomalyDot />}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

const SensorQcChart = ({ stats }) => {
  if (!stats || !stats.data || stats.data.length === 0) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: 12 }}>
        最近 24 小時無感測器資料
      </div>
    );
  }

  if (!stats.data || stats.data.length < 5) {
    return (
      <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#484f58", fontSize: 12 }}>
        資料不足（需 ≥ 5 筆），無法計算控制線
      </div>
    );
  }

  const hasHumi = stats.data.some((d) => d.humidity != null);
  const allTemps = stats.data.map((d) => d.temperature).filter((v) => v != null);
  const tempDomain = [Math.min(...allTemps) - 5, Math.max(...allTemps) + 5];

  return (
    <div>
      <ChartSection
        data={stats.data}
        dataKey="temperature"
        anomalyKey="temp_anomaly"
        label="溫度"
        unit="°C"
        color="#ff7b72"
        mean={stats.temp_mean}
        ucl={stats.temp_ucl}
        lcl={stats.temp_lcl}
        domain={tempDomain}
        height={180}
      />
      {hasHumi && (
        <div style={{ marginTop: 12 }}>
          <ChartSection
            data={stats.data}
            dataKey="humidity"
            anomalyKey="humi_anomaly"
            label="濕度"
            unit="%RH"
            color="#a5d6ff"
            mean={stats.humi_mean}
            ucl={stats.humi_ucl}
            lcl={stats.humi_lcl}
            domain={[0, 100]}
            height={160}
          />
        </div>
      )}
    </div>
  );
};

export default SensorQcChart;
