import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "./api";
import { useDeviceWebSocket } from "./useDeviceWebSocket";
import { useToast } from "./components/useToast";
import SOPPage from "./SOPPage";
import FixturePage from "./FixturePage";
import SchedulePage from "./SchedulePage";
import UsersPage from "./UsersPage";
import ErrorLog from "./ErrorLog";
import ExecutionList from "./ExecutionList";
import MaintenancePage from "./MaintenancePage";
import RightPanel from "./components/control/RightPanel";
import SensorQcModal from "./components/control/SensorQcModal";
import ModalFrame from "./components/ModalFrame";
import AuditLog from "./components/control/AuditLog";
import TopBar from "./components/control/TopBar";
import { conditionLabel } from "./components/control/deviceCardUtils";
import TabBadge from "./components/control/TabBadge";
import LeftPanel from "./components/control/LeftPanel";
import { DEVICE_IDS, POLL_DEVICES_MS, POLL_FIXTURE_MS, POLL_GENERAL_MS, IDLE_STATUS } from "./constants";
import { localDayWindow } from "./utils/timezone";
import { C } from "./styles/theme";

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
  const [hovered, setHovered] = useState(false);
  const { label } = conditionLabel(schedule, `${device.device_id} `);
  const bg = busy ? C.warningBg : hovered ? `${C.warning}44` : `${C.warning}22`;
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onConfirmCondition(schedule.id); } finally { setBusy(false); } }}
      style={{ fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4, background: bg, border: `1px solid ${C.warning}`, color: C.warning, cursor: busy ? "not-allowed" : "pointer", transition: "background .15s" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {busy ? "處理中..." : label}
    </button>
  );
}

// ── CenterPanel ───────────────────────────────────────────────────────────────

// 視窗標題同時是螢幕閱讀器唸的名稱與 E2E 的定位依據，只留一份
const RECORDS_TITLE = "紀錄";

const TABS = [
  { key: "device", label: "設備" },
  { key: "fixture", label: "治具" },
  { key: "schedule", label: "排程" },
  { key: "maintenance", label: "維護", adminOnly: true },
  { key: "users", label: "人員管理", adminOnly: true },
];

function CenterPanel({ role, activeTab, setActiveTab, selectedDevice, scheduleInitConds, handleInitCondsConsumed, onOpenExecutions, devices, devicesReady, pendingByDevice, onConfirmCondition, scheduleCounts, onCalibrationChange, onFixtureChanged, onScheduleChanged }) {
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

  // 排程頁要判斷「這台現在能不能開始」：狀態決定能不能，估算的占用結束時間決定什麼時候可以。
  const liveDeviceStatuses = useMemo(
    () => devicesReady ? Object.fromEntries(devices.map(d => [
      d.device_id,
      (d.is_blocked && d.status === IDLE_STATUS) ? "BLOCKED" : d.status,
    ])) : {},
    [devices, devicesReady],
  );
  const liveDeviceFreeAt = useMemo(
    () => devicesReady
      ? Object.fromEntries(devices.map(d => [d.device_id, d.estimated_end_at]))
      : {},
    [devices, devicesReady],
  );
  const liveDeviceMaintenance = useMemo(
    () => devicesReady ? Object.fromEntries(
      devices
        .filter(d => d.maintenance_blocked)
        .map(d => [d.device_id, {
          reason: d.maintenance_reason,
          end_time: d.maintenance_end_at,
        }]),
    ) : {},
    [devices, devicesReady],
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 0, padding: "0 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            aria-current={activeTab === t.key ? "true" : undefined}
            style={{ padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: activeTab === t.key ? `2px solid ${C.accent}` : "2px solid transparent", color: activeTab === t.key ? C.textPrimary : C.textMuted, transition: "color .15s, background .15s" }}
            onMouseEnter={(e) => { if (activeTab !== t.key) e.currentTarget.style.background = C.surfaceHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            {t.label}
            {t.key === "schedule" && <TabBadge count={scheduleCounts.pending} bg={C.warningAlt} />}
          </button>
        ))}
      </div>

      {/* 等待確認 Banner */}
      {waitingDevices.length > 0 && (
        <div className="banner-flash" style={{ flexShrink: 0, background: "#1a1500", borderBottom: `1px solid ${C.warning}`, padding: "6px 12px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: C.warning, fontWeight: 700, marginRight: 4 }}>⚠ 等待確認</span>
          {waitingDevices.map(d => (
            <BannerConfirmBtn key={d.device_id} device={d} schedule={pendingByDevice[d.device_id]} onConfirmCondition={onConfirmCondition} />
          ))}
        </div>
      )}

      {/* Tab content（display:none 保留狀態）*/}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        <div style={{ display: activeTab === "device" ? "block" : "none", height: "100%" }}>
          <SOPPage
            active={activeTab === "device"}
            externalDevice={selectedDevice}
            onOpenExecutions={onOpenExecutions}
            onScheduleChanged={onScheduleChanged}
            liveDevices={devices}
          />
        </div>
        <div style={{ display: activeTab === "fixture" ? "block" : "none", height: "100%" }}>
          <FixturePage active={activeTab === "fixture"} role={role} onFixtureChanged={onFixtureChanged} />
        </div>
        <div style={{ display: activeTab === "schedule" ? "block" : "none", height: "100%" }}>
          <SchedulePage
            active={activeTab === "schedule"}
            role={role}
            initConditions={scheduleInitConds}
            onInitCondsConsumed={handleInitCondsConsumed}
            onScheduleChanged={onScheduleChanged}
            liveDeviceStatuses={liveDeviceStatuses}
            liveDeviceFreeAt={liveDeviceFreeAt}
            liveDeviceMaintenance={liveDeviceMaintenance}
            liveDeviceSnapshotReady={devicesReady}
          />
        </div>
        {role === "admin" && (
          <>
            <div style={{ display: activeTab === "maintenance" ? "block" : "none", height: "100%" }}>
              <MaintenancePage active={activeTab === "maintenance"} role={role} onCalibrationChange={onCalibrationChange} />
            </div>
            <div style={{ display: activeTab === "users" ? "block" : "none", height: "100%" }}>
              <UsersPage active={activeTab === "users"} role={role} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── ControlCenter ─────────────────────────────────────────────────────────────

export default function ControlCenter({ role, displayName, onLogout }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const requestedTab = PATH_TO_TAB[pathname] ?? "device";
  const requestedTabConfig = TABS.find((tab) => tab.key === requestedTab);
  const activeTab = role !== "admin" && requestedTabConfig?.adminOnly
    ? "device"
    : requestedTab;
  const setActiveTab = useCallback((key) => navigate(TAB_TO_PATH[key] ?? "/"), [navigate]);

  useEffect(() => {
    if (activeTab !== requestedTab) navigate("/", { replace: true });
  }, [activeTab, navigate, requestedTab]);

  const { devices, devicesReady } = useDeviceWebSocket();
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
  const [runtimeWarnings, setRuntimeWarnings] = useState([]);
  // 預設當成可用：讀不到 runtime-info 時寧可讓人送出後看後端的實話，
  // 也不要因為一次讀取失敗就把面板鎖起來。
  const [aiEnabled, setAiEnabled] = useState(true);
  const handleInitCondsConsumed = useCallback(() => setScheduleInitConds(null), []);
  const { showToast } = useToast();
  const [scheduleCounts, setScheduleCounts] = useState({ pending: 0, confirmed: 0, running: 0, done: 0, error: 0 });
  const scheduleCountsRef = useRef(null);

  const handleApplySchedule = useCallback((sop_ids) => {
    setActiveTab("schedule");
    setScheduleInitConds(sop_ids);
    showToast(`已帶入 ${sop_ids.length} 個條件，請至排程頁面確認`, "info");
  }, [showToast, setActiveTab]);

  const fetchScheduleCounts = useCallback(async () => {
    try {
      const res = await api.get("/api/schedules");
      const all = res.data;
      const next = {
        pending: all.filter(s => s.status === "待審核").length,
        confirmed: all.filter(s => s.status === "已確認").length,
        running: all.filter(s => s.status === "進行中").length,
        done: all.filter(s => s.status === "已完成").length,
        error: all.filter(s => s.status === "異常").length,
      };
      const json = JSON.stringify(next);
      if (json !== scheduleCountsRef.current) {
        scheduleCountsRef.current = json;
        setScheduleCounts(next);
      }
    } catch { /* polling fallback will retry */ }
  }, []);

  const fetchFixtureSummary = useCallback(async () => {
    try {
      // 「今日到期」要用本地日界：後端存 UTC，不知道使用者時區，日界由這裡給
      const { start, end } = localDayWindow();
      const res = await api.get("/api/fixtures/summary", {
        params: { due_from: start.toISOString(), due_to: end.toISOString() },
      });
      setFixtureSummary(res.data);
    } catch { /* polling fallback will retry */ }
  }, []);

  const refreshScheduleOverview = useCallback(
    () => Promise.all([fetchScheduleCounts(), fetchFixtureSummary()]),
    [fetchScheduleCounts, fetchFixtureSummary],
  );

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
      } catch { /* ignore */ }
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
      const [r] = await Promise.all([
        api.get("/api/schedules?status=進行中"),
        refreshScheduleOverview(),
      ]);
      const map = toDeviceMap(r.data);
      pendingJsonRef.current = JSON.stringify(map);
      setPendingByDevice(map);
    } catch (e) {
      showToast(e.response?.data?.detail || "操作失敗", "error", 3000, e.response?.data?.hint);
    }
  }, [refreshScheduleOverview, showToast]);

  useEffect(() => {
    // fetchScheduleCounts 先 await API 才 setState，不是 effect 內同步串接 render。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchScheduleCounts();
    const timer = setInterval(fetchScheduleCounts, POLL_GENERAL_MS);
    return () => clearInterval(timer);
  }, [fetchScheduleCounts, role]);

  // 輪詢治具摘要（30s）
  useEffect(() => {
    // fetchFixtureSummary 先 await API 才 setState，不是 effect 內同步串接 render。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchFixtureSummary();
    const t = setInterval(fetchFixtureSummary, POLL_FIXTURE_MS);
    return () => clearInterval(t);
  }, [fetchFixtureSummary]);

  // 輪詢校驗狀態（60s）
  const fetchCalStatus = useCallback(async () => {
    try {
      const res = await api.get("/api/maintenance/calibration-status");
      setCalibrationStatusMap(res.data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    // fetchCalStatus 為 async（await 後才 setState），非串接 render，誤報
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCalStatus();
    const t = setInterval(fetchCalStatus, 60000);
    return () => clearInterval(t);
  }, [fetchCalStatus]);

  // 訪客也要打這支：AI 面板要靠 ai_enabled 才知道該不該停用輸入。
  // 後端只發給訪客這一項，warnings 那幾句會寫出缺哪個環境變數，維持只給管理者。
  useEffect(() => {
    let cancelled = false;
    api.get("/api/runtime-info")
      .then((res) => {
        if (cancelled) return;
        const next = Array.isArray(res.data?.warnings) ? res.data.warnings : [];
        setRuntimeWarnings(next);
        setAiEnabled(res.data?.capabilities?.ai_enabled !== false);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [role]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <TopBar devices={devices} fixtureSummary={fixtureSummary} displayName={displayName} role={role} onLogout={onLogout} />
      {runtimeWarnings.length > 0 && (
        <div style={{ flexShrink: 0, padding: "7px 12px", borderBottom: `1px solid ${C.warning}`, background: "#1a1500", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ color: C.warning, fontSize: 11, fontWeight: 700 }}>⚠ 環境告警</span>
          {runtimeWarnings.map((item) => (
            <span key={item.code} style={{ color: "#e6edf3", fontSize: 11 }}>{item.message}</span>
          ))}
        </div>
      )}
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
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedDevice={selectedDevice}
          scheduleInitConds={scheduleInitConds}
          handleInitCondsConsumed={handleInitCondsConsumed}
          devices={devices}
          devicesReady={devicesReady}
          pendingByDevice={pendingByDevice}
          onConfirmCondition={handleConfirmCondition}
          scheduleCounts={scheduleCounts}
          onOpenExecutions={() => { setRecordsOpen(true); setRecordsSubTab("executions"); }}
          onCalibrationChange={fetchCalStatus}
          onFixtureChanged={fetchFixtureSummary}
          onScheduleChanged={refreshScheduleOverview}
        />
      </div>

      {/* 紀錄 Modal */}
      {recordsOpen && (
        <ModalFrame
          title={RECORDS_TITLE}
          zIndex={300}
          onClose={() => setRecordsOpen(false)}
          boxStyle={{ width: "min(900px, 92vw)", height: "min(620px, 85vh)", background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}
          bodyStyle={{ overflow: "hidden" }}
          header={
            <>
              <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: C.textPrimary }}>{RECORDS_TITLE}</span>
                <button onClick={() => setRecordsOpen(false)} style={{ background: "none", border: "none", color: C.textMuted, fontSize: 16, cursor: "pointer", padding: "0 4px" }}>✕</button>
              </div>
              <div style={{ display: "flex", padding: "0 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.bg }}>
                {[{ key: "errors", label: "異常紀錄" }, { key: "executions", label: "執行紀錄" }, { key: "audit", label: "稽核紀錄" }].map((t) => (
                  <button key={t.key} onClick={() => setRecordsSubTab(t.key)} aria-current={recordsSubTab === t.key ? "true" : undefined} style={{ padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: recordsSubTab === t.key ? `2px solid ${C.accent}` : "2px solid transparent", color: recordsSubTab === t.key ? C.textPrimary : C.textMuted }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          }
        >
              <div style={{ display: recordsSubTab === "errors" ? "block" : "none", height: "100%" }}>
                <ErrorLog active={recordsOpen && recordsSubTab === "errors"} />
              </div>
              <div style={{ display: recordsSubTab === "executions" ? "block" : "none", height: "100%" }}>
                <ExecutionList active={recordsOpen && recordsSubTab === "executions"} role={role} />
              </div>
              <div style={{ display: recordsSubTab === "audit" ? "block" : "none", height: "100%" }}>
                <AuditLog active={recordsOpen && recordsSubTab === "audit"} />
              </div>
        </ModalFrame>
      )}

      {sensorModalDevice && (
        <SensorQcModal
          deviceId={sensorModalDevice}
          onClose={() => setSensorModalDevice(null)}
          onViewDeviceStatus={() => {
            setSelectedDevice(sensorModalDevice);
            setActiveTab("device");
            setSensorModalDevice(null);
          }}
        />
      )}

      {/* AI FAB — 面板開啟時隱藏 */}
      {!aiOpen && (
        <button
          onClick={() => setAiOpen((v) => !v)}
          title="AI 諮詢"
          className="ai-fab-pulse"
          style={{ position: "fixed", bottom: 24, right: 24, zIndex: 200, width: 46, height: 46, borderRadius: "50%", background: C.accentDark, border: "none", cursor: "pointer", fontSize: 20, display: "flex", alignItems: "center", justifyContent: "center", transition: "background .15s" }}
        >
          🤖
        </button>
      )}

      {/* 點背景關閉 */}
      {/* eslint-disable-next-line no-restricted-syntax -- 點背景收起 AI 面板是滑鼠的便利，鍵盤路徑是面板裡的關閉鈕 */}
      {aiOpen && <div onClick={() => setAiOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 198 }} />}

      {/* AI 滑入面板 */}
      <div style={{ position: "fixed", top: 0, right: 0, height: "100%", width: 500, zIndex: 199, transform: aiOpen ? "translateX(0)" : "translateX(100%)", transition: "transform .2s ease", background: C.bg, borderLeft: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <RightPanel role={role} aiEnabled={aiEnabled} onClose={() => setAiOpen(false)} onApplySchedule={handleApplySchedule} />
      </div>

      {role === "guest" && (
        <div style={{ position: "fixed", bottom: 20, right: 80, fontSize: 24, fontWeight: 700, color: "rgba(139, 148, 158, 0.45)", pointerEvents: "none", letterSpacing: 2, textShadow: "0 0 4px rgba(0,0,0,0.3)", zIndex: 1 }}>
          DEMO MODE
        </div>
      )}
    </div>
  );
}
