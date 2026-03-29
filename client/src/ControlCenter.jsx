import { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import api from "./api";
import { useToast } from "./components/Toast";
import SOPPage from "./SOPPage";
import FixturePage from "./FixturePage";
import SchedulePage from "./SchedulePage";
import UsersPage from "./UsersPage";
import ErrorLog from "./ErrorLog";
import RightPanel from "./components/control/RightPanel";
import { STATUS_CONFIG, DEVICE_IDS, POLL_DEVICES_MS, POLL_FIXTURE_MS, POLL_GENERAL_MS, parseUtcDate, SIM_PHASE_LABEL } from "./constants";

const TAB_TO_PATH = {
  device: "/",
  fixture: "/fixtures",
  schedule: "/schedule",
  users: "/users",
  errors: "/errors",
  executions: "/executions",
};
const PATH_TO_TAB = Object.fromEntries(
  Object.entries(TAB_TO_PATH).map(([k, v]) => [v, k])
);


// ── TopBar ────────────────────────────────────────────────────────────────────

function TopBar({ devices, fixtureSummary, displayName, role, onLogout }) {
  const running = devices.filter((d) => d.status === "RUNNING").length;
  const emergency = devices.filter((d) => d.status === "EMERGENCY").length;
  const idle = devices.filter((d) => d.status === "IDLE").length;

  const Stat = ({ label, value, color }) => (
    <span style={{ fontSize: 12, color: "#8b949e", whiteSpace: "nowrap" }}>
      {label}：
      <span style={{ color: color || "#cdd9e5", fontWeight: 600 }}>
        {value}
      </span>
    </span>
  );

  const roleName =
    role === "admin"
      ? "管理者"
      : role === "keeper"
        ? "保管人"
        : role === "engineer"
          ? "工程師"
          : "🔒 訪客模式";
  const roleColor =
    role === "admin" ? "#3fb950" : role === "keeper" ? "#58a6ff" : role === "engineer" ? "#8b949e" : "#ff9f5c";
  const roleBg =
    role === "admin" ? "#1f3a1f" : role === "keeper" ? "#1f2f3a" : role === "engineer" ? "#21262d" : "#2d1f00";

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
    const calc = () => {
      const endMs = parseUtcDate(estimatedEndAt);
      const diff = endMs - new Date();
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
  const isActive = device.status === "RUNNING" || device.status === "PAUSED";
  const isEmergency = device.status === "EMERGENCY";

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
        <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color }}>
          {cfg.label}
        </span>
      </div>

      {isActive && (
        <div style={{ marginTop: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 10, color: "#8b949e" }}>
              {device.temperature != null ? `${device.temperature}°C` : "—"}
              {device.humidity != null && (
                <span style={{ marginLeft: 4 }}>{device.humidity}%</span>
              )}
            </span>
            {SIM_PHASE_LABEL[device.sim_phase] && (
              <span style={{ fontSize: 8, color: "#484f58" }}>
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

      {isEmergency && (
        <div style={{ fontSize: 9, color: "#f85149", marginTop: 2 }}>
          ⚠ 緊急停止
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

// ── DeviceAvailRow ────────────────────────────────────────────────────────────

function DeviceAvailRow({ device }) {
  const cfg = STATUS_CONFIG[device.status] || STATUS_CONFIG.OFFLINE;
  const remaining = useCountdown(device.estimated_end_at);
  return (
    <div style={{ padding: "5px 8px", borderRadius: 5, border: "1px solid #21262d" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#cdd9e5" }}>{device.device_id}</span>
        <span style={{ fontSize: 9, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
      </div>
      {remaining !== null && (
        <div style={{ fontSize: 9, color: "#58a6ff", marginTop: 2 }}>剩 {fmtRemaining(remaining)}</div>
      )}
    </div>
  );
}

// ── FixtureSummaryPanel ───────────────────────────────────────────────────────

function FixtureSummaryPanel({ fixtureSummary }) {
  const items = [
    { label: "借出中", value: fixtureSummary.total_loaned ?? "—", color: "#f0a500" },
    { label: "今日到期", value: fixtureSummary.due_today ?? "—", color: (fixtureSummary.due_today ?? 0) > 0 ? "#f0a500" : "#8b949e" },
    { label: "逾期未還", value: fixtureSummary.overdue ?? "—", color: (fixtureSummary.overdue ?? 0) > 0 ? "#f85149" : "#8b949e" },
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

// ── LeftPanel ─────────────────────────────────────────────────────────────────

function LeftPanel({ devices, selectedDevice, onSelectDevice, activeTab, fixtureSummary }) {
  const title = activeTab === "schedule" ? "設備可用性"
    : activeTab === "fixture" ? "治具概況"
    : "設備狀態";

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
        {title}
      </div>

      <div
        style={{
          flex: 1,
          padding: activeTab === "fixture" ? 0 : "0 8px",
          display: "flex",
          flexDirection: "column",
          gap: activeTab === "fixture" ? 0 : 4,
          overflowY: "auto",
        }}
      >
        {activeTab === "fixture" ? (
          <FixtureSummaryPanel fixtureSummary={fixtureSummary} />
        ) : activeTab === "schedule" ? (
          devices.map((d) => <DeviceAvailRow key={d.device_id} device={d} />)
        ) : (
          devices.map((d) => (
            <DeviceCard
              key={d.device_id}
              device={d}
              isSelected={d.device_id === selectedDevice}
              onClick={() => onSelectDevice(d.device_id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── ExecutionList ─────────────────────────────────────────────────────────────

function fmtDatetime(str) {
  if (!str) return "—";
  try {
    const d = parseUtcDate(str);
    if (!d || isNaN(d.getTime())) return str;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch {
    return str;
  }
}

function ExecutionList({ active, role }) {
  const { showToast } = useToast();
  const [executions, setExecutions] = useState([]);
  const [downloading, setDownloading] = useState(null);
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

  const downloadReport = async (ex) => {
    if (downloading) return;
    setDownloading(ex.id);
    try {
      const res = await api.get(`/api/reports/csv/${ex.id}`, {
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      a.download = `${ex.device_id}_${ex.sop_id || "report"}_${date}_${ex.id}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (_) {
    } finally {
      setDownloading(null);
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
      showToast(msg, "error");
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
                "測試開始",
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
              <>
                <tr
                  key={ex.id}
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
                    {fmtDatetime(ex.test_started_at || ex.created_at)}
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
                    <button
                      onClick={() => downloadReport(ex)}
                      disabled={downloading === ex.id}
                      style={{
                        padding: "3px 10px",
                        fontSize: 11,
                        borderRadius: 4,
                        cursor: "pointer",
                        background: "transparent",
                        border: "1px solid #30363d",
                        color: "#58a6ff",
                        opacity: downloading === ex.id ? 0.5 : 1,
                      }}
                    >
                      {downloading === ex.id ? "⏳" : "📥 CSV"}
                    </button>
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
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── CenterPanel ───────────────────────────────────────────────────────────────

const TABS = [
  { key: "device", label: "設備" },
  { key: "fixture", label: "治具" },
  { key: "schedule", label: "排程" },
  { key: "errors", label: "異常紀錄", guestHidden: true },
  { key: "executions", label: "執行紀錄" },
  { key: "users", label: "人員管理", adminOnly: true },
];

function CenterPanel({ role, userId, activeTab, setActiveTab, selectedDevice }) {
  const visibleTabs = TABS.filter((t) =>
    (!t.adminOnly || role === "admin") && (!t.guestHidden || role !== "guest")
  );
  const [failureCount, setFailureCount] = useState(0);
  const [pendingScheduleCount, setPendingScheduleCount] = useState(0);

  // 切換 tab 時重置滾動位置
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

  useEffect(() => {
    if (role !== "admin") return;
    const fetchCount = () => {
      api.get("/api/notification-failures/").then((res) => {
        setFailureCount(res.data.length);
      }).catch(() => {});
    };
    fetchCount();
    const timer = setInterval(fetchCount, POLL_GENERAL_MS);
    return () => clearInterval(timer);
  }, [role]);

  useEffect(() => {
    if (role === "guest") return;
    const fetch = () => {
      api.get("/api/schedules?status=待審核").then((res) => {
        setPendingScheduleCount(res.data.length);
      }).catch(() => {});
    };
    fetch();
    const timer = setInterval(fetch, POLL_GENERAL_MS);
    return () => clearInterval(timer);
  }, [role]);

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
            {t.key === "schedule" && <TabBadge count={pendingScheduleCount} bg="#e3b341" />}
            {t.key === "users" && <TabBadge count={failureCount} bg="#da3633" color="#fff" />}
          </button>
        ))}
      </div>

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
          <SchedulePage active={activeTab === "schedule"} role={role} userId={userId} />
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
        <div
          style={{
            display: activeTab === "errors" ? "block" : "none",
            height: "100%",
          }}
        >
          <ErrorLog active={activeTab === "errors"} />
        </div>
        <div
          style={{
            display: activeTab === "executions" ? "block" : "none",
            height: "100%",
          }}
        >
          <ExecutionList active={activeTab === "executions"} role={role} />
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

  const [devices, setDevices] = useState(
    DEVICE_IDS.map((id) => ({
      device_id: id,
      status: "OFFLINE",
      temperature: null,
    })),
  );
  const [fixtureSummary, setFixtureSummary] = useState({});
  const [selectedDevice, setSelectedDevice] = useState("CH-01");
  const [aiOpen, setAiOpen] = useState(false);

  // 輪詢設備狀態（3s）
  useEffect(() => {
    const fetchDevices = async () => {
      try {
        const res = await api.get("/api/devices");
        setDevices(res.data);
      } catch (e) {
        console.error("設備狀態輪詢失敗:", e);
      }
    };
    fetchDevices();
    const t = setInterval(fetchDevices, POLL_DEVICES_MS);
    return () => clearInterval(t);
  }, []);

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
        />
        <CenterPanel
          role={role}
          userId={userId}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedDevice={selectedDevice}
        />
      </div>

      {/* AI FAB — 面板開啟時隱藏 */}
      {!aiOpen && <button
        onClick={() => setAiOpen((v) => !v)}
        title="AI 諮詢"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 200,
          width: 46,
          height: 46,
          borderRadius: "50%",
          background: aiOpen ? "#1158c7" : "#1f6feb",
          border: "none",
          cursor: "pointer",
          fontSize: 20,
          boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
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
        <RightPanel onClose={() => setAiOpen(false)} />
      </div>

      {role === "guest" && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 80,
            fontSize: 24,
            fontWeight: 700,
            color: "rgba(139, 148, 158, 0.25)",
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
