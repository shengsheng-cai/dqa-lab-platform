import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "./api";
import { useDeviceWebSocket } from "./useDeviceWebSocket";
import { useToast } from "./components/Toast";
import SOPPage from "./SOPPage";
import FixturePage from "./FixturePage";
import SchedulePage from "./SchedulePage";
import UsersPage from "./UsersPage";
import ErrorLog from "./ErrorLog";
import ExecutionList from "./ExecutionList";
import MaintenancePage from "./MaintenancePage";
import RightPanel from "./components/control/RightPanel";
import SensorQcModal from "./components/control/SensorQcModal";
import AuditLog from "./components/control/AuditLog";
import TopBar from "./components/control/TopBar";
import { conditionLabel } from "./components/control/DeviceCard";
import TabBadge from "./components/control/TabBadge";
import LeftPanel from "./components/control/LeftPanel";
import { DEVICE_IDS, POLL_DEVICES_MS, POLL_FIXTURE_MS, POLL_GENERAL_MS, IDLE_STATUS } from "./constants";

const TAB_TO_PATH = {
  device: "/",
  fixture: "/fixtures",
  schedule: "/schedule",
  maintenance: "/maintenance",
  users: "/users",
};
const PATH_TO_TAB = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([k, v]) => [v, k])
);

function toDeviceMap(schedules) {
  const map = {};
  schedules.forEach(s => { if (s.device_id) map[s.device_id] = s; });
  return map;
}

// ── BannerConfirmBtn ──────────────────────────────────────────────────────────

function BannerConfirmBtn({ device, schedule, onConfirmCondition }) {
  const [busy, setBusy] = useState(false);
  const { label } = conditionLabel(schedule, `${device.device_id} `);
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onConfirmCondition(schedule.id); } finally { setBusy(false); } }}
      style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: busy ? "#2d2600" : "#f0a50022", border: "1px solid #f0a500", color: "#f0a500", cursor: busy ? "not-allowed" : "pointer" }}
    >
      {busy ? "處理中..." : label}
    </button>
  );
}

// ── CenterPanel ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "device", label: "設備" },
  { key: "fixture", label: "治具" },
  { key: "schedule", label: "排程" },
  { key: "maintenance", label: "維護" },
  { key: "users", label: "人員管理" },
];

function CenterPanel({ role, userId, activeTab, setActiveTab, selectedDevice, scheduleInitConds, handleInitCondsConsumed, onOpenExecutions, devices, pendingByDevice, onConfirmCondition, scheduleCounts, onCalibrationChange }) {
  const visibleTabs = TABS.filter((t) =>
    (!t.adminOnly || role === "admin") && (!t.guestHidden || role !== "guest")
  );

  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  const waitingDevices = useMemo(
    () => role === "admin" && pendingByDevice
      ? devices.filter(d => d.status === IDLE_STATUS && pendingByDevice[d.device_id])
      : [],
    [role, devices, pendingByDevice]
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, padding: "0 12px", borderBottom: "1px solid #30363d", flexShrink: 0, background: "#0d1117" }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: activeTab === t.key ? "2px solid #58a6ff" : "2px solid transparent", color: activeTab === t.key ? "#cdd9e5" : "#8b949e", transition: "color .15s" }}
          >
            {t.label}
            {t.key === "schedule" && <TabBadge count={scheduleCounts.pending} bg="#e3b341" />}
          </button>
        ))}
      </div>

      {/* 等待確認 Banner */}
      {waitingDevices.length > 0 && (
        <div className="banner-flash" style={{ flexShrink: 0, background: "#1a1500", borderBottom: "1px solid #f0a500", padding: "6px 12px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: "#f0a500", fontWeight: 700, marginRight: 4 }}>⚠ 等待確認</span>
          {waitingDevices.map(d => (
            <BannerConfirmBtn key={d.device_id} device={d} schedule={pendingByDevice[d.device_id]} onConfirmCondition={onConfirmCondition} />
          ))}
        </div>
      )}

      {/* Tab content（display:none 保留狀態）*/}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ display: activeTab === "device" ? "block" : "none", height: "100%" }}>
          <SOPPage active={activeTab === "device"} externalDevice={selectedDevice} onOpenExecutions={onOpenExecutions} />
        </div>
        <div style={{ display: activeTab === "fixture" ? "block" : "none", height: "100%" }}>
          <FixturePage active={activeTab === "fixture"} role={role} />
        </div>
        <div style={{ display: activeTab === "schedule" ? "block" : "none", height: "100%" }}>
          <SchedulePage
            active={activeTab === "schedule"}
            role={role}
            userId={userId}
            initConditions={scheduleInitConds}
            onInitCondsConsumed={handleInitCondsConsumed}
            liveDeviceStatuses={Object.fromEntries(devices.map(d => [d.device_id, (d.is_blocked && d.status === IDLE_STATUS) ? "BLOCKED" : d.status]))}
          />
        </div>
        <div style={{ display: activeTab === "maintenance" ? "block" : "none", height: "100%" }}>
          <MaintenancePage active={activeTab === "maintenance"} role={role} onCalibrationChange={onCalibrationChange} />
        </div>
        <div style={{ display: activeTab === "users" ? "block" : "none", height: "100%" }}>
          <UsersPage active={activeTab === "users"} role={role} />
        </div>
      </div>
    </div>
  );
}

// ── ControlCenter ─────────────────────────────────────────────────────────────

export default function ControlCenter({ role, userId, displayName, onLogout }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const activeTab = PATH_TO_TAB[pathname] ?? "device";
  const setActiveTab = (key) => navigate(TAB_TO_PATH[key] ?? "/");

  const { devices } = useDeviceWebSocket();
  const [pendingByDevice, setPendingByDevice] = useState({});
  const pendingJsonRef = useRef(null);
  const [fixtureSummary, setFixtureSummary] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(DEVICE_IDS[0]);
  const [aiOpen, setAiOpen] = useState(false);
  const [scheduleInitConds, setScheduleInitConds] = useState(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsSubTab, setRecordsSubTab] = useState("errors");
  const [sensorModalDevice, setSensorModalDevice] = useState(null);
  const [calibrationStatusMap, setCalibrationStatusMap] = useState({});
  const handleInitCondsConsumed = useCallback(() => setScheduleInitConds(null), []);
  const { showToast } = useToast();

  const handleApplySchedule = useCallback((sop_ids) => {
    setActiveTab("schedule");
    setScheduleInitConds(sop_ids);
    showToast(`已帶入 ${sop_ids.length} 個條件，請至排程頁面確認`, "info");
  }, [showToast]);

  // 輪詢進行中排程（3s），建 device_id → schedule map
  useEffect(() => {
    if (role === "guest") return;
    const fetch = async () => {
      try {
        const res = await api.get("/api/schedules?status=進行中");
        const map = toDeviceMap(res.data);
        const json = JSON.stringify(map);
        if (json !== pendingJsonRef.current) {
          pendingJsonRef.current = json;
          setPendingByDevice(map);
        }
      } catch (_) {}
    };
    fetch();
    const t = setInterval(fetch, POLL_DEVICES_MS);
    return () => clearInterval(t);
  }, [role]);

  const handleConfirmCondition = useCallback(async (scheduleId) => {
    try {
      const res = await api.post(`/api/schedules/${scheduleId}/confirm-condition`);
      if (res.data.status === "completed") {
        showToast("排程全部條件完成！", "success");
      } else {
        showToast(`已啟動下一條件：${res.data.sop_id}`, "success");
      }
      const r = await api.get("/api/schedules?status=進行中");
      const map = toDeviceMap(r.data);
      pendingJsonRef.current = JSON.stringify(map);
      setPendingByDevice(map);
    } catch (e) {
      showToast(e.response?.data?.detail || "操作失敗", "error", 3000, e.response?.data?.hint);
    }
  }, [showToast]);

  const [scheduleCounts, setScheduleCounts] = useState({ pending: 0, confirmed: 0, running: 0, done: 0 });

  useEffect(() => {
    if (role === "guest") return;
    const fetch = () => {
      api.get("/api/schedules").then((res) => {
        const all = res.data;
        setScheduleCounts({
          pending: all.filter(s => s.status === "待審核").length,
          confirmed: all.filter(s => s.status === "已確認").length,
          running: all.filter(s => s.status === "進行中").length,
          done: all.filter(s => s.status === "已完成").length,
        });
      }).catch(() => {});
    };
    fetch();
    const timer = setInterval(fetch, POLL_GENERAL_MS);
    return () => clearInterval(timer);
  }, [role]);

  // 輪詢治具摘要（30s）
  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await api.get("/api/fixtures/summary");
        setFixtureSummary(res.data);
      } catch (_) {}
    };
    fetchSummary();
    const t = setInterval(fetchSummary, POLL_FIXTURE_MS);
    return () => clearInterval(t);
  }, []);

  // 輪詢校驗狀態（60s）
  const fetchCalStatus = useCallback(async () => {
    try {
      const res = await api.get("/api/maintenance/calibration-status");
      setCalibrationStatusMap(res.data);
    } catch (_) {}
  }, []);

  useEffect(() => {
    fetchCalStatus();
    const t = setInterval(fetchCalStatus, 60000);
    return () => clearInterval(t);
  }, [fetchCalStatus]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <TopBar devices={devices} fixtureSummary={fixtureSummary} displayName={displayName} role={role} onLogout={onLogout} />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LeftPanel
          devices={devices}
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
          activeTab={activeTab}
          fixtureSummary={fixtureSummary}
          onOpenRecords={() => setRecordsOpen(true)}
          pendingByDevice={pendingByDevice}
          onConfirmCondition={handleConfirmCondition}
          scheduleCounts={scheduleCounts}
          onShowQc={setSensorModalDevice}
          calibrationStatusMap={calibrationStatusMap}
        />
        <CenterPanel
          role={role}
          userId={userId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedDevice={selectedDevice}
          scheduleInitConds={scheduleInitConds}
          handleInitCondsConsumed={handleInitCondsConsumed}
          devices={devices}
          pendingByDevice={pendingByDevice}
          onConfirmCondition={handleConfirmCondition}
          scheduleCounts={scheduleCounts}
          onOpenExecutions={() => { setRecordsOpen(true); setRecordsSubTab("executions"); }}
          onCalibrationChange={fetchCalStatus}
        />
      </div>

      {/* 紀錄 Modal */}
      {recordsOpen && (
        <div onClick={() => setRecordsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", width: "min(900px, 92vw)", height: "min(620px, 85vh)", background: "#0d1117", border: "1px solid #30363d", borderRadius: 10, display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #30363d", flexShrink: 0 }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: "#cdd9e5" }}>紀錄</span>
              <button onClick={() => setRecordsOpen(false)} style={{ background: "none", border: "none", color: "#8b949e", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>✕</button>
            </div>
            <div style={{ display: "flex", padding: "0 12px", borderBottom: "1px solid #30363d", flexShrink: 0, background: "#0d1117" }}>
              {[{ key: "errors", label: "異常紀錄" }, { key: "executions", label: "執行紀錄" }, { key: "audit", label: "稽核紀錄" }].map((t) => (
                <button key={t.key} onClick={() => setRecordsSubTab(t.key)} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: recordsSubTab === t.key ? "2px solid #58a6ff" : "2px solid transparent", color: recordsSubTab === t.key ? "#cdd9e5" : "#8b949e" }}>
                  {t.label}
                </button>
              ))}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <div style={{ display: recordsSubTab === "errors" ? "block" : "none", height: "100%" }}>
                <ErrorLog active={recordsOpen && recordsSubTab === "errors"} />
              </div>
              <div style={{ display: recordsSubTab === "executions" ? "block" : "none", height: "100%" }}>
                <ExecutionList active={recordsOpen && recordsSubTab === "executions"} role={role} />
              </div>
              <div style={{ display: recordsSubTab === "audit" ? "block" : "none", height: "100%" }}>
                <AuditLog active={recordsOpen && recordsSubTab === "audit"} />
              </div>
            </div>
          </div>
        </div>
      )}

      {sensorModalDevice && (
        <SensorQcModal deviceId={sensorModalDevice} onClose={() => setSensorModalDevice(null)} />
      )}

      {/* AI FAB — 面板開啟時隱藏 */}
      {!aiOpen && (
        <button
          onClick={() => setAiOpen((v) => !v)}
          title="AI 諮詢"
          className="ai-fab-pulse"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200, width: 46, height: 46, borderRadius: "50%", background: "#1f6feb", border: "none", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
        >
          🤖
        </button>
      )}

      {/* 點背景關閉 */}
      {aiOpen && <div onClick={() => setAiOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 198 }} />}

      {/* AI 滑入面板 */}
      <div style={{ position: "fixed", top: 0, right: 0, height: "100%", width: 500, zIndex: 199, transform: aiOpen ? "translateX(0)" : "translateX(100%)", transition: "transform .2s ease", background: "#0d1117", borderLeft: "1px solid #30363d", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <RightPanel onClose={() => setAiOpen(false)} onApplySchedule={handleApplySchedule} />
      </div>

      {role === "guest" && (
        <div style={{ position: "fixed", bottom: 20, right: 80, fontSize: 24, fontWeight: 700, color: "rgba(139, 148, 158, 0.45)", pointerEvents: "none", letterSpacing: 2, textShadow: "0 0 4px rgba(0,0,0,0.3)", zIndex: 1 }}>
          DEMO MODE
        </div>
      )}
    </div>
  );
}
