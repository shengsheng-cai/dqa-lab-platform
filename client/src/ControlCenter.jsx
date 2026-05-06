import { useState, useEffect, useRef, useMemo, useCallback, Fragment } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "./api";
import { useToast } from "./components/Toast";
import SOPPage from "./SOPPage";
import FixturePage from "./FixturePage";
import SchedulePage from "./SchedulePage";
import UsersPage from "./UsersPage";
import ErrorLog from "./ErrorLog";
import RightPanel from "./components/control/RightPanel";
import SensorQcModal from "./components/control/SensorQcModal";
import AuditLog from "./components/control/AuditLog";
import { STATUS_CONFIG, DEVICE_IDS, POLL_DEVICES_MS, POLL_FIXTURE_MS, POLL_GENERAL_MS, parseUtcDate, SIM_PHASE_LABEL, ACTIVE_STATUSES, IDLE_STATUS, FINISHING_STATUS, EMERGENCY_STATUS } from "./constants";
import { downloadBlob, buildReportFilename } from "./utils/download";
import { formatLocal } from "./utils/timezone";

const TAB_TO_PATH = {
  device: "/",
  fixture: "/fixtures",
  schedule: "/schedule",
  users: "/users",
};
const PATH_TO_TAB = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([k, v]) => [v, k])
);


// ── TopBar ────────────────────────────────────────────────────────────────────

function TopBar({ devices, fixtureSummary, displayName, role, onLogout }) {
  const running = devices.filter((d) => d.status === "RUNNING").length;
  const emergency = devices.filter((d) => d.status === "EMERGENCY").length;
  const idle = devices.filter((d) => d.status === IDLE_STATUS && !d.is_blocked).length;
  const blocked = devices.filter((d) => d.is_blocked).length;

  const Stat = ({ label, value, color }) => (
    <span style={{ fontSize: 12, color: "#8b949e", whiteSpace: "nowrap" }}>
      {label}：
      <span style={{ color: color || "#cdd9e5", fontWeight: 600 }}>
        {value}
      </span>
    </span>
  );

  const roleName = role === "admin" ? "管理者" : "🔒 訪客模式";
  const roleColor = role === "admin" ? "#3fb950" : "#ff9f5c";
  const roleBg = role === "admin" ? "#1f3a1f" : "#2d1f00";

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
      <span
        style={{
          color: "#58a6ff",
          fontWeight: 700,
          fontSize: 14,
          marginRight: 4,
        }}
      >
        DQA Lab
      </span>

      <div style={{ display: "flex", gap: 12, flex: 1 }}>
        <Stat label="執行中" value={running} color="#3fb950" />
        <Stat
          label="緊急"
          value={emergency}
          color={emergency > 0 ? "#f85149" : "#8b949e"}
        />
        <Stat label="待機" value={idle} />
        <Stat label="不可用" value={blocked} color={blocked > 0 ? "#f0a500" : "#8b949e"} />
        <span style={{ color: "#30363d" }}>│</span>
        <Stat
          label="治具借出"
          value={fixtureSummary.total_loaned ?? "—"}
          color="#f0a500"
        />
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
                marginLeft: 5,
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: roleBg,
                color: roleColor,
              }}
            >
              {roleName}
            </span>
          </span>
        )}
        <button
          onClick={onLogout}
          style={{
            color: "#8b949e",
            background: "transparent",
            border: "1px solid #30363d",
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 5,
            cursor: "pointer",
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
    if (!estimatedEndAt) {
      setRemaining(null);
      return;
    }
    let timerId;
    const calc = () => {
      const endMs = parseUtcDate(estimatedEndAt);
      const diff = endMs - new Date();
      const next = Math.max(0, Math.floor(diff / 1000));
      setRemaining(prev => (prev === next ? prev : next));
      if (next === 0) clearInterval(timerId);
    };
    calc();
    timerId = setInterval(calc, 1000);
    return () => clearInterval(timerId);
  }, [estimatedEndAt]);
  return remaining;
}

function fmtRemaining(secs) {
  if (secs == null) return null;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function toDeviceMap(schedules) {
  const map = {};
  schedules.forEach(s => { if (s.device_id) map[s.device_id] = s; });
  return map;
}

function conditionLabel(schedule, prefix = "") {
  const idx = schedule.current_condition_index ?? 0;
  const total = (schedule.conditions || []).length;
  const isLast = idx >= total;
  return { idx, total, label: `${prefix}${isLast ? "✅ 確認完成" : `▶ 第 ${idx + 1}/${total} 條件`}` };
}

function DeviceCard({ device, isSelected, onClick, pendingSchedule, onConfirmCondition, onShowQc }) {
  const isBlocked = device.is_blocked && device.status === IDLE_STATUS;
  const cfg = isBlocked ? STATUS_CONFIG.BLOCKED : (STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE);
  const remaining = useCountdown(device.estimated_end_at);
  const isActive = ACTIVE_STATUSES.includes(device.status);
  const isEmergency = device.status === EMERGENCY_STATUS;
  const isFinishing = device.status === FINISHING_STATUS;
  const [confirming, setConfirming] = useState(false);

  const isWaiting = device.status === IDLE_STATUS && !!pendingSchedule && !!onConfirmCondition;
  const { idx: waitingIdx, total: waitingTotal, label: waitingLabel } = isWaiting
    ? conditionLabel(pendingSchedule)
    : { idx: 0, total: 0, label: "" };
  const handleConfirm = async (e) => {
    e.stopPropagation();
    setConfirming(true);
    try { await onConfirmCondition(pendingSchedule.id); } finally { setConfirming(false); }
  };

  const totalMs = useMemo(
    () => parseUtcDate(device.estimated_end_at) - parseUtcDate(device.started_at),
    [device.started_at, device.estimated_end_at]
  );
  const progressPct =
    isActive && totalMs > 0 && remaining !== null
      ? Math.min(100, Math.max(0, ((totalMs - remaining * 1000) / totalMs) * 100))
      : null;

  return (
    <div
      onClick={onClick}
      style={{
        padding: "6px 8px",
        borderRadius: 6,
        border: `1px solid ${isSelected ? cfg.color : isEmergency ? "#f8514944" : "#30363d"}`,
        background: isEmergency
          ? "#2d0f0f"
          : isSelected
            ? "#161b22"
            : "transparent",
        cursor: "pointer",
        transition: "border-color .15s, background .15s",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cdd9e5" }}>
          {device.device_id}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {onShowQc && (
            <button
              onClick={(e) => { e.stopPropagation(); onShowQc(device.device_id); }}
              title="感測器 QC 控制圖"
              style={{ background: "none", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 12, color: "#58a6ff", lineHeight: 1, opacity: 0.7 }}
            >
              📊
            </button>
          )}
          <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color }}>
            {cfg.label}
          </span>
        </span>
      </div>

      {(isActive || isFinishing) && (
        <div style={{ marginTop: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#8b949e" }}>
              {device.temperature != null ? `${device.temperature}°C` : "—"}
              {device.humidity != null && (
                <span style={{ marginLeft: 4 }}>{device.humidity}%</span>
              )}
            </span>
            {SIM_PHASE_LABEL[device.sim_phase] && (
              <span style={{ fontSize: 8, color: isFinishing ? "#6e7681" : "#484f58" }}>
                {SIM_PHASE_LABEL[device.sim_phase]}
              </span>
            )}
          </div>
          {device.running_sop_name && device.running_sop_name !== "STANDBY" && (
            <div
              style={{
                fontSize: 9,
                color: "#484f58",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: 130,
              }}
            >
              {device.running_sop_name}
            </div>
          )}
          {progressPct !== null && (
            <div style={{ margin: "3px 0 1px", height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${progressPct}%`,
                  background: device.status === "PAUSED" ? "#e3b341" : "#1f6feb",
                  borderRadius: 2,
                  transition: "width 1s linear",
                }}
              />
            </div>
          )}
          {remaining !== null && (
            <div style={{ fontSize: 9, color: "#58a6ff" }}>
              剩 {fmtRemaining(remaining)}
            </div>
          )}
        </div>
      )}

      {isBlocked && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>
          🔒 {device.blocked_reason || "排定不可用時段"}
        </div>
      )}

      {isEmergency && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>
          ⚠ 緊急停止
        </div>
      )}

      {isFinishing && (
        <div style={{ fontSize: 9, color: "#79c0ff", marginTop: 2 }}>
          {device.temperature != null && (
            <div>目前溫度: {device.temperature}°C</div>
          )}
          <div>⏳ 正在自動降溫到 25°C，請稍候...</div>
        </div>
      )}

      {isWaiting && (
        <div style={{ marginTop: 5 }}>
          <div style={{ fontSize: 9, color: "#f0a500", marginBottom: 3 }}>
            ⚠ 等待確認 ({waitingIdx}/{waitingTotal})
          </div>
          <button
            disabled={confirming}
            onClick={handleConfirm}
            style={{
              width: "100%", padding: "3px 0", fontSize: 9, fontWeight: 700,
              background: confirming ? "#2d2600" : "#f0a50022",
              border: "1px solid #f0a500", borderRadius: 4,
              color: "#f0a500", cursor: confirming ? "not-allowed" : "pointer",
            }}
          >
            {confirming ? "處理中..." : waitingLabel}
          </button>
        </div>
      )}
    </div>
  );
}

// ── TabBadge ──────────────────────────────────────────────────────────────────

function TabBadge({ count, bg, color = "#0d1117" }) {
  if (!count) return null;
  return (
    <span style={{
      marginLeft: 5, background: bg, color,
      fontSize: 10, fontWeight: 700, borderRadius: 8,
      padding: "1px 5px", lineHeight: "14px", verticalAlign: "middle",
    }}>
      {count}
    </span>
  );
}

// ── FixtureSummaryPanel ───────────────────────────────────────────────────────

function FixtureSummaryPanel({ fixtureSummary }) {
  const items = [
    { label: "借出中", value: fixtureSummary.total_loaned ?? "—", color: "#f0a500" },
    { label: "今日到期", value: fixtureSummary.due_today ?? "—", color: (fixtureSummary.due_today ?? 0) > 0 ? "#f0a500" : "#8b949e" },
    { label: "逾期未還", value: fixtureSummary.overdue ?? "—", color: (fixtureSummary.overdue ?? 0) > 0 ? "#f85149" : "#8b949e" },
    { label: "庫存不足", value: fixtureSummary.shortage_count ?? "—", color: (fixtureSummary.shortage_count ?? 0) > 0 ? "#f85149" : "#8b949e" },
  ];
  return (
    <div style={{ padding: "8px", display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: "6px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d" }}>
          <div style={{ fontSize: 9, color: "#484f58", marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
        </div>
      ))}
    </div>
  );
}

// ── ScheduleSummaryPanel ──────────────────────────────────────────────────────

function ScheduleSummaryPanel({ devices, pendingByDevice, onConfirmCondition, counts = {}, onShowQc }) {
  const summaryItems = [
    { label: "待審核", value: counts.pending, color: counts.pending > 0 ? "#e3b341" : "#8b949e" },
    { label: "進行中", value: counts.running, color: counts.running > 0 ? "#3fb950" : "#8b949e" },
    { label: "已確認", value: counts.confirmed, color: counts.confirmed > 0 ? "#58a6ff" : "#8b949e" },
    { label: "已完成", value: counts.done, color: counts.done > 0 ? "#57ab5a" : "#8b949e" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, height: "100%", overflowY: "auto" }}>
      <div style={{ padding: "0 8px 6px", display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
        {summaryItems.map(({ label, value, color }) => (
          <div key={label} style={{ padding: "5px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#484f58" }}>{label}</span>
            <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: "#484f58", padding: "4px 16px 4px", letterSpacing: 1, flexShrink: 0 }}>設備可用性</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "0 8px", overflowY: "auto" }}>
        {devices.map(d => <DeviceCard key={d.device_id} device={d} isSelected={false} onClick={null} pendingSchedule={pendingByDevice?.[d.device_id]} onConfirmCondition={onConfirmCondition} onShowQc={onShowQc} />)}
      </div>
    </div>
  );
}

// ── UsersSummaryPanel ─────────────────────────────────────────────────────────

function UsersSummaryPanel() {
  const [summary, setSummary] = useState({ admin: 0, validTokens: 0 });

  useEffect(() => {
    const fetch = async () => {
      try {
        const [usersRes, tokensRes] = await Promise.all([
          api.get("/api/auth/users"),
          api.get("/api/auth/demo-tokens"),
        ]);
        const users = usersRes.data;
        const tokens = tokensRes.data;
        setSummary({
          admin: users.filter(u => u.role === "admin" && u.is_active).length,
          validTokens: tokens.filter(t => t.is_active && !t.expired && !t.used_up).length,
        });
      } catch (_) {}
    };
    fetch();
    const t = setInterval(fetch, POLL_GENERAL_MS);
    return () => clearInterval(t);
  }, []);

  const items = [
    { label: "管理者", value: summary.admin, color: "#f85149" },
    { label: "有效 Token", value: summary.validTokens, color: summary.validTokens > 0 ? "#3fb950" : "#8b949e" },
  ];

  return (
    <div style={{ padding: "0 8px", display: "flex", flexDirection: "column", gap: 4 }}>
      {items.map(({ label, value, color }) => (
        <div key={label} style={{ padding: "5px 8px", borderRadius: 5, background: "#161b22", border: "1px solid #30363d", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 10, color: "#484f58" }}>{label}</span>
          <span style={{ fontSize: 18, fontWeight: 700, color }}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── LeftPanel ─────────────────────────────────────────────────────────────────

function LeftPanel({ devices, selectedDevice, onSelectDevice, activeTab, fixtureSummary, onOpenRecords, pendingByDevice, onConfirmCondition, scheduleCounts, onShowQc }) {
  const title = activeTab === "schedule" ? "本欄：排程概況"
    : activeTab === "fixture" ? "本欄：治具概況"
    : activeTab === "users" ? "本欄：人員概況"
    : "本欄：設備狀態";

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
          color: "#6e7681",
          fontWeight: 600,
          letterSpacing: 0.5,
          flexShrink: 0,
        }}
      >
        {title}
      </div>

      <div
        style={{
          flex: 1,
          padding: (activeTab === "fixture" || activeTab === "schedule" || activeTab === "users") ? 0 : "0 8px",
          display: "flex",
          flexDirection: "column",
          gap: (activeTab === "fixture" || activeTab === "schedule" || activeTab === "users") ? 0 : 4,
          overflowY: activeTab === "schedule" ? "hidden" : "auto",
        }}
      >
        {activeTab === "fixture" ? (
          <FixtureSummaryPanel fixtureSummary={fixtureSummary} />
        ) : activeTab === "schedule" ? (
          <ScheduleSummaryPanel devices={devices} pendingByDevice={pendingByDevice} onConfirmCondition={onConfirmCondition} counts={scheduleCounts} onShowQc={onShowQc} />
        ) : activeTab === "users" ? (
          <UsersSummaryPanel />
        ) : (
          devices.map((d) => (
            <DeviceCard
              key={d.device_id}
              device={d}
              isSelected={d.device_id === selectedDevice}
              onClick={() => onSelectDevice(d.device_id)}
              onShowQc={onShowQc}
            />
          ))
        )}
      </div>

      {activeTab === "device" && selectedDevice && (
        <button
          onClick={onOpenRecords}
          style={{
            margin: "8px",
            padding: "6px 0",
            fontSize: 11,
            background: "transparent",
            border: "1px solid #30363d",
            borderRadius: 6,
            color: "#8b949e",
            cursor: "pointer",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "#58a6ff";
            e.currentTarget.style.color = "#58a6ff";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "#30363d";
            e.currentTarget.style.color = "#8b949e";
          }}
        >
          📋 紀錄
        </button>
      )}
    </div>
  );
}

// ── ExecutionList ─────────────────────────────────────────────────────────────

function fmtDatetime(str) {
  if (!str) return "—";
  return formatLocal(str, "datetime");
}

function ExecutionList({ active, role }) {
  const { showToast } = useToast();
  const [executions, setExecutions] = useState([]);
  const [downloading, setDownloading] = useState({});
  const [uploading, setUploading] = useState(null); // { id, type }
  const [expandedId, setExpandedId] = useState(null);

  const fetchList = () =>
    api
      .get("/api/reports/list")
      .then((r) => setExecutions(r.data))
      .catch(() => {});

  useEffect(() => {
    if (!active) return;
    fetchList();
    const t = setInterval(fetchList, POLL_GENERAL_MS);
    return () => clearInterval(t);
  }, [active]);

  const downloadReport = async (ex, format = "csv") => {
    if (downloading[format]) return;
    setDownloading((prev) => ({ ...prev, [format]: ex.id }));
    try {
      const prefix = `${ex.device_id}_${ex.sop_id || "report"}`;
      await downloadBlob(`/api/reports/${format}/${ex.id}`, buildReportFilename(prefix, ex.id, format));
    } catch (_) {
    } finally {
      setDownloading((prev) => ({ ...prev, [format]: null }));
    }
  };

  const uploadPhoto = async (exId, photoType, file) => {
    setUploading({ id: exId, type: photoType });
    try {
      const form = new FormData();
      form.append("photo_type", photoType);
      form.append("file", file);
      await api.post(`/api/sop-executions/${exId}/photos`, form);
      await fetchList();
      showToast("照片已上傳", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "上傳失敗";
      showToast(msg, "error", 3000, e.response?.data?.hint);
    } finally {
      setUploading(null);
    }
  };

  const thStyle = {
    padding: "6px 12px",
    textAlign: "left",
    color: "#8b949e",
    fontWeight: 600,
    fontSize: 12,
  };
  const tdStyle = { padding: "8px 12px", fontSize: 12 };

  const PhotoBadge = ({ has, label }) => (
    <span
      style={{
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        marginRight: 3,
        background: has ? "#0f2318" : "#21262d",
        color: has ? "#57ab5a" : "#8b949e",
        border: `1px solid ${has ? "#2d5a3a" : "#30363d"}`,
      }}
    >
      {has ? "✅" : "⚠️"} {label}
    </span>
  );

  return (
    <div
      style={{
        backgroundColor: "#0d1117",
        color: "#cdd9e5",
        height: "100%",
        overflowY: "auto",
        padding: "20px 24px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          borderBottom: "1px solid #30363d",
          paddingBottom: 14,
          marginBottom: 20,
        }}
      >
        <span style={{ color: "#58a6ff", fontWeight: 700, fontSize: 18 }}>
          📋 執行紀錄
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "1px 8px",
            borderRadius: 10,
            background: "#21262d",
            color: "#8b949e",
          }}
        >
          {executions.length} 筆
        </span>
      </div>
      {executions.length === 0 ? (
        <div
          style={{ color: "#484f58", textAlign: "center", padding: "40px 0" }}
        >
          尚無執行紀錄
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d" }}>
              {[
                "ID",
                "測試名稱",
                "設備",
                "執行人員",
                "完成時間",
                ...(role !== "guest" ? ["照片", "報告"] : []),
              ].map((h) => (
                <th key={h} style={thStyle}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {executions.map((ex) => (
              <Fragment key={ex.id}>
                <tr
                  style={{
                    borderBottom:
                      expandedId === ex.id ? "none" : "1px solid #21262d",
                  }}
                >
                  <td style={{ ...tdStyle, color: "#484f58" }}>#{ex.id}</td>
                  <td style={{ ...tdStyle, color: "#cdd9e5" }}>
                    <span title={ex.sop_id}>{ex.sop_name || ex.sop_id}</span>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      color: "#8b949e",
                      fontFamily: "monospace",
                    }}
                  >
                    {ex.device_id || "—"}
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>
                    {role === "guest" ? "—" : (ex.operator || "—")}
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e" }}>
                    {fmtDatetime(ex.test_ended_at || ex.test_started_at || ex.created_at)}
                  </td>
                  {role !== "guest" && (
                  <td style={tdStyle}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                        flexWrap: "wrap",
                      }}
                    >
                      <PhotoBadge has={ex.photo_before} label="上架" />
                      <PhotoBadge has={ex.photo_after} label="結束" />
                      <button
                        onClick={() =>
                          setExpandedId(expandedId === ex.id ? null : ex.id)
                        }
                        style={{
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 3,
                          cursor: "pointer",
                          background: "transparent",
                          border: "1px solid #30363d",
                          color: "#8b949e",
                        }}
                      >
                        補充
                      </button>
                    </div>
                  </td>
                  )}
                  {role !== "guest" && (
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[
                        { format: "csv", label: "📥 CSV", color: "#58a6ff" },
                        { format: "pdf", label: "📄 PDF", color: "#3fb950" },
                      ].map(({ format, label, color }) => (
                        <button
                          key={format}
                          onClick={() => downloadReport(ex, format)}
                          disabled={downloading[format] === ex.id}
                          style={{
                            padding: "3px 10px",
                            fontSize: 11,
                            borderRadius: 4,
                            cursor: "pointer",
                            background: "transparent",
                            border: "1px solid #30363d",
                            color,
                            opacity: downloading[format] === ex.id ? 0.5 : 1,
                          }}
                        >
                          {downloading[format] === ex.id ? "⏳" : label}
                        </button>
                      ))}
                    </div>
                  </td>
                  )}
                </tr>
                {role !== "guest" && expandedId === ex.id && (
                  <tr
                    key={`${ex.id}-expand`}
                    style={{ borderBottom: "1px solid #21262d" }}
                  >
                    <td
                      colSpan={5}
                      style={{
                        padding: "8px 12px 12px 48px",
                        background: "#161b22",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 16,
                          alignItems: "center",
                        }}
                      >
                        {[
                          {
                            type: "before",
                            label: "上架時照片",
                            has: ex.photo_before,
                          },
                          {
                            type: "after",
                            label: "測試結束照片",
                            has: ex.photo_after,
                          },
                        ].map(({ type, label, has }) => (
                          <label
                            key={type}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              cursor: "pointer",
                              padding: "5px 10px",
                              borderRadius: 4,
                              fontSize: 11,
                              border: "1px dashed #30363d",
                              color: has ? "#57ab5a" : "#8b949e",
                            }}
                          >
                            {uploading?.id === ex.id && uploading?.type === type
                              ? "⏳ 上傳中..."
                              : has
                                ? `✅ ${label}（重新上傳）`
                                : `📷 上傳${label}`}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) uploadPhoto(ex.id, type, f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                        ))}
                        <span style={{ fontSize: 10, color: "#484f58" }}>
                          照片以相機 EXIF 時間為準
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── BannerConfirmBtn ──────────────────────────────────────────────────────────

function BannerConfirmBtn({ device, schedule, onConfirmCondition }) {
  const [busy, setBusy] = useState(false);
  const { label } = conditionLabel(schedule, `${device.device_id} `);
  return (
    <button
      disabled={busy}
      onClick={async () => { setBusy(true); try { await onConfirmCondition(schedule.id); } finally { setBusy(false); } }}
      style={{
        fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 4,
        background: busy ? "#2d2600" : "#f0a50022", border: "1px solid #f0a500",
        color: "#f0a500", cursor: busy ? "not-allowed" : "pointer",
      }}
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
  { key: "users", label: "人員管理", adminOnly: true },
];

function CenterPanel({ role, userId, activeTab, setActiveTab, selectedDevice, scheduleInitConds, handleInitCondsConsumed, onOpenExecutions, devices, pendingByDevice, onConfirmCondition, scheduleCounts }) {
  const visibleTabs = TABS.filter((t) =>
    (!t.adminOnly || role === "admin") && (!t.guestHidden || role !== "guest")
  );

  // 切換 tab 時重置滾動位置
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  const waitingDevices = useMemo(
    () => role === "admin" && pendingByDevice
      ? devices.filter(d => d.status === IDLE_STATUS && pendingByDevice[d.device_id])
      : [],
    [role, devices, pendingByDevice]
  );

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
      }}
    >
      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "0 12px",
          borderBottom: "1px solid #30363d",
          flexShrink: 0,
          background: "#0d1117",
        }}
      >
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              background: "transparent",
              border: "none",
              borderBottom:
                activeTab === t.key
                  ? "2px solid #58a6ff"
                  : "2px solid transparent",
              color: activeTab === t.key ? "#cdd9e5" : "#8b949e",
              transition: "color .15s",
            }}
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
        <div
          style={{
            display: activeTab === "device" ? "block" : "none",
            height: "100%",
          }}
        >
          <SOPPage
            active={activeTab === "device"}
            externalDevice={selectedDevice}
            onOpenExecutions={onOpenExecutions}
          />
        </div>
        <div
          style={{
            display: activeTab === "fixture" ? "block" : "none",
            height: "100%",
          }}
        >
          <FixturePage active={activeTab === "fixture"} role={role} />
        </div>
        <div
          style={{
            display: activeTab === "schedule" ? "block" : "none",
            height: "100%",
          }}
        >
          <SchedulePage active={activeTab === "schedule"} role={role} userId={userId} initConditions={scheduleInitConds} onInitCondsConsumed={handleInitCondsConsumed} liveDeviceStatuses={Object.fromEntries(devices.map(d => [d.device_id, (d.is_blocked && d.status === IDLE_STATUS) ? "BLOCKED" : d.status]))} />
        </div>
        {role === "admin" && (
          <div
            style={{
              display: activeTab === "users" ? "block" : "none",
              height: "100%",
            }}
          >
            <UsersPage active={activeTab === "users"} role={role} />
          </div>
        )}
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

  const [devices, setDevices] = useState(
    DEVICE_IDS.map((id) => ({
      device_id: id,
      status: "OFFLINE",
      temperature: null,
    })),
  );
  const devicesJsonRef = useRef(null);
  const [pendingByDevice, setPendingByDevice] = useState({});
  const pendingJsonRef = useRef(null);
  const [fixtureSummary, setFixtureSummary] = useState({});
  const [selectedDevice, setSelectedDevice] = useState(DEVICE_IDS[0]);
  const [aiOpen, setAiOpen] = useState(false);
  const [scheduleInitConds, setScheduleInitConds] = useState(null);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [recordsSubTab, setRecordsSubTab] = useState("errors");
  const [sensorModalDevice, setSensorModalDevice] = useState(null);
  const handleInitCondsConsumed = useCallback(() => setScheduleInitConds(null), []);
  const { showToast } = useToast();
  const handleApplySchedule = useCallback((sop_ids) => {
    setActiveTab("schedule");
    setScheduleInitConds(sop_ids);
    showToast(`已帶入 ${sop_ids.length} 個條件，請至排程頁面確認`, "info");
  }, [showToast]);

  // 輪詢設備狀態（3s）
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await api.get("/api/devices");
        const json = JSON.stringify(res.data);
        if (json !== devicesJsonRef.current) {
          devicesJsonRef.current = json;
          setDevices(res.data);
        }
      } catch (e) {
        console.error("設備狀態輪詢失敗:", e);
      }
    };
    fetchDevices();
    const t = setInterval(fetchDevices, POLL_DEVICES_MS);
    return () => clearInterval(t);
  }, []);

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
      } catch (e) {}
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
      } catch (e) {
        console.error("治具摘要輪詢失敗:", e);
      }
    };
    fetchSummary();
    const t = setInterval(fetchSummary, POLL_FIXTURE_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
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
          activeTab={activeTab}
          fixtureSummary={fixtureSummary}
          onOpenRecords={() => setRecordsOpen(true)}
          pendingByDevice={pendingByDevice}
          onConfirmCondition={handleConfirmCondition}
          scheduleCounts={scheduleCounts}
          onShowQc={setSensorModalDevice}
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
          onApplySchedule={handleApplySchedule}
          scheduleCounts={scheduleCounts}
          onOpenExecutions={() => {
            setRecordsOpen(true);
            setRecordsSubTab("executions");
          }}
        />
      </div>

      {/* 紀錄 Modal */}
      {recordsOpen && (
        <div
          onClick={() => setRecordsOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.6)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: "min(900px, 92vw)",
              height: "min(620px, 85vh)",
              background: "#0d1117",
              border: "1px solid #30363d",
              borderRadius: 10,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* Modal header */}
            <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #30363d", flexShrink: 0 }}>
              <span style={{ flex: 1, fontWeight: 700, fontSize: 13, color: "#cdd9e5" }}>紀錄</span>
              <button
                onClick={() => setRecordsOpen(false)}
                style={{ background: "none", border: "none", color: "#8b949e", fontSize: 16, cursor: "pointer", padding: "0 4px" }}
              >✕</button>
            </div>
            {/* 子 Tab bar */}
            <div style={{ display: "flex", padding: "0 12px", borderBottom: "1px solid #30363d", flexShrink: 0, background: "#0d1117" }}>
              {[{ key: "errors", label: "異常紀錄" }, { key: "executions", label: "執行紀錄" }, { key: "audit", label: "稽核紀錄" }].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setRecordsSubTab(t.key)}
                  style={{
                    padding: "7px 14px", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", background: "transparent", border: "none",
                    borderBottom: recordsSubTab === t.key ? "2px solid #58a6ff" : "2px solid transparent",
                    color: recordsSubTab === t.key ? "#cdd9e5" : "#8b949e",
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {/* 內容 */}
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
      {!aiOpen && <button
        onClick={() => setAiOpen((v) => !v)}
        title="AI 諮詢"
        className="ai-fab-pulse"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 200,
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: "#1f6feb",
          border: "none",
          cursor: "pointer",
          fontSize: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "background .15s",
        }}
      >
        🤖
      </button>}

      {/* 點背景關閉 */}
      {aiOpen && (
        <div
          onClick={() => setAiOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 198 }}
        />
      )}

      {/* AI 滑入面板 */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100%",
          width: 500,
          zIndex: 199,
          transform: aiOpen ? "translateX(0)" : "translateX(100%)",
          transition: "transform .2s ease",
          background: "#0d1117",
          borderLeft: "1px solid #30363d",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <RightPanel
          onClose={() => setAiOpen(false)}
          onApplySchedule={handleApplySchedule}
        />
      </div>

      {role === "guest" && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 80,
            fontSize: 24,
            fontWeight: 700,
            color: "rgba(139, 148, 158, 0.45)",
            pointerEvents: "none",
            letterSpacing: 2,
            textShadow: "0 0 4px rgba(0,0,0,0.3)",
            zIndex: 1,
          }}
        >
          DEMO MODE
        </div>
      )}
    </div>
  );
}
