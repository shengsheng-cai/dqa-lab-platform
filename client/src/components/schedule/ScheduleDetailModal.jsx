import { useState, useEffect, useCallback } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import ConfirmModal from "../ConfirmModal";
import { DEVICE_IDS } from "../../constants";
import ScheduleModalShell from "./ScheduleModalShell";
import {
  fmtDt, fmtHours, STATUS_COLOR,
  inputStyle, labelStyle, primaryBtn, cancelBtn,
} from "./scheduleUtils";
import { C } from "../../styles/theme";

function InfoRow({ label, value, muted }) {
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
      <span style={{ color: C.textMuted, minWidth: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: muted ? C.textFaint : C.textPrimary, wordBreak: "break-word", fontStyle: muted ? "italic" : "normal" }}>{value}</span>
    </div>
  );
}

const SUCCESS_BANNER = { background: C.successBgDeep, border: `1px solid ${C.success}`, borderRadius: 8, padding: "12px 16px", fontSize: 13, color: C.successText, fontWeight: 600 };

function ResultScreen({ title, message, fields, onClose }) {
  return (
    <ScheduleModalShell title={title} width={540} onClose={onClose}>
      <div style={{ padding: "20px 24px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={SUCCESS_BANNER}>{message}</div>
        {fields.map(({ label, value }) => <InfoRow key={label} label={label} value={value} />)}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
          <button onClick={onClose} style={primaryBtn}>關閉</button>
        </div>
      </div>
    </ScheduleModalShell>
  );
}

export default function ScheduleDetailModal({ schedule, role, deviceStatuses = {}, onClose, onUpdated, onDeleted, onRefresh }) {
  const { showToast } = useToast();
  const [deviceId, setDeviceId] = useState(schedule.device_id || "");
  const [note, setNote] = useState(schedule.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [previewState, setPreviewState] = useState({ data: null, loading: false, updatedAt: null });
  const [resultScreen, setResultScreen] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canEdit = role === "admin";
  const isPending = schedule.status === "待審核";

  const fetchPreview = useCallback(() => {
    if (!isPending) return;
    const conditions = schedule.conditions?.join(",") || "";
    if (!conditions) return;
    setPreviewState(s => ({ ...s, loading: true }));
    api
      .get("/api/schedules/preview", { params: { conditions, device_id: deviceId || undefined } })
      .then((r) => setPreviewState({ data: r.data, loading: false, updatedAt: new Date() }))
      .catch(() => setPreviewState(s => ({ ...s, data: null, loading: false })));
  }, [deviceId, isPending, schedule.conditions?.join(",")]);

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
      setResultScreen({ type: "confirmed", data: res.data });
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!cancelOpen) { setCancelOpen(true); return; }
    setSaving(true);
    try {
      const res = await api.patch(`/api/schedules/${schedule.id}`, {
        status: "已取消",
        note: note || null,
        rejection_note: cancelReason.trim() || null,
      });
      showToast("排程已取消", "success");
      onUpdated(res.data);
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error", 4000, e.response?.data?.hint);
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
      showToast(e.response?.data?.detail || "操作失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  async function confirmCondition() {
    setSaving(true);
    setError("");
    try {
      const res = await api.post(`/api/schedules/${schedule.id}/confirm-condition`);
      if (res.data.status === "completed") {
        showToast("排程全部條件完成！", "success");
        onUpdated({ ...schedule, status: "已完成" });
        setResultScreen({ type: "completed" });
      } else {
        showToast(`已啟動下一條件：${res.data.sop_id}`, "success");
        onUpdated({ ...schedule });
        onRefresh?.();
      }
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  async function startNow() {
    setSaving(true);
    setError("");
    try {
      await api.post(`/api/schedules/${schedule.id}/start`);
      showToast("排程已立即啟動", "success");
      onRefresh?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  function del() {
    setShowDeleteConfirm(true);
  }

  async function performDel() {
    setShowDeleteConfirm(false);
    try {
      await api.delete(`/api/schedules/${schedule.id}`);
      onDeleted(schedule.id);
    } catch (e) {
      setError(e.response?.data?.detail || "刪除失敗");
      showToast(e.response?.data?.detail || "刪除失敗", "error", 4000, e.response?.data?.hint);
    }
  }

  const color = STATUS_COLOR[schedule.status] || STATUS_COLOR["待審核"];

  if (resultScreen?.type === "completed") {
    const total = (schedule.conditions || []).length;
    return (
      <ResultScreen
        title="測試完成"
        message={`✅ 全部 ${total} 個條件已完成，排程結束`}
        fields={[
          { label: "專案", value: `${schedule.project_number} / ${schedule.sample_name}` },
          { label: "設備", value: schedule.device_id || "—" },
          { label: "條件數", value: `${total} 個` },
        ]}
        onClose={onClose}
      />
    );
  }

  if (resultScreen?.type === "confirmed") {
    const r = resultScreen.data;
    return (
      <ResultScreen
        title="排程已確認"
        message="排程確認成功，以下為最終分配結果："
        fields={[
          { label: "專案", value: `${r.project_number} / ${r.sample_name}` },
          { label: "指定設備", value: r.device_id || "—" },
          { label: "開始時間", value: fmtDt(r.start_time) },
          { label: "結束時間", value: fmtDt(r.end_time) },
          { label: "預估時長", value: fmtHours(r.total_hours) },
        ]}
        onClose={onClose}
      />
    );
  }

  return (
    <>
    <ScheduleModalShell title="排程詳情" width={540} maxHeight="88vh" onClose={onClose}>
      <div style={{ padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              padding: "3px 10px", borderRadius: 12, fontSize: 12, fontWeight: 700,
              background: color.bg, color: color.text, border: `1px solid ${color.border}`,
            }}>{schedule.status}</span>
            <span style={{ fontSize: 13, color: C.textPrimary, fontWeight: 700 }}>
              {schedule.project_number} / {schedule.sample_name}
            </span>
          </div>

          <InfoRow label="申請人" value={schedule.applicant_name || "—"} />
          <InfoRow label="法規標準" value={schedule.standard} />
          <div style={{ display: "flex", gap: 8, fontSize: 13 }}>
            <span style={{ color: C.textMuted, minWidth: 80, flexShrink: 0 }}>測試條件</span>
            <div style={{ flex: 1, maxHeight: 200, overflowY: "auto" }}>
              {(schedule.condition_names || schedule.conditions || []).length > 0
                ? (schedule.condition_names || schedule.conditions).map((c, i) => (
                    <div key={i} style={{ color: C.textPrimary, lineHeight: 1.6, paddingBottom: 2 }}>
                      {i + 1}. {c}
                    </div>
                  ))
                : <span style={{ color: C.textPrimary }}>—</span>}
            </div>
          </div>
          {schedule.fixtures?.length > 0 && (
            <InfoRow label="預約治具" value={
              schedule.fixtures.map((fx) =>
                `${fx.interface_type || ""} ${fx.form_factor || ""}`.trim() + ` ×${fx.quantity}`
              ).join("、")
            } />
          )}
          <InfoRow label="預估時長" value={fmtHours(schedule.total_hours)} />
          <InfoRow
            label="指定設備"
            value={
              isPending
                ? previewState.loading ? "計算中..." : (previewState.data?.device_id || "—")
                : schedule.device_id || "（自動排程）"
            }
          />
          <InfoRow
            label="開始時間"
            value={
              isPending
                ? previewState.loading ? "計算中..." : (previewState.data ? fmtDt(previewState.data.start_time) : "—")
                : fmtDt(schedule.start_time)
            }
            muted={isPending}
          />
          <InfoRow
            label="結束時間"
            value={
              isPending
                ? previewState.loading ? "計算中..." : (previewState.data ? fmtDt(previewState.data.end_time) : "—")
                : fmtDt(schedule.end_time)
            }
            muted={isPending}
          />

          {isPending && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: C.textDim }}>
                {previewState.updatedAt
                  ? `預覽計算於 ${previewState.updatedAt.getHours().toString().padStart(2,"0")}:${previewState.updatedAt.getMinutes().toString().padStart(2,"0")}:${previewState.updatedAt.getSeconds().toString().padStart(2,"0")}，確認前建議刷新`
                  : "預覽計算中..."}
              </span>
              <button
                onClick={fetchPreview}
                disabled={previewState.loading}
                style={{ ...cancelBtn, fontSize: 11, padding: "2px 8px" }}
              >
                {previewState.loading ? "計算中..." : "↻ 刷新預覽"}
              </button>
            </div>
          )}

          <InfoRow label="申請時間" value={fmtDt(schedule.created_at)} />

          {canEdit && (
            <>
              <hr style={{ border: "none", borderTop: `1px solid ${C.surfaceHover}`, margin: "4px 0" }} />

              {schedule.status === "待審核" && (
                <div>
                  <div style={labelStyle}>指定設備（留空自動排程）</div>
                  <select
                    value={deviceId}
                    onChange={(e) => setDeviceId(e.target.value)}
                    style={inputStyle}
                  >
                    <option value="">自動選擇最早可用設備</option>
                    {DEVICE_IDS.map((id) => {
                      const st = deviceStatuses[id];
                      const blocked = st === "EMERGENCY" || st === "BLOCKED";
                      return (
                        <option key={id} value={id} disabled={blocked}>
                          {id}{st ? ` (${st})` : ""}
                        </option>
                      );
                    })}
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

              {schedule.rejection_note && (
                <div style={{ padding: "8px 10px", borderRadius: 6, background: C.errorBg, border: `1px solid ${C.error}`, fontSize: 12, color: C.errorLight }}>
                  <span style={{ fontWeight: 600 }}>取消原因：</span>{schedule.rejection_note}
                </div>
              )}

              {cancelOpen && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {schedule.status === "進行中" && (
                    <div style={{ fontSize: 12, color: C.error, background: C.errorBg, border: `1px solid ${C.error}`, borderRadius: 6, padding: "8px 10px", fontWeight: 600 }}>
                      ⚠️ {schedule.device_id} 正在執行測試中，取消將強制停止目前的溫度循環
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: C.error }}>請填寫取消原因（選填），再次點擊確認取消</div>
                  <textarea
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    rows={2}
                    placeholder="例：測試需求變更、設備衝突..."
                    style={{ ...inputStyle, resize: "vertical", borderColor: C.error }}
                  />
                </div>
              )}

              {error && <div style={{ color: C.error, fontSize: 13 }}>{error}</div>}

              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                {role === "admin" && (schedule.status === "已取消" || schedule.status === "已完成") && (
                  <button onClick={del} style={{ ...cancelBtn, color: C.error, borderColor: C.errorDark }}>
                    刪除
                  </button>
                )}
                {schedule.status !== "已取消" && schedule.status !== "已完成" && (
                  <button onClick={cancel} disabled={saving} style={cancelOpen ? { ...cancelBtn, color: C.error, borderColor: C.errorDark } : cancelBtn}>
                    {cancelOpen ? (saving ? "取消中..." : "確認取消排程") : "取消排程"}
                  </button>
                )}
                {cancelOpen && (
                  <button onClick={() => { setCancelOpen(false); setCancelReason(""); }} style={cancelBtn}>
                    返回
                  </button>
                )}
                {schedule.status === "待審核" && (
                  <button onClick={confirm} disabled={saving} style={primaryBtn}>
                    {saving ? "處理中..." : "確認排程"}
                  </button>
                )}
                {schedule.status === "已確認" && (
                  <button onClick={startNow} disabled={saving} style={{ ...primaryBtn, background: C.accentDark }}>
                    {saving ? "啟動中..." : "▶ 立即開始"}
                  </button>
                )}
                {schedule.status === "進行中" && ["IDLE", "BLOCKED"].includes(deviceStatuses[schedule.device_id]) && (() => {
                  const conds = schedule.conditions || [];
                  const idx = schedule.current_condition_index ?? 0;
                  const isLast = idx >= conds.length;
                  const label = isLast ? "✅ 確認完成" : `▶ 開始第 ${idx + 1} 條件（共 ${conds.length}）`;
                  return (
                    <button onClick={confirmCondition} disabled={saving} style={{ ...primaryBtn, background: isLast ? C.successDark : C.accentDark }}>
                      {saving ? "處理中..." : label}
                    </button>
                  );
                })()}
                {schedule.status !== "待審核" && (
                  <button onClick={saveNote} disabled={saving} style={primaryBtn}>
                    {saving ? "儲存中..." : "儲存備註"}
                  </button>
                )}
              </div>
            </>
          )}
      </div>
    </ScheduleModalShell>
    {showDeleteConfirm && (
      <ConfirmModal
        title="刪除排程"
        message="確定刪除此排程？此動作無法復原。"
        type="danger"
        confirmText="刪除"
        onConfirm={performDel}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    )}
    </>
  );
}
