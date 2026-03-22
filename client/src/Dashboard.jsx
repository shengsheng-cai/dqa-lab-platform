import React, { useState, useEffect, useRef, useCallback } from "react";
import api, { API_BASE } from "./api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  CartesianGrid,
  Tooltip,
  Brush,
} from "recharts";

const STATUS_CONFIG = {
  OFFLINE: { color: "#484f58", bg: "#21262d", label: "OFFLINE" },
  IDLE: { color: "#8b949e", bg: "#21262d", label: "IDLE" },
  RUNNING: { color: "#3fb950", bg: "#0f2318", label: "RUNNING" },
  PAUSED: { color: "#f0a500", bg: "#2d1f00", label: "PAUSED" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33", label: "FINISHING" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f", label: "EMERGENCY" },
};

const DEVICE_IDS = [
  "KSON_CH01",
  "KSON_CH02",
  "KSON_CH03",
  "KSON_CH04",
  "KSON_CH05",
];

const card = {
  background: "#161b22",
  border: "1px solid #30363d",
  borderRadius: 12,
  padding: "20px 24px",
};

const useCountdown = (estimatedEndAt) => {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!estimatedEndAt) {
      setRemaining(null);
      return;
    }
    const calc = () => {
      const diff = new Date(estimatedEndAt) - new Date();
      setRemaining(Math.max(0, Math.floor(diff / 1000)));
    };
    calc();
    const timer = setInterval(calc, 1000);
    return () => clearInterval(timer);
  }, [estimatedEndAt]);

  if (remaining === null) return null;
  // 修改：剩餘 0 秒時顯示「—」而非 00:00:00，避免誤導使用者
  if (remaining === 0) return "—";
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const DeviceCard = ({ device, selected, onClick }) => {
  const sc = STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE;
  const isActive = ["RUNNING", "PAUSED", "FINISHING", "EMERGENCY"].includes(
    device.status,
  );
  const showCountdown = ["RUNNING", "PAUSED"].includes(device.status);
  const totalSteps = device.total_steps || 0;
  const completedSteps = device.completed_steps || 0;
  const progressPct = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;
  const countdown = useCountdown(
    showCountdown ? device.estimated_end_at : null,
  );
  const showHumi = device.temperature >= 0;

  return (
    <div
      onClick={onClick}
      style={{
        ...card,
        borderLeft: `3px solid ${sc.color}`,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        cursor: "pointer",
        outline: selected ? `2px solid ${sc.color}` : "none",
        outlineOffset: 2,
        transition: "outline 0.15s",
      }}
    >
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
          {showHumi ? (
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
          ) : (
            <div
              style={{
                color: "#484f58",
                fontSize: 28,
                fontWeight: 800,
                lineHeight: 1,
              }}
            >
              —
              <span style={{ fontSize: 11, color: "#484f58", marginLeft: 4 }}>
                低溫無濕度
              </span>
            </div>
          )}
        </div>
      </div>

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

      {isActive && totalSteps > 0 && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 10, color: "#484f58" }}>步驟進度</span>
            <span
              style={{
                fontSize: 10,
                color: "#8b949e",
                fontFamily: "monospace",
              }}
            >
              {completedSteps}/{totalSteps}
            </span>
          </div>
          <div
            style={{
              height: 4,
              background: "#21262d",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                borderRadius: 2,
                background: progressPct === 100 ? "#57ab5a" : sc.color,
                width: `${progressPct}%`,
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {showCountdown && countdown !== null && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "6px 10px",
            background: "#0d1117",
            borderRadius: 6,
            border: "1px solid #21262d",
          }}
        >
          <span style={{ fontSize: 10, color: "#484f58", letterSpacing: 1 }}>
            剩餘時間
          </span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              fontFamily: "monospace",
              // 修改：「—」用灰色，正常倒數用狀態色
              color: countdown === "—" ? "#484f58" : sc.color,
            }}
          >
            {countdown}
          </span>
        </div>
      )}
    </div>
  );
};

// 修改：報告下載改用 axios blob，帶 X-Demo-Password header
const downloadCsv = async (execId, sopId) => {
  try {
    const res = await api.get(`/api/reports/csv/${execId}`, {
      responseType: "blob",
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const safeSopId = (sopId || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_");
    a.download = `${safeSopId}_${date}_${execId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error("[Dashboard] CSV download failed:", e);
    alert("❌ 報告下載失敗，請確認後端連線。");
  }
};

const Dashboard = ({ active = true }) => {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState("KSON_CH01");
  const [historyMap, setHistoryMap] = useState(() =>
    Object.fromEntries(DEVICE_IDS.map((id) => [id, []])),
  );
  const lastStartedAtRef = useRef(
    Object.fromEntries(DEVICE_IDS.map((id) => [id, null])),
  );
  const lastFetchMinuteRef = useRef(
    Object.fromEntries(DEVICE_IDS.map((id) => [id, -1])),
  );
  const [executions, setExecutions] = useState([]);

  const fetchHistory = useCallback((deviceId) => {
    api
      .get(`/api/devices/${deviceId}/history`)
      .then((r) => {
        const data = r.data.map((p) => ({
          time: p.time,
          temperature: p.temperature,
          humidity: p.temperature < 0 ? null : p.humidity,
        }));
        setHistoryMap((prev) => ({ ...prev, [deviceId]: data }));
      })
      .catch((err) => console.error("[Dashboard] history fetch:", err));
  }, []);

  useEffect(() => {
    fetchHistory(selectedDevice);
  }, [selectedDevice, fetchHistory]);

  useEffect(() => {
    if (!active) return;
    const fetchDevices = async () => {
      try {
        const res = await api.get("/api/devices");
        setDevices(res.data);
        const now = new Date();
        const currentMinute = now.getHours() * 60 + now.getMinutes();
        res.data.forEach((d) => {
          const id = d.device_id;
          const isRunning = ["RUNNING", "PAUSED", "FINISHING"].includes(
            d.status,
          );
          if (d.started_at && d.started_at !== lastStartedAtRef.current[id]) {
            lastStartedAtRef.current[id] = d.started_at;
            lastFetchMinuteRef.current[id] = currentMinute;
            fetchHistory(id);
            return;
          }
          if (isRunning && id === selectedDevice) {
            if (currentMinute !== lastFetchMinuteRef.current[id]) {
              lastFetchMinuteRef.current[id] = currentMinute;
              fetchHistory(id);
            }
          }
          if (d.status === "IDLE" && lastStartedAtRef.current[id] !== null) {
            lastStartedAtRef.current[id] = null;
            setHistoryMap((prev) => ({ ...prev, [id]: [] }));
          }
        });
      } catch (err) {
        console.error("[Dashboard] devices fetch:", err);
      }
    };
    const interval = setInterval(fetchDevices, 10000);
    fetchDevices();
    return () => clearInterval(interval);
  }, [active, selectedDevice, fetchHistory]);

  useEffect(() => {
    if (!active) return;
    const fetchExecutions = () => {
      api
        .get("/api/reports/list")
        .then((r) => setExecutions(r.data))
        .catch((err) => console.error("[Dashboard] executions fetch:", err));
    };
    fetchExecutions();
    const t = setInterval(fetchExecutions, 60000);
    return () => clearInterval(t);
  }, [active]);

  const runningCount = devices.filter((d) => d.status === "RUNNING").length;
  const emergencyCount = devices.filter((d) => d.status === "EMERGENCY").length;
  const idleCount = devices.filter((d) =>
    ["IDLE", "OFFLINE"].includes(d.status),
  ).length;
  const history = historyMap[selectedDevice] || [];

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        color: "#cdd9e5",
        height: "100%",
        overflowY: "auto",
        padding: "24px 28px",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {devices.map((device) => (
          <DeviceCard
            key={device.device_id}
            device={device}
            selected={device.device_id === selectedDevice}
            onClick={() => setSelectedDevice(device.device_id)}
          />
        ))}
      </div>

      <div style={{ ...card, marginBottom: 24 }}>
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
            {selectedDevice} — TEMP / HUMI TREND（完整測試時長）
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {DEVICE_IDS.map((id) => {
              const d = devices.find((x) => x.device_id === id);
              const sc = STATUS_CONFIG[d?.status] || STATUS_CONFIG.OFFLINE;
              const isActive = id === selectedDevice;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedDevice(id)}
                  style={{
                    padding: "3px 8px",
                    borderRadius: 5,
                    fontSize: 10,
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontWeight: isActive ? 700 : 400,
                    border: `1px solid ${isActive ? sc.color : "#30363d"}`,
                    background: isActive ? sc.bg : "#0d1117",
                    color: isActive ? sc.color : "#484f58",
                    transition: "all .15s",
                  }}
                >
                  {id.replace("KSON_", "")}
                </button>
              );
            })}
          </div>
        </div>

        {history.length < 2 ? (
          <div
            style={{
              height: 220,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#484f58",
              fontSize: 12,
            }}
          >
            等待資料累積中（每分鐘記錄一點）...
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart
              data={history}
              margin={{ top: 5, right: 44, left: -10, bottom: 5 }}
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
              />
              <YAxis
                yAxisId="temp"
                orientation="left"
                domain={([dataMin, dataMax]) => {
                  const padding = Math.max(
                    10,
                    Math.abs(dataMax - dataMin) * 0.1,
                  );
                  return [
                    Math.floor((dataMin - padding) / 10) * 10,
                    Math.ceil((dataMax + padding) / 10) * 10,
                  ];
                }}
                stroke="#30363d"
                tick={{ fontSize: 10, fill: "#ff7b72" }}
                tickFormatter={(v) => `${v}°`}
                width={42}
              />
              <YAxis
                yAxisId="humi"
                orientation="right"
                domain={[0, 100]}
                stroke="#30363d"
                tick={{ fontSize: 10, fill: "#a5d6ff" }}
                tickFormatter={(v) => `${v}%`}
                width={32}
              />
              <Tooltip
                contentStyle={{
                  background: "#161b22",
                  border: "1px solid #30363d",
                  fontSize: 11,
                }}
                labelStyle={{ color: "#8b949e", marginBottom: 4 }}
                formatter={(v, name) => {
                  if (v === null)
                    return ["—", name === "temperature" ? "溫度" : "濕度"];
                  return [
                    `${v.toFixed(1)}${name === "temperature" ? " °C" : " %RH"}`,
                    name === "temperature" ? "溫度" : "濕度",
                  ];
                }}
              />
              <Line
                yAxisId="temp"
                type="monotone"
                dataKey="temperature"
                name="temperature"
                stroke="#ff7b72"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="humi"
                type="monotone"
                dataKey="humidity"
                name="humidity"
                stroke="#a5d6ff"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
              <Brush
                dataKey="time"
                height={24}
                stroke="#30363d"
                fill="#161b22"
                travellerWidth={6}
                startIndex={Math.max(0, history.length - 60)}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

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
                {/* 修改：SOP ID 欄位改為「測試名稱」，顯示人類可讀的名稱 */}
                {["ID", "測試名稱", "設備", "執行人員", "測試開始", "報告"].map(
                  (h) => (
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
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {executions.map((ex) => (
                <tr key={ex.id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "8px 12px", color: "#484f58" }}>
                    #{ex.id}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#cdd9e5" }}>
                    {/* 優先顯示 sop_name，沒有就 fallback 到 sop_id */}
                    <span title={ex.sop_id}>{ex.sop_name || ex.sop_id}</span>
                  </td>
                  <td
                    style={{
                      padding: "8px 12px",
                      color: "#8b949e",
                      fontFamily: "monospace",
                    }}
                  >
                    {ex.device_id || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#8b949e" }}>
                    {ex.operator || "—"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#8b949e" }}>
                    {ex.test_started_at || ex.created_at}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {/* 修改：改用 axios blob 下載，帶 auth header */}
                    <button
                      onClick={() => downloadCsv(ex.id, ex.sop_id)}
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
