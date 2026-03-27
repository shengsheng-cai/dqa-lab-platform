import { useState, useEffect, useRef, useCallback } from "react";
import api from "./api";
import { useToast } from "./components/Toast";
import { DEVICE_IDS } from "./constants";

// ── 常數 ───────────────────────────────────────────────────────────────────
const HOUR_PX = 6;          // 每小時多少像素
const DAY_PX = HOUR_PX * 24;
const ROW_H = 52;           // 每台設備的列高
const HEADER_H = 48;        // 日期 header 高度
const LABEL_W = 68;         // 左側設備標籤寬度

const STATUS_COLOR = {
  待審核: { bg: "#30363d", text: "#8b949e", border: "#484f58" },
  已確認: { bg: "#1c3a5e", text: "#79c0ff", border: "#388bfd" },
  進行中: { bg: "#1a3828", text: "#7ee787", border: "#3fb950" },
  已完成: { bg: "#0d2318", text: "#3fb950", border: "#238636" },
  已取消: { bg: "#2d1a1a", text: "#ff7b72", border: "#f85149" },
};

const STATUS_LIST = ["待審核", "已確認", "進行中", "已完成", "已取消"];

// 後端回傳 naive UTC 字串（無 Z），補上 Z 讓瀏覽器正確解析為 UTC
function toUtcDate(dt) {
  if (!dt) return null;
  if (dt instanceof Date) return dt;
  return new Date(dt.includes("Z") || dt.includes("+") ? dt : dt + "Z");
}

function fmtDt(dt) {
  if (!dt) return "—";
  const d = toUtcDate(dt);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtHours(h) {
  if (!h) return "—";
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}m`;
  if (mins === 0) return `${hrs}h`;
  return `${hrs}h ${mins}m`;
}

// ── Gantt Chart ────────────────────────────────────────────────────────────

function GanttChart({ schedules, blockedPeriods, rangeStart, rangeEnd, onClickSchedule }) {
  const scrollRef = useRef(null);
  const totalMs = rangeEnd - rangeStart;
  const totalPx = (totalMs / 3600000) * HOUR_PX;

  // 捲動到今天
  useEffect(() => {
    if (scrollRef.current) {
      const nowOffset = ((Date.now() - rangeStart) / 3600000) * HOUR_PX - 200;
      scrollRef.current.scrollLeft = Math.max(0, nowOffset);
    }
  }, [rangeStart]);

  // 建立日期 header 刻度
  const dayTicks = [];
  let cursor = new Date(rangeStart);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < rangeEnd) {
    dayTicks.push(new Date(cursor));
    cursor = new Date(cursor.getTime() + 86400000);
  }

  function toPx(dt) {
    return ((toUtcDate(dt) - rangeStart) / 3600000) * HOUR_PX;
  }

  return (
    <div style={{ border: "1px solid #30363d", borderRadius: 8, overflow: "hidden", background: "#0d1117" }}>
      <div style={{ display: "flex" }}>
        {/* 左側設備標籤 */}
        <div style={{ width: LABEL_W, flexShrink: 0, background: "#0d1117", zIndex: 2, borderRight: "1px solid #30363d" }}>
          <div style={{ height: HEADER_H, borderBottom: "1px solid #30363d" }} />
          {DEVICE_IDS.map((id) => (
            <div
              key={id}
              style={{
                height: ROW_H,
                display: "flex", alignItems: "center", justifyContent: "center",
                borderBottom: "1px solid #21262d",
                fontSize: 12, fontWeight: 700, color: "#8b949e",
                fontFamily: "monospace",
              }}
            >
              {id}
            </div>
          ))}
        </div>

        {/* 可捲動甘特區域 */}
        <div ref={scrollRef} style={{ overflowX: "auto", flex: 1 }}>
          <div style={{ width: totalPx, position: "relative", minWidth: "100%", height: HEADER_H + DEVICE_IDS.length * ROW_H }}>

            {/* 日期 header */}
            <div style={{ height: HEADER_H, position: "relative", borderBottom: "1px solid #30363d" }}>
              {dayTicks.map((day) => {
                const left = toPx(day);
                const isToday = day.toDateString() === new Date().toDateString();
                return (
                  <div
                    key={day.toISOString()}
                    style={{
                      position: "absolute", left, top: 0,
                      width: DAY_PX, height: HEADER_H,
                      display: "flex", alignItems: "center",
                      paddingLeft: 6, fontSize: 11,
                      color: isToday ? "#58a6ff" : "#484f58",
                      fontWeight: isToday ? 700 : 400,
                      borderLeft: "1px solid #21262d",
                      boxSizing: "border-box",
                    }}
                  >
                    {`${day.getMonth() + 1}/${day.getDate()}`}
                    {isToday && (
                      <span style={{ marginLeft: 4, fontSize: 10, color: "#58a6ff" }}>今天</span>
                    )}
                  </div>
                );
              })}
              {/* 6h 刻度線（小刻度） */}
              {dayTicks.map((day) =>
                [6, 12, 18].map((h) => {
                  const left = toPx(new Date(day.getTime() + h * 3600000));
                  return (
                    <div
                      key={`${day.toISOString()}-${h}`}
                      style={{
                        position: "absolute", left, top: HEADER_H - 8,
                        width: 1, height: 8, background: "#30363d",
                      }}
                    />
                  );
                })
              )}
            </div>

            {/* 設備列 */}
            {DEVICE_IDS.map((deviceId, rowIdx) => {
              const rowTop = HEADER_H + rowIdx * ROW_H;
              const deviceSchedules = schedules.filter((s) => s.device_id === deviceId && s.start_time && s.end_time);
              const deviceBlocked = blockedPeriods.filter((b) => b.device_id === deviceId);

              return (
                <div
                  key={deviceId}
                  style={{
                    position: "absolute", top: rowTop, left: 0, right: 0,
                    height: ROW_H, borderBottom: "1px solid #21262d",
                  }}
                >
                  {/* 日間垂直格線 */}
                  {dayTicks.map((day) => (
                    <div
                      key={day.toISOString()}
                      style={{
                        position: "absolute",
                        left: toPx(day), top: 0, width: 1, height: ROW_H,
                        background: "#161b22",
                      }}
                    />
                  ))}

                  {/* 今日線 */}
                  {(() => {
                    const nowLeft = toPx(new Date());
                    if (nowLeft >= 0 && nowLeft <= totalPx) {
                      return (
                        <div style={{
                          position: "absolute", left: nowLeft, top: 0,
                          width: 1, height: ROW_H, background: "#58a6ff",
                          opacity: 0.5, zIndex: 1,
                        }} />
                      );
                    }
                    return null;
                  })()}

                  {/* 不可用時段 */}
                  {deviceBlocked.map((b) => {
                    const left = Math.max(0, toPx(b.start_time));
                    const right = Math.min(totalPx, toPx(b.end_time));
                    if (right <= left) return null;
                    return (
                      <div
                        key={b.id}
                        title={`不可用：${b.reason || "未說明"}\n${fmtDt(b.start_time)} → ${fmtDt(b.end_time)}`}
                        style={{
                          position: "absolute", left, top: 4,
                          width: right - left, height: ROW_H - 8,
                          background: "repeating-linear-gradient(135deg, #2d1a1a 0px, #2d1a1a 6px, #1a0a0a 6px, #1a0a0a 12px)",
                          border: "1px solid #6e1b1b",
                          borderRadius: 3, opacity: 0.7, zIndex: 1,
                        }}
                      />
                    );
                  })}

                  {/* 排程色塊 */}
                  {deviceSchedules.map((s) => {
                    const left = toPx(s.start_time);
                    const right = toPx(s.end_time);
                    if (right <= 0 || left >= totalPx) return null;
                    const clampLeft = Math.max(0, left);
                    const clampRight = Math.min(totalPx, right);
                    const color = STATUS_COLOR[s.status] || STATUS_COLOR["待審核"];
                    const blockW = clampRight - clampLeft;
                    return (
                      <div
                        key={s.id}
                        onClick={() => onClickSchedule(s)}
                        title={`${s.project_number} / ${s.sample_name}\n${s.status}\n${fmtDt(s.start_time)} → ${fmtDt(s.end_time)}`}
                        style={{
                          position: "absolute", left: clampLeft, top: 6,
                          width: Math.max(blockW, 4), height: ROW_H - 12,
                          background: color.bg,
                          border: `1px solid ${color.border}`,
                          borderRadius: 4, cursor: "pointer", zIndex: 2,
                          overflow: "hidden",
                          display: "flex", alignItems: "center",
                          paddingLeft: 5,
                        }}
                      >
                        {blockW > 30 && (
                          <span style={{
                            fontSize: 10, color: color.text,
                            whiteSpace: "nowrap", overflow: "hidden",
                            textOverflow: "ellipsis",
                            fontWeight: 600,
                          }}>
                            {s.project_number} {s.sample_name}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {/* 設備列的 total height 撐開（header + 所有列）*/}
            <div style={{ height: HEADER_H + DEVICE_IDS.length * ROW_H }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 條件選擇器 ──────────────────────────────────────────────────────────────

function ConditionPicker({ standardsTree, selected, onChange }) {
  const [activeStd, setActiveStd] = useState(Object.keys(standardsTree)[0] || "");
  const [activeVer, setActiveVer] = useState("");

  useEffect(() => {
    if (activeStd && standardsTree[activeStd]) {
      const vers = Object.keys(standardsTree[activeStd].versions);
      if (vers.length > 0 && !activeVer) setActiveVer(vers[0]);
    }
  }, [activeStd, standardsTree]);

  const tests = activeStd && activeVer && standardsTree[activeStd]?.versions?.[activeVer]?.tests || {};

  function toggleTest(sop_id) {
    if (selected.includes(sop_id)) {
      onChange(selected.filter((s) => s !== sop_id));
    } else {
      onChange([...selected, sop_id]);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, height: 260 }}>
      {/* 法規列 */}
      <div style={{ width: 120, borderRight: "1px solid #30363d", overflowY: "auto" }}>
        {Object.keys(standardsTree).map((std) => (
          <div
            key={std}
            onClick={() => { setActiveStd(std); setActiveVer(""); }}
            style={{
              padding: "6px 8px", fontSize: 12, cursor: "pointer",
              background: activeStd === std ? "#1c3a5e" : "transparent",
              color: activeStd === std ? "#79c0ff" : "#8b949e",
              borderRadius: 4,
            }}
          >
            {std}
          </div>
        ))}
      </div>

      {/* 版本列 */}
      <div style={{ width: 140, borderRight: "1px solid #30363d", overflowY: "auto" }}>
        {activeStd && Object.keys(standardsTree[activeStd]?.versions || {}).map((ver) => (
          <div
            key={ver}
            onClick={() => setActiveVer(ver)}
            style={{
              padding: "6px 8px", fontSize: 11, cursor: "pointer",
              background: activeVer === ver ? "#1a3828" : "transparent",
              color: activeVer === ver ? "#7ee787" : "#8b949e",
              borderRadius: 4,
            }}
          >
            {ver}
          </div>
        ))}
      </div>

      {/* 測試條件列 */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {Object.entries(tests).map(([key, t]) => {
          const checked = selected.includes(t.sop_id);
          return (
            <label
              key={t.sop_id}
              style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "5px 8px", cursor: "pointer", borderRadius: 4,
                background: checked ? "#1a3828" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggleTest(t.sop_id)}
                style={{ marginTop: 2, accentColor: "#3fb950" }}
              />
              <div>
                <div style={{ fontSize: 12, color: "#cdd9e5", fontWeight: 600 }}>{t.name}</div>
                <div style={{ fontSize: 10, color: "#484f58" }}>
                  {t.high_temperature != null && `高溫 ${t.high_temperature}°C`}
                  {t.low_temperature != null && ` / 低溫 ${t.low_temperature}°C`}
                  {t.dwell_time_hours != null && ` / ${t.dwell_time_hours}h`}
                  {t.cycles > 1 && ` × ${t.cycles}`}
                  {` ≈ ${t.estimated_hours}h`}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── 申請 Modal ──────────────────────────────────────────────────────────────

function NewScheduleModal({ standardsTree, onClose, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    project_number: "",
    sample_name: "",
    standard: Object.keys(standardsTree)[0] || "",
    conditions: [],
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);

  const totalHours = form.conditions.reduce((acc, sop_id) => {
    const std = findStd(standardsTree, sop_id);
    return acc + (std?.estimated_hours || 0);
  }, 0) + Math.max(0, form.conditions.length - 1) * 0.5;

  // 條件改變時自動獲取預覽（時間）
  useEffect(() => {
    if (form.conditions.length === 0) {
      setPreview(null);
      return;
    }
    const conditions = form.conditions.join(",");
    setPreviewing(true);
    api
      .get("/api/schedules/preview", { params: { conditions } })
      .then((r) => setPreview(r.data))
      .catch(() => setPreview(null))
      .finally(() => setPreviewing(false));
  }, [form.conditions]);

  function findStd(tree, sop_id) {
    for (const std of Object.values(tree)) {
      for (const ver of Object.values(std.versions)) {
        for (const t of Object.values(ver.tests)) {
          if (t.sop_id === sop_id) return t;
        }
      }
    }
    return null;
  }

  async function submit() {
    if (!form.project_number.trim()) return setError("請填入專案號碼");
    if (!form.sample_name.trim()) return setError("請填入樣品名稱");
    if (form.conditions.length === 0) return setError("請至少選擇一個測試條件");
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/schedules", {
        project_number: form.project_number.trim(),
        sample_name: form.sample_name.trim(),
        standard: form.standard,
        conditions: form.conditions,
        note: form.note.trim() || null,
      });
      showToast("排程申請已送出，待管理者審核", "success");
      onCreated(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "申請失敗");
      showToast(e.response?.data?.detail || "申請失敗", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, width: 680, maxHeight: "88vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>申請排程</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px 20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <LabelInput label="專案號碼 *" value={form.project_number}
              onChange={(v) => setForm((f) => ({ ...f, project_number: v }))} placeholder="e.g. P-2026-001" />
            <LabelInput label="樣品名稱 *" value={form.sample_name}
              onChange={(v) => setForm((f) => ({ ...f, sample_name: v }))} placeholder="e.g. Router A" />
          </div>

          <div>
            <div style={labelStyle}>測試條件選擇 *</div>
            <ConditionPicker
              standardsTree={standardsTree}
              selected={form.conditions}
              onChange={(c) => setForm((f) => ({ ...f, conditions: c }))}
            />
          </div>

          {form.conditions.length > 0 && (
            <>
            <div style={{
              background: "#161b22", borderRadius: 6, padding: "10px 12px",
              border: "1px solid #30363d",
            }}>
              <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 6 }}>已選條件（依序執行）</div>
              {form.conditions.map((sop_id, i) => {
                const t = findStd(standardsTree, sop_id);
                return (
                  <div key={sop_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: "#484f58", width: 18 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12, color: "#cdd9e5", flex: 1 }}>{t?.name || sop_id}</span>
                    <span style={{ fontSize: 11, color: "#3fb950" }}>≈ {t?.estimated_hours}h</span>
                    <button
                      onClick={() => setForm((f) => ({ ...f, conditions: f.conditions.filter((s) => s !== sop_id) }))}
                      style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 12 }}
                    >✕</button>
                  </div>
                );
              })}
              <div style={{ borderTop: "1px solid #21262d", marginTop: 6, paddingTop: 6, fontSize: 12, color: "#8b949e" }}>
                預估總時長：<span style={{ color: "#e3b341", fontWeight: 700 }}>{fmtHours(totalHours)}</span>
                <span style={{ fontSize: 10, marginLeft: 6 }}>（含 {Math.max(0, form.conditions.length - 1)} × 30min 緩衝）</span>
              </div>
            </div>

            {/* 預估時間預覽（申請人用）*/}
            {previewing ? (
              <div style={{ background: "#161b22", borderRadius: 6, padding: "10px 12px", border: "1px solid #30363d", color: "#8b949e", fontSize: 12 }}>
                ⏳ 計算預估時間中...
              </div>
            ) : preview ? (
              <div style={{
                background: "#1a2d1a", borderRadius: 6, padding: "10px 12px",
                border: "1px solid #3fb950", borderLeft: "3px solid #3fb950",
              }}>
                <div style={{ fontSize: 12, color: "#8b949e", marginBottom: 6 }}>📋 預估時間（待管理員分配設備）</div>
                <div style={{ fontSize: 12, color: "#cdd9e5", marginBottom: 4 }}>
                  🕐 預計開始：<span style={{ color: "#79c0ff" }}>{fmtDt(preview.start_time)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#cdd9e5" }}>
                  🏁 預計結束：<span style={{ color: "#79c0ff" }}>{fmtDt(preview.end_time)}</span>
                </div>
              </div>
            ) : null}
            </>
          )}

          <LabelInput label="備註" value={form.note}
            onChange={(v) => setForm((f) => ({ ...f, note: v }))} placeholder="可選" />

          {error && <div style={{ color: "#f85149", fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} style={cancelBtn}>取消</button>
            <button onClick={submit} disabled={saving} style={primaryBtn}>
              {saving ? "送出中..." : "送出申請"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 排程詳情 / 審核 Modal ───────────────────────────────────────────────────

function ScheduleDetailModal({ schedule, role, userId, onClose, onUpdated, onDeleted }) {
  const { showToast } = useToast();
  const [status, setStatus] = useState(schedule.status);
  const [deviceId, setDeviceId] = useState(schedule.device_id || "");
  const [note, setNote] = useState(schedule.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(null);   // { device_id, start_time, end_time }
  const [previewing, setPreviewing] = useState(false);
  const [previewAt, setPreviewAt] = useState(null); // 上次 preview 計算時間
  const [confirmedResult, setConfirmedResult] = useState(null); // 確認成功後的實際分配結果
  const canEdit = role === "admin";
  const isPending = schedule.status === "待審核";
  // engineer/keeper 可取消自己的待審核排程
  const canSelfCancel =
    (role === "engineer" || role === "keeper") &&
    userId != null &&
    schedule.applicant_user_id === userId &&
    isPending;

  const fetchPreview = useCallback(() => {
    if (!isPending) return;
    const conditions = schedule.conditions?.join(",") || "";
    if (!conditions) return;
    setPreviewing(true);
    api
      .get("/api/schedules/preview", { params: { conditions, device_id: deviceId || undefined } })
      .then((r) => { setPreview(r.data); setPreviewAt(new Date()); })
      .catch(() => setPreview(null))
      .finally(() => setPreviewing(false));
  }, [deviceId, isPending, schedule.conditions]);

  // 待審核時自動抓預覽（modal 開啟 or 設備選擇改變時）
  useEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  async function confirm() {
    setSaving(true);
    setError("");
    try {
      const payload = { status: "已確認", note: note || null };
      if (deviceId) payload.device_id = deviceId;
      const res = await api.patch(`/api/schedules/${schedule.id}`, payload);
      showToast("排程已確認", "success");
      onUpdated(res.data);
      setConfirmedResult(res.data); // 顯示最終分配結果，不立即關閉
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!window.confirm("確定取消此排程？")) return;
    setSaving(true);
    try {
      const res = await api.patch(`/api/schedules/${schedule.id}`, { status: "已取消", note: note || null });
      showToast("排程已取消", "success");
      onUpdated(res.data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveNote() {
    setSaving(true);
    setError("");
    try {
      const res = await api.patch(`/api/schedules/${schedule.id}`, { note: note || null });
      onUpdated(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
    } finally {
      setSaving(false);
    }
  }

  async function del() {
    if (!window.confirm("確定刪除此排程？此動作無法復原。")) return;
    try {
      await api.delete(`/api/schedules/${schedule.id}`);
      onDeleted(schedule.id);
    } catch (e) {
      setError(e.response?.data?.detail || "刪除失敗");
    }
  }

  const color = STATUS_COLOR[schedule.status] || STATUS_COLOR["待審核"];

  // 確認成功後顯示最終分配結果
  if (confirmedResult) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={{ ...modalStyle, width: 540 }} onClick={(e) => e.stopPropagation()}>
          <div style={modalHeader}>
            <span style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>排程已確認</span>
            <button onClick={onClose} style={closeBtn}>✕</button>
          </div>
          <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{
              background: "#1a3828", border: "1px solid #3fb950", borderRadius: 8,
              padding: "12px 16px", fontSize: 13, color: "#7ee787", fontWeight: 600,
            }}>
              排程確認成功，以下為最終分配結果：
            </div>
            <InfoRow label="專案" value={`${confirmedResult.project_number} / ${confirmedResult.sample_name}`} />
            <InfoRow label="指定設備" value={confirmedResult.device_id || "—"} />
            <InfoRow label="開始時間" value={fmtDt(confirmedResult.start_time)} />
            <InfoRow label="結束時間" value={fmtDt(confirmedResult.end_time)} />
            <InfoRow label="預估時長" value={fmtHours(confirmedResult.total_hours)} />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={onClose} style={primaryBtn}>關閉</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, width: 540 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>排程詳情</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700,
              background: color.bg, color: color.text, border: `1px solid ${color.border}`,
            }}>{schedule.status}</span>
            <span style={{ fontSize: 13, color: "#cdd9e5", fontWeight: 700 }}>
              {schedule.project_number} / {schedule.sample_name}
            </span>
          </div>

          <InfoRow label="申請人" value={schedule.applicant_name || "—"} />
          <InfoRow label="法規標準" value={schedule.standard} />
          <InfoRow label="測試條件" value={
            schedule.condition_names?.join(" → ") || schedule.conditions?.join(" → ") || "—"
          } />
          <InfoRow label="預估時長" value={fmtHours(schedule.total_hours)} />
          <InfoRow
            label="指定設備"
            value={
              isPending
                ? previewing ? "計算中..." : (preview?.device_id || "—")
                : schedule.device_id || "（自動排程）"
            }
          />
          <InfoRow
            label="開始時間"
            value={
              isPending
                ? previewing ? "計算中..." : (preview ? fmtDt(preview.start_time) : "—")
                : fmtDt(schedule.start_time)
            }
            muted={isPending}
          />
          <InfoRow
            label="結束時間"
            value={
              isPending
                ? previewing ? "計算中..." : (preview ? fmtDt(preview.end_time) : "—")
                : fmtDt(schedule.end_time)
            }
            muted={isPending}
          />

          {/* 待審核時顯示 preview 計算時間 + 刷新按鈕 */}
          {isPending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "#484f58" }}>
                {previewAt
                  ? `預覽計算於 ${previewAt.getHours().toString().padStart(2,"0")}:${previewAt.getMinutes().toString().padStart(2,"0")}:${previewAt.getSeconds().toString().padStart(2,"0")}，確認前建議刷新`
                  : "預覽計算中..."}
              </span>
              <button
                onClick={fetchPreview}
                disabled={previewing}
                style={{ ...cancelBtn, fontSize: 11, padding: "2px 8px" }}
              >
                {previewing ? "計算中..." : "↻ 刷新預覽"}
              </button>
            </div>
          )}

          <InfoRow label="申請時間" value={fmtDt(schedule.created_at)} />

          {/* 工程師/保管員可取消自己的待審核排程 */}
          {canSelfCancel && (
            <>
              <hr style={{ border: "none", borderTop: "1px solid #21262d", margin: "4px 0" }} />
              {error && <div style={{ color: "#f85149", fontSize: 13 }}>{error}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={cancel} disabled={saving} style={{ ...cancelBtn, color: "#f85149", borderColor: "#f85149" }}>
                  {saving ? "處理中..." : "取消排程"}
                </button>
              </div>
            </>
          )}

          {canEdit && (
            <>
              <hr style={{ border: "none", borderTop: "1px solid #21262d", margin: "4px 0" }} />

              {schedule.status === "待審核" && (
                <div>
                  <div style={labelStyle}>指定設備（留空自動排程）</div>
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">自動選擇最早可用設備</option>
                    {DEVICE_IDS.map((id) => (
                      <option key={id} value={id}>{id}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <div style={labelStyle}>備註</div>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical" }}
                  placeholder="可選"
                />
              </div>

              {error && <div style={{ color: "#f85149", fontSize: 13 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {role === "admin" && (
                  <button onClick={del} style={{ ...cancelBtn, color: "#f85149", borderColor: "#f85149" }}>
                    刪除
                  </button>
                )}
                {schedule.status !== "已取消" && schedule.status !== "已完成" && (
                  <button onClick={cancel} disabled={saving} style={cancelBtn}>
                    取消排程
                  </button>
                )}
                {schedule.status === "待審核" && (
                  <button onClick={confirm} disabled={saving} style={primaryBtn}>
                    {saving ? "處理中..." : "確認排程"}
                  </button>
                )}
                {schedule.status !== "待審核" && (
                  <button onClick={saveNote} disabled={saving} style={primaryBtn}>
                    {saving ? "儲存中..." : "儲存備註"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 標記不可用時段 Modal ────────────────────────────────────────────────────

function BlockDeviceModal({ onClose, onCreated }) {
  const { showToast } = useToast();
  const [form, setForm] = useState({
    device_id: DEVICE_IDS[0],
    start_time: "",
    end_time: "",
    reason: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!form.start_time || !form.end_time) return setError("請填入開始與結束時間");
    if (new Date(form.end_time) <= new Date(form.start_time)) return setError("結束時間必須晚於開始時間");
    setSaving(true);
    setError("");
    try {
      const res = await api.post("/api/device-blocked-periods", {
        device_id: form.device_id,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        reason: form.reason.trim() || null,
      });
      onCreated(res.data);
      showToast("不可用時段已添加", "success");
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>標記設備不可用時段</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={labelStyle}>設備</div>
            <select value={form.device_id} onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
              style={inputStyle}>
              {DEVICE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <div style={labelStyle}>開始時間</div>
              <input type="datetime-local" value={form.start_time}
                onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                style={inputStyle} />
            </div>
            <div>
              <div style={labelStyle}>結束時間</div>
              <input type="datetime-local" value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                style={inputStyle} />
            </div>
          </div>
          <LabelInput label="原因" value={form.reason}
            onChange={(v) => setForm((f) => ({ ...f, reason: v }))} placeholder="e.g. 年度校正" />
          {error && <div style={{ color: "#f85149", fontSize: 13 }}>{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} style={cancelBtn}>取消</button>
            <button onClick={submit} disabled={saving} style={primaryBtn}>
              {saving ? "儲存中..." : "標記不可用"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 摘要卡 ──────────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color }) {
  return (
    <div style={{
      background: "#161b22", border: "1px solid #30363d", borderRadius: 8,
      padding: "12px 16px", flex: 1, minWidth: 100,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "#cdd9e5" }}>{value}</div>
      <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ── 小工具元件 ──────────────────────────────────────────────────────────────

function LabelInput({ label, value, onChange, placeholder }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

function InfoRow({ label, value, muted }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: "#8b949e", minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: muted ? "#6e7681" : "#cdd9e5", wordBreak: "break-word", fontStyle: muted ? "italic" : "normal" }}>{value}</span>
    </div>
  );
}

// ── 共用樣式 ─────────────────────────────────────────────────────────────────

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};
const modalStyle = {
  background: "#161b22", border: "1px solid #30363d", borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)", overflow: "hidden",
};
const modalHeader = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "14px 20px", borderBottom: "1px solid #30363d",
  background: "#0d1117",
};
const closeBtn = {
  background: "none", border: "none", color: "#8b949e",
  cursor: "pointer", fontSize: 16, padding: "2px 6px",
};
const inputStyle = {
  width: "100%", background: "#0d1117", border: "1px solid #30363d",
  borderRadius: 6, padding: "7px 10px", color: "#cdd9e5",
  fontSize: 13, boxSizing: "border-box", outline: "none",
};
const labelStyle = { fontSize: 12, color: "#8b949e", marginBottom: 4, fontWeight: 600 };
const primaryBtn = {
  background: "#238636", border: "1px solid #2ea043", color: "#fff",
  padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 600,
};
const cancelBtn = {
  background: "transparent", border: "1px solid #30363d", color: "#8b949e",
  padding: "7px 16px", borderRadius: 6, cursor: "pointer", fontSize: 13,
};

// ── 主頁面 ───────────────────────────────────────────────────────────────────

export default function SchedulePage({ active, role, userId }) {
  const [schedules, setSchedules] = useState([]);
  const [blockedPeriods, setBlockedPeriods] = useState([]);
  const [standardsTree, setStandardsTree] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [filterStatus, setFilterStatus] = useState("all");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  // 顯示今天前 3 天 ~ 後 30 天
  const rangeStart = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const rangeEnd = rangeStart + (33 * 86400000);

  const fetchAll = useCallback(async () => {
    try {
      const [ganttRes, treeRes] = await Promise.all([
        api.get("/api/schedules/gantt"),
        standardsTree ? null : api.get("/api/schedules/standards-tree"),
      ]);
      setSchedules(ganttRes.data.schedules);
      setBlockedPeriods(ganttRes.data.blocked_periods);
      if (treeRes) setStandardsTree(treeRes.data);
      setLastRefreshed(new Date());
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
  }, [active]);

  const canOperate = role === "admin" || role === "keeper" || role === "engineer";
  const isAdmin = role === "admin";

  // 摘要計算
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
      background: "#0d1117", overflow: "hidden",
    }}>
      {/* 頁頭 */}
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #30363d",
        display: "flex", flexDirection: "column", gap: 10,
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", gap: 8 }}>
          <SummaryCard label="待審核" value={summary["待審核"]} color="#8b949e" />
          <SummaryCard label="已確認" value={summary["已確認"]} color="#388bfd" />
          <SummaryCard label="進行中" value={summary["進行中"]} color="#3fb950" />
          <SummaryCard label="已完成" value={summary["已完成"]} color="#238636" />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastRefreshed && (
            <span style={{ fontSize: 11, color: "#484f58", whiteSpace: "nowrap" }}>
              更新於 {lastRefreshed.getHours().toString().padStart(2,"0")}:{lastRefreshed.getMinutes().toString().padStart(2,"0")}:{lastRefreshed.getSeconds().toString().padStart(2,"0")}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="重新載入排程資料"
            style={{ ...cancelBtn, fontSize: 12 }}
          >
            {refreshing ? "刷新中..." : "↻ 刷新"}
          </button>
          {isAdmin && (
            <button
              onClick={() => setShowBlockModal(true)}
              style={{ ...cancelBtn, fontSize: 12 }}
            >
              標記不可用時段
            </button>
          )}
          {canOperate && (
            <button
              onClick={() => setShowNewModal(true)}
              style={primaryBtn}
            >
              + 申請排程
            </button>
          )}
        </div>
      </div>

      {/* 主內容（可捲動） */}
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 12 }}>

        {/* 待審核警示條 */}
        {summary["待審核"] > 0 && (
          <div
            style={{
              background: "#3a2a1a",
              border: "1px solid #f0a50044",
              borderRadius: 6,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 8,
              cursor: "pointer",
            }}
            onClick={() => {
              const pending = document.querySelector('[style*="待審核排程隊列"]');
              pending?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }}
          >
            <span style={{ fontSize: 14, color: "#f0a500", fontWeight: 700 }}>⚠️</span>
            <span style={{ color: "#f0a500", fontSize: 13, fontWeight: 600 }}>
              有 {summary["待審核"]} 筆排程申請待審核
            </span>
            <span style={{ fontSize: 11, color: "#8b949e" }}>— 點擊滾動至隊列</span>
          </div>
        )}

        {/* 甘特圖 */}
        {loading ? (
          <div style={{ textAlign: "center", color: "#484f58", padding: 40, fontSize: 13 }}>
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

        {/* 待審核隊列 */}
        {(() => {
          const pending = schedules.filter((s) => s.status === "待審核");
          if (pending.length === 0) return null;
          return (
            <div style={{ border: "1px solid #484f58", borderRadius: 8, overflow: "hidden", background: "#0d1117" }}>
              <div style={{
                padding: "6px 12px",
                background: "#161b22",
                borderBottom: "1px solid #30363d",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <span style={{ fontSize: 11, color: "#8b949e", fontWeight: 700, letterSpacing: 1 }}>待審核排程隊列</span>
                <span style={{
                  background: "#30363d", color: "#8b949e",
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
                      borderBottom: idx < pending.length - 1 ? "1px solid #21262d" : "none",
                      cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#161b22"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <span style={{ fontSize: 11, color: "#484f58", fontFamily: "monospace", width: 24, flexShrink: 0 }}>
                      #{idx + 1}
                    </span>
                    <span style={{ fontSize: 12, color: "#cdd9e5", fontFamily: "monospace", minWidth: 90 }}>
                      {s.project_number}
                    </span>
                    <span style={{ fontSize: 12, color: "#cdd9e5", flex: 1 }}>{s.sample_name}</span>
                    <span style={{ fontSize: 11, color: "#8b949e", minWidth: 60 }}>{s.applicant_name || "—"}</span>
                    <span style={{ fontSize: 11, color: "#e3b341", minWidth: 60, textAlign: "right" }}>
                      {fmtHours(s.total_hours)}
                    </span>
                    <span style={{ fontSize: 10, color: "#484f58", minWidth: 100, textAlign: "right" }}>
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
              <span style={{ fontSize: 11, color: "#8b949e" }}>{s}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{
              width: 14, height: 10, borderRadius: 2,
              background: "repeating-linear-gradient(135deg, #2d1a1a 0px, #2d1a1a 3px, #1a0a0a 3px, #1a0a0a 6px)",
              border: "1px solid #6e1b1b",
            }} />
            <span style={{ fontSize: 11, color: "#8b949e" }}>不可用時段</span>
          </div>
        </div>

        {/* 排程清單 */}
        <div>
          {/* 篩選列 */}
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {["all", ...STATUS_LIST].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "4px 12px", fontSize: 12, borderRadius: 20,
                  cursor: "pointer",
                  background: filterStatus === s ? "#1c3a5e" : "transparent",
                  color: filterStatus === s ? "#79c0ff" : "#8b949e",
                  border: filterStatus === s ? "1px solid #388bfd" : "1px solid #30363d",
                }}
              >
                {s === "all" ? "全部" : s}
              </button>
            ))}
          </div>

          {/* 表格 */}
          {filteredSchedules.length === 0 ? (
            <div style={{ textAlign: "center", color: "#484f58", padding: 32, fontSize: 13 }}>
              {filterStatus === "all" ? "尚無排程紀錄" : `無「${filterStatus}」的排程`}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ color: "#8b949e", borderBottom: "1px solid #30363d" }}>
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
                        borderBottom: "1px solid #21262d", cursor: "pointer",
                        transition: "background 0.15s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "#161b22"}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "6px 8px" }}>
                        <span style={{
                          padding: "2px 8px", borderRadius: 10, fontSize: 11,
                          background: color.bg, color: color.text,
                          border: `1px solid ${color.border}`, whiteSpace: "nowrap",
                        }}>{s.status}</span>
                      </td>
                      <td style={{ padding: "6px 8px", color: "#cdd9e5", fontFamily: "monospace" }}>{s.project_number}</td>
                      <td style={{ padding: "6px 8px", color: "#cdd9e5" }}>{s.sample_name}</td>
                      <td style={{ padding: "6px 8px", color: "#8b949e" }}>{s.applicant_name || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#8b949e", fontFamily: "monospace" }}>{s.device_id || "—"}</td>
                      <td style={{ padding: "6px 8px", color: "#8b949e", whiteSpace: "nowrap" }}>{fmtDt(s.start_time)}</td>
                      <td style={{ padding: "6px 8px", color: "#8b949e", whiteSpace: "nowrap" }}>{fmtDt(s.end_time)}</td>
                      <td style={{ padding: "6px 8px", color: "#e3b341", whiteSpace: "nowrap" }}>{fmtHours(s.total_hours)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Modals */}
      {showNewModal && standardsTree && (
        <NewScheduleModal
          standardsTree={standardsTree}
          onClose={() => setShowNewModal(false)}
          onCreated={(s) => {
            setSchedules((prev) => [s, ...prev]);
            setShowNewModal(false);
          }}
        />
      )}

      {showBlockModal && (
        <BlockDeviceModal
          onClose={() => setShowBlockModal(false)}
          onCreated={(b) => {
            setBlockedPeriods((prev) => [...prev, b]);
            setShowBlockModal(false);
          }}
        />
      )}

      {selectedSchedule && (
        <ScheduleDetailModal
          schedule={selectedSchedule}
          role={role}
          userId={userId}
          onClose={() => setSelectedSchedule(null)}
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
