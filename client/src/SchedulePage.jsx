import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import api from "./api";
import { DEVICE_IDS, POLL_GENERAL_MS } from "./constants";
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

export default function SchedulePage({ active, role, initConditions, onInitCondsConsumed, onScheduleChanged, liveDeviceStatuses = {}, liveDeviceFreeAt = {}, liveDeviceMaintenance = {}, liveDeviceSnapshotReady = false }) {
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

  const refreshAfterMutation = useCallback(
    () => Promise.all([fetchAll(), onScheduleChanged()]),
    [fetchAll, onScheduleChanged],
  );

  const fetchAllRef = useRef(fetchAll);
  useEffect(() => {
    fetchAllRef.current = fetchAll;
  }, [fetchAll]);

  useEffect(() => {
    if (!active) return undefined;
    fetchAllRef.current();
    const timer = setInterval(() => fetchAllRef.current(), POLL_GENERAL_MS);
    return () => clearInterval(timer);
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

      {/* 捲動區：警示條 + 圖例 + 表格 */}
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

        {/* 排程清單 */}
        <div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
            {["all", ...STATUS_LIST].map((s) => {
              const active = filterStatus === s;
              // 選中時套該狀態在甘特圖上的同一組顏色，取代舊的獨立圖例列；
              // 「全部」不是狀態、沒有色票，退回藍色
              const c = STATUS_COLOR[s] ?? { bg: C.accentSurface, text: C.accentLight, border: C.accentLink };
              return (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  style={{
                    padding: "4px 12px", fontSize: 12, borderRadius: 20,
                    cursor: "pointer",
                    background: active ? c.bg : "transparent",
                    color: active ? c.text : C.textMuted,
                    border: `1px solid ${active ? c.border : C.border}`,
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {s === "all" ? "全部" : s}
                </button>
              );
            })}
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
            onScheduleChanged();
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
          deviceStatuses={{ ...deviceStatuses, ...liveDeviceStatuses }}
          deviceFreeAt={liveDeviceFreeAt}
          blockedPeriods={blockedPeriods}
          liveMaintenance={liveDeviceMaintenance}
          liveMaintenanceReady={liveDeviceSnapshotReady}
          onClose={() => setSelectedSchedule(null)}
          onMutation={refreshAfterMutation}
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
