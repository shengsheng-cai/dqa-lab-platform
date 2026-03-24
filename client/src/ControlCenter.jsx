import { useState, useEffect } from "react";
import api from "./api";
import SOPPage from "./SOPPage";
import FixturePage from "./FixturePage";
import UsersPage from "./UsersPage";
import ErrorLog from "./ErrorLog";
import RightPanel from "./components/control/RightPanel";

const DEVICE_IDS = ["CH-01", "CH-02", "CH-03", "CH-04", "CH-05"];

const STATUS_CONFIG = {
  OFFLINE:   { color: "#484f58", label: "OFFLINE" },
  IDLE:      { color: "#8b949e", label: "IDLE" },
  RUNNING:   { color: "#3fb950", label: "RUNNING" },
  PAUSED:    { color: "#f0a500", label: "PAUSED" },
  FINISHING: { color: "#58a6ff", label: "FINISHING" },
  EMERGENCY: { color: "#f85149", label: "EMERGENCY" },
};

// ── TopBar ────────────────────────────────────────────────────────────────────

function TopBar({ devices, fixtureSummary, displayName, role, onLogout }) {
  const running   = devices.filter((d) => d.status === "RUNNING").length;
  const emergency = devices.filter((d) => d.status === "EMERGENCY").length;
  const idle      = devices.filter((d) => d.status === "IDLE").length;

  const Stat = ({ label, value, color }) => (
    <span style={{ fontSize: 12, color: "#8b949e", whiteSpace: "nowrap" }}>
      {label}：
      <span style={{ color: color || "#cdd9e5", fontWeight: 600 }}>{value}</span>
    </span>
  );

  const roleName =
    role === "admin" ? "管理者" :
    role === "keeper" ? "保管人" :
    role === "engineer" ? "工程師" : "訪客";
  const roleColor =
    role === "admin" ? "#3fb950" :
    role === "keeper" ? "#58a6ff" : "#8b949e";
  const roleBg =
    role === "admin" ? "#1f3a1f" :
    role === "keeper" ? "#1f2f3a" : "#21262d";

  return (
    <div
      style={{
        height: 40,
        background: "#161b22",
        borderBottom: "1px solid #30363d",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        gap: 14,
        flexShrink: 0,
      }}
    >
      <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 14, marginRight: 4 }}>
        DQA Lab
      </span>

      <div style={{ display: "flex", gap: 12, flex: 1 }}>
        <Stat label="執行中" value={running} color="#3fb950" />
        <Stat label="緊急"   value={emergency} color={emergency > 0 ? "#f85149" : "#8b949e"} />
        <Stat label="待機"   value={idle} />
        <span style={{ color: "#30363d" }}>│</span>
        <Stat label="治具借出"  value={fixtureSummary.total_loaned ?? "—"} color="#f0a500" />
        <Stat
          label="今日到期"
          value={fixtureSummary.due_today ?? "—"}
          color={(fixtureSummary.due_today ?? 0) > 0 ? "#f0a500" : "#8b949e"}
        />
        <Stat
          label="逾期未還"
          value={fixtureSummary.overdue ?? "—"}
          color={(fixtureSummary.overdue ?? 0) > 0 ? "#f85149" : "#8b949e"}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {displayName && (
          <span style={{ color: "#8b949e", fontSize: 12 }}>
            {displayName}
            <span
              style={{
                marginLeft: 5, fontSize: 10, padding: "1px 5px",
                borderRadius: 3, background: roleBg, color: roleColor,
              }}
            >
              {roleName}
            </span>
          </span>
        )}
        <button
          onClick={onLogout}
          style={{
            color: "#8b949e", background: "transparent", border: "1px solid #30363d",
            fontSize: 11, padding: "3px 10px", borderRadius: 5, cursor: "pointer",
          }}
        >
          登出
        </button>
      </div>
    </div>
  );
}

// ── DeviceCard ────────────────────────────────────────────────────────────────

function useCountdown(estimatedEndAt) {
  const [remaining, setRemaining] = useState(null);
  useEffect(() => {
    if (!estimatedEndAt) { setRemaining(null); return; }
    const calc = () => {
      const diff = new Date(estimatedEndAt) - new Date();
      setRemaining(Math.max(0, Math.floor(diff / 1000)));
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [estimatedEndAt]);
  return remaining;
}

function fmtRemaining(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function DeviceCard({ device, isSelected, onClick }) {
  const cfg = STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE;
  const remaining = useCountdown(device.estimated_end_at);
  const isActive    = device.status === "RUNNING" || device.status === "PAUSED";
  const isEmergency = device.status === "EMERGENCY";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${isSelected ? cfg.color : isEmergency ? "#f8514944" : "#30363d"}`,
        background: isEmergency ? "#2d0f0f" : isSelected ? "#161b22" : "transparent",
        cursor: "pointer",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cdd9e5" }}>{device.device_id}</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
      </div>

      {isActive && (
        <div style={{ marginTop: 3 }}>
          <div style={{ fontSize: 10, color: "#8b949e" }}>
            {device.temperature != null ? `${device.temperature}°C` : "—"}
          </div>
          {device.running_sop_name && device.running_sop_name !== "STANDBY" && (
            <div
              style={{
                fontSize: 9, color: "#484f58",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: 130,
              }}
            >
              {device.running_sop_name}
            </div>
          )}
          {remaining !== null && (
            <div style={{ fontSize: 9, color: "#58a6ff" }}>剩 {fmtRemaining(remaining)}</div>
          )}
        </div>
      )}

      {isEmergency && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>⚠ 緊急停止</div>
      )}
    </div>
  );
}

// ── LeftPanel ─────────────────────────────────────────────────────────────────

function LeftPanel({ devices, selectedDevice, onSelectDevice, onSwitchTab }) {
  const [recordsOpen, setRecordsOpen] = useState(false);

  return (
    <div
      style={{
        width: 155,
        flexShrink: 0,
        borderRight: "1px solid #30363d",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "7px 10px 4px",
          fontSize: 10,
          color: "#484f58",
          fontWeight: 600,
          letterSpacing: 1,
          flexShrink: 0,
        }}
      >
        設備狀態
      </div>

      <div
        style={{
          flex: 1,
          padding: "0 8px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          overflowY: "auto",
        }}
      >
        {devices.map((d) => (
          <DeviceCard
            key={d.device_id}
            device={d}
            isSelected={d.device_id === selectedDevice}
            onClick={() => onSelectDevice(d.device_id)}
          />
        ))}
      </div>

      {/* 紀錄收合 */}
      <div style={{ borderTop: "1px solid #30363d", flexShrink: 0 }}>
        <button
          onClick={() => setRecordsOpen((v) => !v)}
          style={{
            width: "100%", padding: "7px 10px", background: "transparent",
            border: "none", color: "#8b949e", fontSize: 11, fontWeight: 600,
            cursor: "pointer", textAlign: "left",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}
        >
          紀錄 <span style={{ fontSize: 9 }}>{recordsOpen ? "▲" : "▼"}</span>
        </button>
        {recordsOpen && (
          <div style={{ padding: "0 10px 8px", display: "flex", flexDirection: "column", gap: 3 }}>
            {[
              { label: "異常紀錄", tab: "errors" },
              { label: "執行紀錄", tab: "executions" },
            ].map(({ label, tab }) => (
              <div
                key={label}
                onClick={() => onSwitchTab(tab)}
                style={{ fontSize: 11, color: "#58a6ff", padding: "3px 2px", cursor: "pointer" }}
              >
                {label}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ExecutionList ─────────────────────────────────────────────────────────────

function fmtDatetime(str) {
  if (!str) return "—";
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  } catch { return str; }
}

function ExecutionList({ active }) {
  const [executions, setExecutions] = useState([]);
  const [downloading, setDownloading] = useState(null);

  useEffect(() => {
    if (!active) return;
    const fetch_ = () =>
      api.get("/api/reports/list").then((r) => setExecutions(r.data)).catch(() => {});
    fetch_();
    const t = setInterval(fetch_, 60000);
    return () => clearInterval(t);
  }, [active]);

  const downloadReport = async (ex) => {
    if (downloading) return;
    setDownloading(ex.id);
    try {
      const res = await api.get(`/api/reports/csv/${ex.id}`, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0,10).replace(/-/g,"");
      a.download = `${ex.device_id}_${ex.sop_id || "report"}_${date}_${ex.id}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (_) {} finally { setDownloading(null); }
  };

  const thStyle = { padding: "6px 12px", textAlign: "left", color: "#8b949e", fontWeight: 600, fontSize: 12 };
  const tdStyle = { padding: "8px 12px", fontSize: 12 };

  return (
    <div style={{ backgroundColor: "#0d1117", color: "#cdd9e5", height: "100%", overflowY: "auto", padding: "20px 24px", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, borderBottom: "1px solid #30363d", paddingBottom: 14, marginBottom: 20 }}>
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 18 }}>📋 執行紀錄</span>
        <span style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "#21262d", color: "#8b949e" }}>{executions.length} 筆</span>
      </div>
      {executions.length === 0 ? (
        <div style={{ color: "#484f58", textAlign: "center", padding: "40px 0" }}>尚無執行紀錄</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d" }}>
              {["ID", "測試名稱", "設備", "執行人員", "測試開始", "報告"].map((h) => (
                <th key={h} style={thStyle}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {executions.map((ex) => (
              <tr key={ex.id} style={{ borderBottom: "1px solid #21262d" }}>
                <td style={{ ...tdStyle, color: "#484f58" }}>#{ex.id}</td>
                <td style={{ ...tdStyle, color: "#cdd9e5" }}><span title={ex.sop_id}>{ex.sop_name || ex.sop_id}</span></td>
                <td style={{ ...tdStyle, color: "#8b949e", fontFamily: "monospace" }}>{ex.device_id || "—"}</td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>{ex.operator || "—"}</td>
                <td style={{ ...tdStyle, color: "#8b949e" }}>{fmtDatetime(ex.test_started_at || ex.created_at)}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => downloadReport(ex)}
                    disabled={downloading === ex.id}
                    style={{
                      padding: "3px 10px", fontSize: 11, borderRadius: 4, cursor: "pointer",
                      background: "transparent", border: "1px solid #30363d", color: "#58a6ff",
                      opacity: downloading === ex.id ? 0.5 : 1,
                    }}
                  >
                    {downloading === ex.id ? "⏳" : "📥 CSV"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── CenterPanel ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "device",   label: "設備" },
  { key: "fixture",  label: "治具" },
  { key: "schedule", label: "排程" },
  { key: "users",    label: "人員管理", adminOnly: true },
];

function CenterPanel({ role, activeTab, setActiveTab, selectedDevice }) {
  const visibleTabs = TABS.filter((t) => !t.adminOnly || role === "admin");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Tab bar */}
      <div
        style={{
          display: "flex", gap: 0, padding: "0 12px",
          borderBottom: "1px solid #30363d", flexShrink: 0,
          background: "#0d1117",
        }}
      >
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: "transparent", border: "none",
              borderBottom: activeTab === t.key ? "2px solid #58a6ff" : "2px solid transparent",
              color: activeTab === t.key ? "#cdd9e5" : "#8b949e",
              transition: "color .15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content（display:none 保留狀態）*/}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ display: activeTab === "device" ? "block" : "none", height: "100%" }}>
          <SOPPage active={activeTab === "device"} externalDevice={selectedDevice} />
        </div>
        <div style={{ display: activeTab === "fixture" ? "block" : "none", height: "100%" }}>
          <FixturePage active={activeTab === "fixture"} role={role} />
        </div>
        <div
          style={{
            display: activeTab === "schedule" ? "flex" : "none",
            height: "100%", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: 8,
          }}
        >
          <div style={{ fontSize: 28, color: "#30363d" }}>🗓</div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#484f58" }}>排程系統</div>
          <div style={{ fontSize: 12, color: "#30363d" }}>開發中，敬請期待</div>
        </div>
        {role === "admin" && (
          <div style={{ display: activeTab === "users" ? "block" : "none", height: "100%" }}>
            <UsersPage active={activeTab === "users"} />
          </div>
        )}
        <div style={{ display: activeTab === "errors" ? "block" : "none", height: "100%" }}>
          <ErrorLog active={activeTab === "errors"} />
        </div>
        <div style={{ display: activeTab === "executions" ? "block" : "none", height: "100%" }}>
          <ExecutionList active={activeTab === "executions"} />
        </div>
      </div>
    </div>
  );
}

// ── ControlCenter ─────────────────────────────────────────────────────────────

export default function ControlCenter({ role, displayName, onLogout }) {
  const [devices, setDevices] = useState(
    DEVICE_IDS.map((id) => ({ device_id: id, status: "OFFLINE", temperature: null }))
  );
  const [fixtureSummary, setFixtureSummary] = useState({});
  const [activeTab, setActiveTab] = useState("device");
  const [selectedDevice, setSelectedDevice] = useState("CH-01");

  // 輪詢設備狀態（10s）
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await api.get("/api/devices");
        setDevices(res.data);
      } catch (_) {}
    };
    fetchDevices();
    const t = setInterval(fetchDevices, 10000);
    return () => clearInterval(t);
  }, []);

  // 輪詢治具摘要（30s）
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await api.get("/api/fixtures/summary");
        setFixtureSummary(res.data);
      } catch (_) {}
    };
    fetchSummary();
    const t = setInterval(fetchSummary, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <TopBar
        devices={devices}
        fixtureSummary={fixtureSummary}
        displayName={displayName}
        role={role}
        onLogout={onLogout}
      />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LeftPanel
          devices={devices}
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
          onSwitchTab={setActiveTab}
        />
        <CenterPanel
          role={role}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedDevice={selectedDevice}
        />
        <RightPanel />
      </div>
    </div>
  );
}
