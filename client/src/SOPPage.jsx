import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
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
import "./SOPPage.css";

const API = "http://localhost:8000";
const DEVICE_IDS = [
  "KSON_CH01",
  "KSON_CH02",
  "KSON_CH03",
  "KSON_CH04",
  "KSON_CH05",
];

const SAFETY_CHECKS = [
  "測試孔是否用塑膠塞及抹布將兩邊塞緊，以免水氣跑出。",
  "線材類治具等移至上方後再塞，以免水氣往利用線材類治具流至設備上造成毀損。",
  "抹布末端勿留至 Sample 上，以免低溫轉高溫時水氣流至 Sample 上導致燒燬。",
  "電源頭請放在治具、線材類上或懸空在鐵架下方，勿放在鐵架上。",
];

const ACTIVE_STATUSES = ["RUNNING", "PAUSED"];

function toElapsedMin(startedAt, fullTime) {
  if (!startedAt || !fullTime) return null;
  try {
    const start = new Date(startedAt);
    const point = new Date(fullTime);
    return Math.round((point - start) / 60000);
  } catch {
    return null;
  }
}

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m`;
}

function generateSP(sop) {
  if (!sop) return [];
  const ramp = sop.ramp_rate || 1;
  const high = sop.high_temperature ?? sop.target_temperature ?? 25;
  const low = sop.low_temperature ?? 25;
  const dwell = (sop.dwell_time_hours || 1) * 60;
  const cycles = sop.cycles || 1;
  const ambientTemp = 25;
  const humiVal = sop.humidity_rh_percent ?? null;

  const pts = [];
  let t = 0;

  const pushRamp = (from, to) => {
    const steps = Math.max(1, Math.round(Math.abs(to - from) / ramp));
    for (let i = 1; i <= steps; i++) {
      pts.push({ min: t, sp_temp: from + (to - from) * (i / steps) });
      t++;
    }
  };

  const pushDwell = (temp, duration) => {
    for (let i = 0; i < duration; i++) {
      pts.push({ min: t, sp_temp: temp });
      t++;
    }
  };

  const isCycle = cycles > 1 && sop.low_temperature != null;

  if (isCycle) {
    pushRamp(ambientTemp, high);
    for (let c = 0; c < cycles; c++) {
      pushDwell(high, dwell);
      pushRamp(high, low);
      pushDwell(low, dwell);
      if (c < cycles - 1) pushRamp(low, high);
    }
    pushRamp(low, ambientTemp);
  } else {
    const startTemp = low < ambientTemp ? low : ambientTemp;
    const targetTemp = high !== ambientTemp ? high : low;
    pushRamp(startTemp, targetTemp);
    pushDwell(targetTemp, dwell);
    pushRamp(targetTemp, ambientTemp);
  }

  return pts.map((p) => ({
    ...p,
    sp_temp: Math.round(p.sp_temp * 10) / 10,
    sp_humi: p.sp_temp < 0 ? null : humiVal,
    label: fmtMin(p.min),
  }));
}

const STATUS_CONFIG = {
  OFFLINE: { color: "#484f58", bg: "#21262d" },
  IDLE: { color: "#8b949e", bg: "#21262d" },
  RUNNING: { color: "#3fb950", bg: "#0f2318" },
  PAUSED: { color: "#f0a500", bg: "#2d1f00" },
  FINISHING: { color: "#58a6ff", bg: "#0d1f33" },
  EMERGENCY: { color: "#f85149", bg: "#2d0f0f" },
};

const initDeviceState = () => ({
  activeSop: null,
  completedSteps: {},
  savedExecutionId: null,
  safetyChecked: [false, false, false, false],
  chartHistory: [],
  chartStartedAt: null,
  selectedStd: null,
  selectedVer: null,
  selectedTest: null,
});

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
    ["升降溫速率", `${test.ramp_rate} °C/min`],
    ["停留時間", `${test.dwell_time_hours} h`],
    ["循環次數", test.cycles ?? "—"],
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

const SelectGroup = ({ step, title, items, selected, onSelect, accent }) => {
  const isDone = !!selected;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: "50%",
            flexShrink: 0,
            background: isDone ? accent : "#21262d",
            border: `2px solid ${isDone ? accent : "#30363d"}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 800,
            color: isDone ? "#0d1117" : "#8b949e",
            transition: "all .2s",
          }}
        >
          {isDone ? "✓" : step}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: 0.5,
            color: isDone ? "#cdd9e5" : "#8b949e",
          }}
        >
          {title}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {items.map(([key, label]) => {
          const active = selected === key;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 11,
                cursor: "pointer",
                transition: "all .15s",
                border: `1px solid ${active ? accent : "#30363d"}`,
                background: active ? `${accent}22` : "#161b22",
                color: active ? accent : "#8b949e",
                fontWeight: active ? 700 : 400,
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function mergeSpPv(spData, pvData) {
  const map = {};
  spData.forEach((p) => {
    map[p.min] = { ...p };
  });
  pvData.forEach((p) => {
    if (p.min != null && map[p.min]) {
      map[p.min].pv_temp = p.temperature;
      map[p.min].pv_humi = p.humidity;
    }
  });
  return Object.values(map).sort((a, b) => a.min - b.min);
}

const TempChart = ({ sop, pvData, startedAt }) => {
  const spData = React.useMemo(() => generateSP(sop), [sop]);

  const pvWithMin = React.useMemo(() => {
    if (!pvData || !startedAt) return [];
    return pvData
      .map((p) => ({ ...p, min: toElapsedMin(startedAt, p.full_time) }))
      .filter((p) => p.min != null);
  }, [pvData, startedAt]);

  const merged = React.useMemo(
    () => mergeSpPv(spData, pvWithMin),
    [spData, pvWithMin],
  );

  if (spData.length === 0)
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

  const brushEnd = merged.length - 1;
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
            value: "Time (hr:min)",
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
        <YAxis
          yAxisId="humi"
          orientation="right"
          domain={[0, 100]}
          tick={{ fontSize: 9, fill: "#a5d6ff" }}
          width={28}
          tickFormatter={(v) => `${v}%`}
        />
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
          type="linear"
          dataKey="sp_temp"
          name="sp_temp"
          stroke="#555e6b"
          strokeWidth={1.5}
          strokeDasharray="5 3"
          dot={false}
          isAnimationActive={false}
          connectNulls
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
      </ComposedChart>
    </ResponsiveContainer>
  );
};

// fix: 加入 active prop，頁面隱藏時暫停輪詢
const SOPPage = ({ active = true }) => {
  const [selectedDevice, setSelectedDevice] = useState("KSON_CH01");
  const [allDevices, setAllDevices] = useState({});
  const [deviceStates, setDeviceStates] = useState(() =>
    Object.fromEntries(DEVICE_IDS.map((id) => [id, initDeviceState()])),
  );
  const [emergencyFlash, setEmergencyFlash] = useState(false);
  const [standardTree, setStandardTree] = useState({});
  const [treeLoaded, setTreeLoaded] = useState(false);
  const [startError, setStartError] = useState("");
  // fix: 防重複提交 saving state
  const [saving, setSaving] = useState(false);

  const lastHistoryMinuteRef = useRef(-1);

  const data = allDevices[selectedDevice] || {
    status: "OFFLINE",
    temperature: 0.0,
    humidity: 0.0,
    running_sop_name: "未連線",
    description: "等待連線...",
    timestamp: "--:--:--",
  };
  const ds = deviceStates[selectedDevice];

  const isActive = ACTIVE_STATUSES.includes(data.status);
  const isOffline = data.status === "OFFLINE";
  const isEmergency = data.status === "EMERGENCY";
  const canStop = isActive || isEmergency;
  const sc = STATUS_CONFIG[data.status] || STATUS_CONFIG.OFFLINE;

  const allChecked = ds.safetyChecked.every(Boolean);
  const totalSteps = ds.activeSop?.steps?.length ?? 0;
  const doneCnt = Object.values(ds.completedSteps).filter(Boolean).length;
  const allStepsDone = ds.activeSop && doneCnt === totalSteps;

  const { selectedStd, selectedVer, selectedTest } = ds;
  const stdData = selectedStd ? standardTree[selectedStd] : null;
  const verData = selectedVer ? stdData?.versions?.[selectedVer] : null;
  const testData = selectedTest ? verData?.tests?.[selectedTest] : null;
  const versionItems = stdData
    ? Object.entries(stdData.versions).map(([k, v]) => [k, v.label])
    : [];
  const testItems = verData
    ? Object.entries(verData.tests).map(([k, v]) => [k, v.name])
    : [];

  const updateDS = (deviceId, patch) => {
    setDeviceStates((prev) => ({
      ...prev,
      [deviceId]: { ...prev[deviceId], ...patch },
    }));
  };

  useEffect(() => {
    if (!isEmergency) {
      setEmergencyFlash(false);
      return;
    }
    const t = setInterval(() => setEmergencyFlash((f) => !f), 600);
    return () => clearInterval(t);
  }, [isEmergency]);

  useEffect(() => {
    axios
      .get(`${API}/api/sop/standards/tree`)
      .then((r) => {
        setStandardTree(r.data);
        setTreeLoaded(true);
      })
      .catch(() => setTreeLoaded(true));
  }, []);

  // fix: active 為 false 時不啟動 interval
  useEffect(() => {
    if (!active) return;

    const t = setInterval(() => {
      axios
        .get(`${API}/api/devices`)
        .then((r) => {
          const map = {};
          r.data.forEach((d) => {
            map[d.device_id] = d;
          });
          setAllDevices(map);

          setDeviceStates((prev) => {
            const next = { ...prev };
            DEVICE_IDS.forEach((id) => {
              const current = map[id];
              if (!current) return;
              const prevDS = prev[id];
              let restoredSop = prevDS.activeSop;

              if (!restoredSop && current.active_sop_json) {
                try {
                  const parsed = JSON.parse(current.active_sop_json);
                  restoredSop = parsed;
                } catch {
                  /* ignore */
                }
              }
              if (
                !current.active_sop_json &&
                prevDS.activeSop &&
                !["RUNNING", "PAUSED"].includes(current.status)
              ) {
                restoredSop = null;
              }
              next[id] = { ...prevDS, activeSop: restoredSop };
            });
            return next;
          });

          const now = new Date();
          const currentMinute = now.getHours() * 60 + now.getMinutes();
          if (
            now.getSeconds() < 10 &&
            currentMinute !== lastHistoryMinuteRef.current
          ) {
            lastHistoryMinuteRef.current = currentMinute;
            const selDevice = map[selectedDevice];
            if (selDevice?.started_at) {
              axios
                .get(`${API}/api/devices/${selectedDevice}/history`)
                .then((res) => {
                  setDeviceStates((prev) => ({
                    ...prev,
                    [selectedDevice]: {
                      ...prev[selectedDevice],
                      chartHistory: res.data,
                      chartStartedAt: selDevice.started_at,
                    },
                  }));
                })
                .catch(() => {});
            }
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [selectedDevice, active]);

  const startedAt = allDevices[selectedDevice]?.started_at;
  useEffect(() => {
    if (!startedAt) {
      updateDS(selectedDevice, { chartHistory: [], chartStartedAt: null });
      return;
    }
    axios
      .get(`${API}/api/devices/${selectedDevice}/history`)
      .then((res) => {
        updateDS(selectedDevice, {
          chartHistory: res.data,
          chartStartedAt: startedAt,
        });
      })
      .catch(() => {});
  }, [selectedDevice, startedAt]);

  const handleSelectStd = (key) =>
    updateDS(selectedDevice, {
      selectedStd: key,
      selectedVer: null,
      selectedTest: null,
    });
  const handleSelectVer = (key) =>
    updateDS(selectedDevice, { selectedVer: key, selectedTest: null });
  const handleSelectTest = (key) =>
    updateDS(selectedDevice, { selectedTest: key });

  const steps = ds.activeSop?.steps || [];

  // fix: isStepUnlocked 改為迭代，避免 O(n²) 遞迴
  const isStepUnlocked = (stepIndex) => {
    for (let i = stepIndex - 1; i >= 0; i--) {
      if (!steps[i].optional) {
        return !!ds.completedSteps[steps[i].step_id];
      }
    }
    return true;
  };

  const toggleStep = async (stepId, stepIndex) => {
    const newCompleted = { ...ds.completedSteps };
    if (newCompleted[stepId]) {
      steps.slice(stepIndex).forEach((s) => delete newCompleted[s.step_id]);
    } else {
      newCompleted[stepId] = true;
    }
    updateDS(selectedDevice, { completedSteps: newCompleted });

    try {
      await axios.post(`${API}/api/devices/${selectedDevice}/progress`, {
        completed: Object.values(newCompleted).filter(Boolean).length,
      });
    } catch (e) {
      console.error("[SOPPage] progress sync:", e);
    }
  };

  // fix: 直接從 standardTree 取 steps，不再打第二次 /api/sop/
  const startSop = async () => {
    if (!testData) return;
    setStartError("");
    try {
      await axios.post(`${API}/api/sop/start`, {
        sop_id: testData.sop_id,
        device_id: selectedDevice,
      });
      const steps = testData.steps || [];
      if (steps.length === 0) {
        setStartError("⚠️ SOP 步驟資料不完整，請確認後端 SOP 設定後重試。");
        return;
      }
      updateDS(selectedDevice, {
        activeSop: { ...testData, steps },
        completedSteps: {},
        savedExecutionId: null,
      });
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || "未知錯誤";
      setStartError(`❌ 啟動程序失敗：${msg}。請確認後端是否正常運作。`);
    }
  };

  const handleAction = async (type) => {
    try {
      await axios.post(`${API}/api/stop/${selectedDevice}/${type}`);
      if (type === "normal" || type === "emergency") {
        updateDS(selectedDevice, {
          activeSop: null,
          completedSteps: {},
          savedExecutionId: null,
          safetyChecked: [false, false, false, false],
        });
        setStartError("");
      }
    } catch (e) {
      console.error("[SOPPage] action:", e);
    }
  };

  // fix: 防重複提交
  const saveExecution = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const stepPayload = ds.activeSop.steps.map((s) => ({
        step_id: s.step_id,
        completed: !!ds.completedSteps[s.step_id],
        parameters: null,
      }));
      const res = await axios.post(`${API}/api/sop-executions/`, {
        sop_id: ds.activeSop.sop_id,
        device_id: selectedDevice,
        test_started_at: data.started_at || null,
        steps: stepPayload,
      });
      updateDS(selectedDevice, { savedExecutionId: res.data.id });
    } catch {
      setStartError("❌ 儲存失敗，請確認後端連線。");
    } finally {
      setSaving(false);
    }
  };

  const downloadReport = () =>
    window.open(`${API}/api/reports/csv/${ds.savedExecutionId}`, "_blank");

  return (
    <div className="sop-page-layout">
      <aside className="monitor-side">
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
              const active = id === selectedDevice;
              return (
                <button
                  key={id}
                  onClick={() => setSelectedDevice(id)}
                  style={{
                    padding: "5px 10px",
                    borderRadius: 6,
                    fontSize: 11,
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontWeight: active ? 700 : 400,
                    border: `1px solid ${active ? s.color : "#30363d"}`,
                    background: active ? s.bg : "#0d1117",
                    color: active ? s.color : "#8b949e",
                    transition: "all .15s",
                  }}
                >
                  {id.replace("KSON_", "")}
                </button>
              );
            })}
          </div>
        </div>

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

        {isActive &&
          ds.activeSop &&
          data.started_at &&
          (() => {
            const sop = ds.activeSop;
            const startedAt = new Date(data.started_at);
            const now = new Date();
            const elapsedMin = Math.floor((now - startedAt) / 60000);
            const spData = generateSP(sop);
            const totalMin =
              spData.length > 0 ? spData[spData.length - 1].min : 0;
            const endTime = new Date(startedAt.getTime() + totalMin * 60000);
            const freeTimeMin = Math.max(0, totalMin - elapsedMin);
            const freeH = Math.floor(freeTimeMin / 60);
            const freeM = freeTimeMin % 60;
            const totalStepCount = sop.steps?.length ?? 0;
            const cycles = sop.cycles ?? 1;
            const fmt = (d) =>
              `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
              ["Cycle", `0001/${String(cycles).padStart(4, "0")}`],
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
                    <span style={{ color: "#484f58", fontSize: 11 }}>
                      {label}
                    </span>
                    <span
                      style={{
                        color: "#cdd9e5",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            );
          })()}

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

      <main className="control-side">
        <div className="scroll-wrapper">
          <section
            className="operation-box"
            style={
              isEmergency
                ? {
                    borderColor: emergencyFlash ? "#f85149" : "#30363d",
                    background: emergencyFlash ? "#1a0a0a" : "#161b22",
                    transition: "all 0.3s",
                  }
                : {}
            }
          >
            <div className="box-header">
              <span className="pulse-icon" />
              <h2>系統控制面板</h2>
              <span
                style={{
                  marginLeft: "auto",
                  padding: "2px 10px",
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 700,
                  color: sc.color,
                  background: sc.bg,
                  border: `1px solid ${sc.color}44`,
                }}
              >
                {selectedDevice} — {data.status}
              </span>
            </div>
            <p className="task-desc">
              {isOffline
                ? "⚠️ 後端未連線，請確認伺服器是否正常啟動。"
                : isEmergency
                  ? "🚨 緊急停止已觸發，請確認設備安全後按正常停止。"
                  : data.description}
            </p>
            <div className="btn-group-row">
              <button
                className="ctrl-btn amber"
                onClick={() => handleAction("pause")}
                disabled={!isActive}
                style={{
                  opacity: isActive ? 1 : 0.35,
                  cursor: isActive ? "pointer" : "not-allowed",
                }}
              >
                ⏸ 暫停切換
              </button>
              <button
                className="ctrl-btn grey"
                onClick={() => handleAction("normal")}
                disabled={!canStop}
                style={{
                  opacity: canStop ? 1 : 0.35,
                  cursor: canStop ? "pointer" : "not-allowed",
                }}
              >
                ⏹ 正常停止
              </button>
              <button
                className="ctrl-btn red"
                onClick={() => handleAction("emergency")}
                disabled={isOffline}
                style={{
                  opacity: isOffline ? 0.35 : 1,
                  cursor: isOffline ? "not-allowed" : "pointer",
                }}
              >
                🚨 緊急停止
              </button>
            </div>
          </section>

          {isActive && ds.activeSop && (
            <section
              className="operation-box"
              style={{ borderLeft: "3px solid #58a6ff" }}
            >
              <div className="box-header">
                <span>📋</span>
                <h2 style={{ fontSize: 13 }}>{ds.activeSop.name}</h2>
              </div>
              <p style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}>
                請依序確認每個步驟已完成：
              </p>
              {steps.map((step, idx) => {
                const unlocked = isStepUnlocked(idx);
                const checked = !!ds.completedSteps[step.step_id];
                return (
                  <label
                    key={step.step_id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 10,
                      marginBottom: 12,
                      cursor: unlocked ? "pointer" : "not-allowed",
                      color: checked
                        ? "#57ab5a"
                        : unlocked
                          ? "#cdd9e5"
                          : "#484f58",
                      opacity: unlocked ? 1 : 0.4,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!unlocked}
                      onChange={() => unlocked && toggleStep(step.step_id, idx)}
                      style={{
                        marginTop: 3,
                        accentColor: "#57ab5a",
                        flexShrink: 0,
                      }}
                    />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>
                        Step {step.step_id}. {step.name}
                        {step.optional && (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 10,
                              padding: "1px 6px",
                              background: "#21262d",
                              color: "#8b949e",
                              borderRadius: 4,
                            }}
                          >
                            Optional
                          </span>
                        )}
                      </div>
                      <div
                        style={{ fontSize: 11, color: "#8b949e", marginTop: 2 }}
                      >
                        {step.description}
                      </div>
                    </div>
                  </label>
                );
              })}
              <div style={{ marginTop: 8, marginBottom: 4 }}>
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
                      background: allStepsDone ? "#57ab5a" : "#58a6ff",
                      width: `${totalSteps > 0 ? (doneCnt / totalSteps) * 100 : 0}%`,
                      transition: "width 0.3s ease",
                    }}
                  />
                </div>
                <div
                  style={{
                    color: allStepsDone ? "#57ab5a" : "#8b949e",
                    fontSize: 12,
                    marginTop: 6,
                  }}
                >
                  {doneCnt} / {totalSteps} 步驟完成{allStepsDone && " ✅"}
                </div>
              </div>
              {allStepsDone && !ds.savedExecutionId && (
                <button
                  onClick={saveExecution}
                  disabled={saving}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "10px",
                    background: saving ? "#21262d" : "#238636",
                    color: saving ? "#484f58" : "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: saving ? "not-allowed" : "pointer",
                    fontWeight: 700,
                    fontSize: 14,
                    opacity: saving ? 0.6 : 1,
                  }}
                >
                  {saving ? "⏳ 儲存中..." : "💾 儲存執行紀錄"}
                </button>
              )}
              {ds.savedExecutionId && (
                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      padding: 10,
                      background: "#0f2318",
                      color: "#57ab5a",
                      borderRadius: 6,
                      fontSize: 13,
                      textAlign: "center",
                      fontWeight: 700,
                    }}
                  >
                    ✅ 紀錄已儲存（ID: {ds.savedExecutionId}）
                  </div>
                  <button
                    onClick={downloadReport}
                    style={{
                      padding: "10px",
                      background: "#1f6feb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    📥 下載 CSV 測試報告（ISO 17025）
                  </button>
                </div>
              )}
            </section>
          )}

          {!isActive && (
            <>
              <section
                className="operation-box"
                style={{ borderLeft: "3px solid #58a6ff" }}
              >
                <div className="box-header">
                  <span>🔬</span>
                  <h2>選擇測試標準</h2>
                </div>
                {!treeLoaded ? (
                  <div
                    style={{ color: "#484f58", fontSize: 12, padding: "8px 0" }}
                  >
                    ⏳ 載入標準資料中...
                  </div>
                ) : (
                  <SelectGroup
                    step={1}
                    title="選擇法規"
                    accent="#58a6ff"
                    items={Object.entries(standardTree).map(([k, v]) => [
                      k,
                      v.label,
                    ])}
                    selected={selectedStd}
                    onSelect={handleSelectStd}
                  />
                )}
                {stdData && (
                  <>
                    <div
                      style={{
                        borderTop: "1px solid #21262d",
                        margin: "4px 0 14px",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {stdData.description}
                    </div>
                    <SelectGroup
                      step={2}
                      title="選擇版本 / Class"
                      accent="#f0a500"
                      items={versionItems}
                      selected={selectedVer}
                      onSelect={handleSelectVer}
                    />
                  </>
                )}
                {verData && (
                  <>
                    <div
                      style={{
                        borderTop: "1px solid #21262d",
                        margin: "4px 0 14px",
                      }}
                    />
                    <div
                      style={{
                        fontSize: 11,
                        color: "#8b949e",
                        marginBottom: 10,
                        lineHeight: 1.5,
                      }}
                    >
                      {verData.description}
                    </div>
                    <SelectGroup
                      step={3}
                      title="選擇測試條件"
                      accent="#57ab5a"
                      items={testItems}
                      selected={selectedTest}
                      onSelect={handleSelectTest}
                    />
                  </>
                )}
                {testData && <ConditionCard test={testData} />}
              </section>

              {testData && (
                <section
                  className="operation-box"
                  style={{ borderLeft: "3px solid #f0a500" }}
                >
                  <div className="box-header">
                    <span>⚠️</span>
                    <h2>上架驗證注意事項</h2>
                  </div>
                  <p
                    style={{ color: "#8b949e", fontSize: 12, marginBottom: 14 }}
                  >
                    啟動測試前，請確認以下所有項目：
                  </p>
                  {SAFETY_CHECKS.map((item, i) => (
                    <label
                      key={i}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        marginBottom: 10,
                        cursor: "pointer",
                        color: ds.safetyChecked[i] ? "#57ab5a" : "#cdd9e5",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={ds.safetyChecked[i]}
                        onChange={() => {
                          const u = [...ds.safetyChecked];
                          u[i] = !u[i];
                          updateDS(selectedDevice, { safetyChecked: u });
                        }}
                        style={{
                          marginTop: 3,
                          accentColor: "#57ab5a",
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ fontSize: 12 }}>
                        {i + 1}. {item}
                      </span>
                    </label>
                  ))}
                  {allChecked ? (
                    <p style={{ color: "#57ab5a", fontSize: 12, marginTop: 6 }}>
                      ✅ 所有注意事項已確認，可以啟動測試
                    </p>
                  ) : (
                    <p style={{ color: "#f0a500", fontSize: 12, marginTop: 6 }}>
                      ⚠️ 請確認所有注意事項後才能啟動測試
                    </p>
                  )}
                  <button
                    onClick={startSop}
                    disabled={!allChecked}
                    style={{
                      marginTop: 14,
                      width: "100%",
                      padding: "12px",
                      background: allChecked ? "#238636" : "#21262d",
                      color: allChecked ? "#fff" : "#484f58",
                      border: `1px solid ${allChecked ? "#2ea043" : "#30363d"}`,
                      borderRadius: 6,
                      cursor: allChecked ? "pointer" : "not-allowed",
                      fontWeight: 700,
                      fontSize: 14,
                      transition: "all .2s",
                    }}
                  >
                    {allChecked
                      ? `🚀 啟動 ${selectedDevice}：${testData.name}`
                      : "請先確認所有注意事項"}
                  </button>
                  {startError && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "10px 14px",
                        background: "#2d0f0f",
                        border: "1px solid #f8514944",
                        borderRadius: 6,
                        color: "#f85149",
                        fontSize: 12,
                      }}
                    >
                      {startError}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default SOPPage;
