import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "./api";
import { DEVICE_IDS } from "./constants";
import GanttChart from "./components/schedule/GanttChart";
import NewScheduleModal from "./components/schedule/NewScheduleModal";
import ScheduleDetailModal from "./components/schedule/ScheduleDetailModal";
import ManageBlockedPeriodsModal from "./components/schedule/ManageBlockedPeriodsModal";
import {
  STATUS_COLOR, STATUS_LIST, HEADER_H, ROW_H,
  MS_PER_DAY, GANTT_PAST_DAYS, GANTT_FUTURE_DAYS,
  fmtDt, fmtHours, primaryBtn, scheduleIconBtn,
} from "./components/schedule/scheduleUtils";
import { C } from "./styles/theme";

export default function SchedulePage({ active, role, userId, initConditions, onInitCondsConsumed, liveDeviceStatuses = {} }) {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  const [schedules, setSchedules] = useState([]);
  const [blockedPeriods, setBlockedPeriods] = useState([]);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [standardsTree, setStandardsTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showNewModal, setShowNewModal] = useState(false);
  const [pendingInitConds, setPendingInitConds] = useState(null);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  const lastInitCondsRef = useRef(null);

  const sopIdMap = useMemo(() => {
    if (!standardsTree) return {};
    const map = {};
    for (const [stdName, std] of Object.entries(standardsTree)) {
      for (const [verName, ver] of Object.entries(std.versions)) {
        for (const t of Object.values(ver.tests)) {
          map[t.sop_id] = { stdName, verName, test: t };
        }
      }
    }
    return map;
  }, [standardsTree]);

  useEffect(() => {
    if (!initConditions) {
      lastInitCondsRef.current = null;
      return;
    }
    if (initConditions !== lastInitCondsRef.current && standardsTree) {
      lastInitCondsRef.current = initConditions;
      setPendingInitConds(initConditions);
      setShowNewModal(true);
      onInitCondsConsumed?.();
    }
  }, [initConditions, standardsTree, onInitCondsConsumed]);

  const rangeStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - GANTT_PAST_DAYS);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const rangeEnd = rangeStart + ((GANTT_PAST_DAYS + GANTT_FUTURE_DAYS) * MS_PER_DAY);

  const fetchAll = useCallback(async () => {
    try {
      const [ganttRes, treeRes] = await Promise.all([
        api.get("/api/schedules/gantt"),
        standardsTree ? null : api.get("/api/schedules/standards-tree"),
      ]);
      setSchedules(ganttRes.data.schedules);
      setBlockedPeriods(ganttRes.data.blocked_periods);
      if (ganttRes.data.device_statuses) setDeviceStatuses(ganttRes.data.device_statuses);
      if (treeRes) setStandardsTree(treeRes.data);
    } catch (e) {
      console.error("排程資料載入失敗", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [standardsTree]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  useEffect(() => {
    if (active) fetchAll();
    // fetchAll 刻意不入 deps：只在 active 切換時重抓，避免 identity 變動造成重複請求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const isAdmin = role === "admin";

  const summary = {
    待審核: schedules.filter((s) => s.status === "待審核").length,
    已確認: schedules.filter((s) => s.status === "已確認").length,
    進行中: schedules.filter((s) => s.status === "進行中").length,
    已完成: schedules.filter((s) => s.status === "已完成").length,
  };

  const filteredSchedules = filterStatus === "all"
    ? schedules
    : schedules.filter((s) => s.status === filterStatus);

  if (!active) return null;

  return (
    <div style={{
      height: "100%", display: "flex", flexDirection: "column",
      background: C.bg, overflow: "hidden",
    }}>

      {/* 甘特圖（固定區塊，永遠可見） */}
      <div style={{ flexShrink: 0, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, ...(isMobile && { maxHeight: 200, overflow: "hidden" }) }}>
        {loading ? (
          <div style={{
            height: HEADER_H + DEVICE_IDS.length * ROW_H,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: C.textDim, fontSize: 13, border: `1px solid ${C.border}`,
            borderRadius: 8,
          }}>
            載入中...
          </div>
        ) : (
          <GanttChart
            schedules={schedules}
            blockedPeriods={blockedPeriods}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onClickSchedule={setSelectedSchedule}
          />
        )}
      </div>

      {/* 捲動區：警示條 + 隊列 + 圖例 + 表格 */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* 待審核警示條 */}
        {summary["待審核"] > 0 && (
          <div style={{
            background: "#3a2a1a", border: `1px solid ${C.warning}44`,
            borderRadius: 6, padding: "8px 14px",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 13, color: C.warning, fontWeight: 700 }}>⚠️</span>
            <span style={{ color: C.warning, fontSize: 13, fontWeight: 600 }}>
              有 {summary["待審核"]} 筆排程申請待審核
            </span>
          </div>
        )}

        {/* 待審核隊列 */}
        {(() => {
          const pending = schedules.filter((s) => s.status === "待審核");
          if (pending.length === 0) return null;
          return (
            <div style={{ border: `1px solid ${C.textDim}`, borderRadius: 8, overflow: "hidden", background: C.bg }}>
              <div style={{
                padding: "6px 12px",
                background: C.surface,
                borderBottom: `1px solid ${C.border}`,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 11, color: C.textMuted, fontWeight: 700, letterSpacing: 1 }}>待審核排程隊列</span>
                <span style={{
                  background: C.border, color: C.textMuted,
                  borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700,
                }}>{pending.length}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {pending.map((s, idx) => (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSchedule(s)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "7px 12px",
                      borderBottom: idx < pending.length - 1 ? `1px solid ${C.surfaceHover}` : "none",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = C.surface}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 11, color: C.textDim, fontFamily: "monospace", width: 24, flexShrink: 0 }}>
                      #{idx + 1}
                    </span>
                    <span style={{ fontSize: 12, color: C.textPrimary, fontFamily: "monospace", minWidth: 90 }}>
                      {s.project_number}
                    </span>
                    <span style={{ fontSize: 12, color: C.textPrimary, flex: 1 }}>{s.sample_name}</span>
                    <span style={{ fontSize: 11, color: C.textMuted, minWidth: 60 }}>{s.applicant_name || "—"}</span>
                    <span style={{ fontSize: 11, color: C.warningAlt, minWidth: 60, textAlign: "right" }}>
                      {fmtHours(s.total_hours)}
                    </span>
                    <span style={{ fontSize: 10, color: C.textDim, minWidth: 100, textAlign: "right" }}>
                      {fmtDt(s.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* 圖例 */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(STATUS_COLOR).map(([s, c]) => (
            <div key={s} style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 14, height: 10, borderRadius: 2, background: c.bg, border: `1px solid ${c.border}` }} />
              <span style={{ fontSize: 11, color: C.textMuted }}>{s}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 14, height: 10, borderRadius: 2,
              background: "repeating-linear-gradient(135deg, #2d1a1a 0px, #2d1a1a 3px, #1a0a0a 3px, #1a0a0a 6px)",
              border: "1px solid #6e1b1b",
            }} />
            <span style={{ fontSize: 11, color: C.textMuted }}>不可用時段</span>
          </div>
        </div>

        {/* 排程清單 */}
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
            {["all", ...STATUS_LIST].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "4px 12px", fontSize: 12, borderRadius: 20,
                  cursor: "pointer",
                  background: filterStatus === s ? "#1c3a5e" : "transparent",
                  color: filterStatus === s ? C.accentLight : C.textMuted,
                  border: filterStatus === s ? `1px solid ${C.accentLink}` : `1px solid ${C.border}`,
                }}
              >
                {s === "all" ? "全部" : s}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              style={{ ...scheduleIconBtn, opacity: refreshing ? 0.5 : 1 }}
            >重新整理</button>
            {isAdmin && (
              <button
                onClick={() => setShowBlockModal(true)}
                style={scheduleIconBtn}
              >+ 不可用時段</button>
            )}
            {isAdmin && (
              <button onClick={() => { setPendingInitConds(null); setShowNewModal(true); }} style={primaryBtn}>
                + 申請排程
              </button>
            )}
          </div>

          {filteredSchedules.length === 0 ? (
            <div style={{ textAlign: "center", color: C.textDim, padding: 32, fontSize: 13 }}>
              {filterStatus === "all" ? "尚無排程紀錄" : `無「${filterStatus}」的排程`}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: C.textMuted, borderBottom: `1px solid ${C.border}` }}>
                  {["狀態", "專案號碼", "樣品名稱", "申請人", "設備", "開始時間", "結束時間", "預估時長"].map((h) => (
                    <th key={h} style={{ padding: "6px 8px", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSchedules.map((s) => {
                  const color = STATUS_COLOR[s.status] || STATUS_COLOR["待審核"];
                  return (
                    <tr
                      key={s.id}
                      onClick={() => setSelectedSchedule(s)}
                      style={{
                        borderBottom: `1px solid ${C.surfaceHover}`, cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = C.surface}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 10, fontSize: 11,
                          background: color.bg, color: color.text,
                          border: `1px solid ${color.border}`, whiteSpace: "nowrap",
                        }}>{s.status}</span>
                      </td>
                      <td style={{ padding: "6px 8px", color: C.textPrimary, fontFamily: "monospace" }}>{s.project_number}</td>
                      <td style={{ padding: "6px 8px", color: C.textPrimary }}>{s.sample_name}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted }}>{s.applicant_name || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted, fontFamily: "monospace" }}>{s.device_id || "—"}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDt(s.start_time)}</td>
                      <td style={{ padding: "6px 8px", color: C.textMuted, whiteSpace: "nowrap" }}>{fmtDt(s.end_time)}</td>
                      <td style={{ padding: "6px 8px", color: C.warningAlt, whiteSpace: "nowrap" }}>{fmtHours(s.total_hours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modals */}
      {showNewModal && standardsTree && sopIdMap && (
        <NewScheduleModal
          standardsTree={standardsTree}
          sopIdMap={sopIdMap}
          initialConditions={pendingInitConds}
          onClose={() => { setShowNewModal(false); setPendingInitConds(null); }}
          onCreated={(s) => {
            setSchedules((prev) => [s, ...prev]);
            setShowNewModal(false);
            setPendingInitConds(null);
          }}
        />
      )}

      {showBlockModal && (
        <ManageBlockedPeriodsModal
          onClose={() => setShowBlockModal(false)}
          onChanged={async () => {
            try {
              const res = await api.get("/api/schedules/gantt");
              setBlockedPeriods(res.data.blocked_periods ?? []);
            } catch { /* gantt 刷新失敗不影響 modal 操作結果 */ }
          }}
        />
      )}

      {selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          role={role}
          userId={userId}
          deviceStatuses={{ ...deviceStatuses, ...liveDeviceStatuses }}
          onClose={() => setSelectedSchedule(null)}
          onRefresh={fetchAll}
          onUpdated={(updated) => {
            setSchedules((prev) => prev.map((s) => s.id === updated.id ? updated : s));
            setSelectedSchedule(updated);
          }}
          onDeleted={(id) => {
            setSchedules((prev) => prev.filter((s) => s.id !== id));
            setSelectedSchedule(null);
          }}
        />
      )}
    </div>
  );
}
