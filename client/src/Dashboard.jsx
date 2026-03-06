import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
} from "recharts";

const API = "http://localhost:8000";

const STATUS_CONFIG = {
  OFFLINE: { color: "#484f58", bg: "#21262d", label: "OFFLINE" },
  IDLE: { color: "#8b949e", bg: "#21262d", label: "IDLE" },
  RUNNING: { color: "#3fb950", bg: "#0f2318", label: "RUNNING" },
  PAUSED: { color: "#f0a500", bg: "#2d1f00", label: "PAUSED" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33", label: "FINISHING" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f", label: "EMERGENCY" },
};

const card = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 12,
  padding: "20px 24px",
};

// ── 單台設備卡片 ──────────────────────────────────────────
const DeviceCard = ({ device }) => {
  const sc = STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE;
  const isActive = ["RUNNING", "PAUSED", "FINISHING", "EMERGENCY"].includes(
    device.status,
  );

  return (
    <div
      style={{
        ...card,
        borderLeft: `3px solid ${sc.color}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* 標題列 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span
          style={{
            color: "#cdd9e5",
            fontWeight: 700,
            fontSize: 14,
            fontFamily: "monospace",
          }}
        >
          {device.device_id}
        </span>
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            color: sc.color,
            background: sc.bg,
            border: `1px solid ${sc.color}44`,
          }}
        >
          {sc.label}
        </span>
      </div>

      {/* 溫濕度 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div>
          <div
            style={{
              color: "#484f58",
              fontSize: 10,
              letterSpacing: 1,
              marginBottom: 2,
            }}
          >
            TEMP
          </div>
          <div
            style={{
              color: "#ff7b72",
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {device.temperature.toFixed(1)}
            <span style={{ fontSize: 14, color: "#484f58", marginLeft: 3 }}>
              °C
            </span>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div
            style={{
              color: "#484f58",
              fontSize: 10,
              letterSpacing: 1,
              marginBottom: 2,
            }}
          >
            HUMI
          </div>
          <div
            style={{
              color: "#a5d6ff",
              fontSize: 36,
              fontWeight: 800,
              lineHeight: 1,
            }}
          >
            {device.humidity.toFixed(1)}
            <span style={{ fontSize: 14, color: "#484f58", marginLeft: 3 }}>
              %
            </span>
          </div>
        </div>
      </div>

      {/* 執行中任務 */}
      <div
        style={{
          padding: "8px 12px",
          background: "#0d1117",
          borderRadius: 6,
          border: "1px solid #21262d",
          fontSize: 12,
          color: isActive ? "#cdd9e5" : "#484f58",
        }}
      >
        {isActive ? device.running_sop_name : "STANDBY (IDLE)"}
      </div>
    </div>
  );
};

// ── 主元件 ────────────────────────────────────────────────
const Dashboard = () => {
  const [devices, setDevices] = useState([]);
  const [trendDevice, setTrendDevice] = useState("KSON_CH01");
  const [historyMap, setHistoryMap] = useState({});
  const [executions, setExecutions] = useState([]);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await axios.get(`${API}/api/devices`);
        setDevices(res.data);
        setHistoryMap((prev) => {
          const next = { ...prev };
          res.data.forEach((d) => {
            const prevList = next[d.device_id] || [];
            next[d.device_id] = [
              ...prevList.slice(-59),
              {
                time: d.timestamp,
                temperature: d.temperature,
                humidity: d.humidity,
              },
            ];
          });
          return next;
        });
      } catch (err) {}
    };
    const interval = setInterval(fetchDevices, 1000);
    fetchDevices();
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    axios
      .get(`${API}/api/reports/list`)
      .then((r) => setExecutions(r.data))
      .catch(() => {});
  }, []);

  const runningCount = devices.filter((d) => d.status === "RUNNING").length;
  const emergencyCount = devices.filter((d) => d.status === "EMERGENCY").length;
  const idleCount = devices.filter((d) =>
    ["IDLE", "OFFLINE"].includes(d.status),
  ).length;

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        color: "#cdd9e5",
        minHeight: "100vh",
        padding: "24px 28px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {/* 標題列 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          borderBottom: "1px solid #30363d",
          paddingBottom: 16,
          marginBottom: 24,
        }}
      >
        <h1
          style={{ color: "#58a6ff", margin: 0, fontSize: 22, fontWeight: 700 }}
        >
          KSON AICM | Digital Twin
        </h1>
        <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
          <span style={{ color: "#3fb950" }}>● 執行中 {runningCount}</span>
          <span style={{ color: "#f85149" }}>● 緊急 {emergencyCount}</span>
          <span style={{ color: "#484f58" }}>● 待機 {idleCount}</span>
        </div>
      </div>

      {/* 5 台設備卡片 */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {devices.map((device) => (
          <DeviceCard key={device.device_id} device={device} />
        ))}
      </div>

      {/* 趨勢圖 — 可切換設備 */}
      <div style={{ ...card, marginBottom: 24 }}>
        {/* 標題列 + 設備切換按鈕 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <div
            style={{
              color: "#8b949e",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1,
            }}
          >
            {trendDevice} — TEMP / HUMI TREND（最近 60 秒）
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {devices.map((d) => {
              const sc = STATUS_CONFIG[d.status] || STATUS_CONFIG.OFFLINE;
              const isSelected = d.device_id === trendDevice;
              return (
                <button
                  key={d.device_id}
                  onClick={() => setTrendDevice(d.device_id)}
                  style={{
                    padding: "3px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "monospace",
                    border: `1px solid ${isSelected ? sc.color : sc.color + "66"}`,
                    background: isSelected ? sc.bg : "#0d1117",
                    color: isSelected ? sc.color : sc.color + "99",
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    transition: "all .15s",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: sc.color,
                      flexShrink: 0,
                      boxShadow:
                        d.status === "RUNNING" ? `0 0 6px ${sc.color}` : "none",
                    }}
                  />
                  {d.device_id.replace("KSON_", "")}
                </button>
              );
            })}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={historyMap[trendDevice] || []}
            margin={{ top: 5, right: 16, left: -10, bottom: 5 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#21262d"
              vertical={false}
            />
            <XAxis
              dataKey="time"
              stroke="#30363d"
              tick={{ fontSize: 10, fill: "#484f58" }}
              hide={(historyMap[trendDevice] || []).length < 2}
            />
            <YAxis
              stroke="#30363d"
              domain={["auto", "auto"]}
              tick={{ fontSize: 10, fill: "#484f58" }}
            />
            <Tooltip
              contentStyle={{
                background: "#161b22",
                border: "1px solid #30363d",
                fontSize: 11,
              }}
              itemStyle={{ color: "#cdd9e5" }}
            />
            <Line
              type="monotone"
              dataKey="temperature"
              name="溫度 (°C)"
              stroke="#ff7b72"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="humidity"
              name="濕度 (%RH)"
              stroke="#a5d6ff"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* 執行紀錄 */}
      <div style={card}>
        <div
          style={{
            color: "#8b949e",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 1,
            marginBottom: 16,
          }}
        >
          執行紀錄 EXECUTION HISTORY
        </div>
        {executions.length === 0 ? (
          <div
            style={{
              color: "#484f58",
              fontSize: 13,
              textAlign: "center",
              padding: "20px 0",
            }}
          >
            尚無執行紀錄
          </div>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d" }}>
                {["ID", "SOP ID", "執行時間", "報告"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "6px 12px",
                      textAlign: "left",
                      color: "#8b949e",
                      fontWeight: 600,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {executions.map((ex) => (
                <tr key={ex.id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "8px 12px", color: "#484f58" }}>
                    #{ex.id}
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      color: "#cdd9e5",
                      fontFamily: "monospace",
                    }}
                  >
                    {ex.sop_id}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#8b949e" }}>
                    {ex.created_at}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <button
                      onClick={() =>
                        window.open(`${API}/api/reports/csv/${ex.id}`, "_blank")
                      }
                      style={{
                        padding: "4px 10px",
                        background: "#1f6feb",
                        color: "#fff",
                        border: "none",
                        borderRadius: 4,
                        cursor: "pointer",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      📥 CSV
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
