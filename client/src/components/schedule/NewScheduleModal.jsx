import { useState, useEffect, useMemo } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import ConfirmModal from "../ConfirmModal";
import ConditionPicker from "./ConditionPicker";
import ScheduleModalShell from "./ScheduleModalShell";
import {
  fmtDt, fmtHours, BUFFER_TIME_HOURS,
  inputStyle, labelStyle, primaryBtn, cancelBtn,
} from "./scheduleUtils";
import { C } from "../../styles/theme";

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

export default function NewScheduleModal({ standardsTree, sopIdMap, initialConditions, onClose, onCreated }) {
  const { showToast } = useToast();
  const initStd = useMemo(() => {
    const fallback = Object.keys(standardsTree)[0] || "";
    if (initialConditions?.length > 0 && sopIdMap) {
      return sopIdMap[initialConditions[0]]?.stdName || fallback;
    }
    return fallback;
  }, [initialConditions, sopIdMap, standardsTree]);
  const initVer = useMemo(() => {
    if (initialConditions?.length > 0 && sopIdMap) {
      return sopIdMap[initialConditions[0]]?.verName || "";
    }
    return "";
  }, [initialConditions, sopIdMap]);
  const [form, setForm] = useState({
    project_number: "",
    sample_name: "",
    standard: initStd,
    conditions: initialConditions || [],
    fixtures: [],
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [dragIndex, setDragIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [fixtures, setFixtures] = useState({ status: "loading", data: [] });
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);

  const loadFixtures = () => {
    setFixtures({ status: "loading", data: [] });
    api.get("/api/fixtures/")
      .then((r) => setFixtures({ status: "ok", data: Array.isArray(r.data) ? r.data : [] }))
      .catch((e) => { console.error("[fixtures]", e?.response?.status, e?.message); setFixtures({ status: "error", data: [] }); });
  };

  useEffect(() => { loadFixtures(); }, []);

  const isDirty = useMemo(() => !!(
    form.project_number.trim() ||
    form.sample_name.trim() ||
    form.note.trim() ||
    form.conditions.length > (initialConditions?.length || 0) ||
    form.fixtures.length > 0
  ), [form, initialConditions]);

  const handleClose = () => {
    if (isDirty) { setShowCloseConfirm(true); return; }
    onClose();
  };

  const totalHours = form.conditions.reduce((acc, sop_id) => {
    const std = findStd(sop_id);
    return acc + (std?.estimated_hours || 0);
  }, 0) + Math.max(0, form.conditions.length - 1) * BUFFER_TIME_HOURS;

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

  function findStd(sop_id) {
    return sopIdMap?.[sop_id]?.test || null;
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
        fixtures: form.fixtures,
        note: form.note.trim() || null,
      });
      showToast("排程申請已送出，待管理者審核", "success");
      onCreated(res.data);
    } catch (e) {
      setError(e.response?.data?.detail || "申請失敗");
      showToast(e.response?.data?.detail || "申請失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <ScheduleModalShell title="申請排程" width={680} maxHeight="88vh" onClose={handleClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "16px 20px 20px", overflowY: "auto" }}>
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
              initialStd={form.standard}
              initialVer={initVer}
            />
          </div>

          {form.conditions.length > 0 && (
            <>
            <div style={{
              background: C.surface, borderRadius: 6, padding: "10px 12px",
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>已選條件（依序執行，可拖曳排序）</div>
              {form.conditions.map((sop_id, i) => {
                const t = findStd(sop_id);
                const isOver = dragOverIndex === i && dragIndex !== i;
                return (
                  <div
                    key={sop_id}
                    draggable
                    onDragStart={() => setDragIndex(i)}
                    onDragOver={(e) => { e.preventDefault(); setDragOverIndex(i); }}
                    onDrop={() => {
                      if (dragIndex === null || dragIndex === i) return;
                      const next = [...form.conditions];
                      const [moved] = next.splice(dragIndex, 1);
                      next.splice(i, 0, moved);
                      setForm((f) => ({ ...f, conditions: next }));
                      setDragIndex(null);
                      setDragOverIndex(null);
                    }}
                    onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, marginBottom: 4,
                      borderRadius: 4, padding: "2px 0",
                      borderTop: isOver ? `2px solid ${C.accent}` : "2px solid transparent",
                      opacity: dragIndex === i ? 0.4 : 1,
                      transition: "opacity .15s",
                    }}
                  >
                    <span style={{ fontSize: 14, color: C.textDim, cursor: "grab", userSelect: "none" }}>⠿</span>
                    <span style={{ fontSize: 11, color: C.textDim, width: 18 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12, color: C.textPrimary, flex: 1 }}>{t?.name || sop_id}</span>
                    <span style={{ fontSize: 11, color: C.success }}>≈ {t?.estimated_hours}h</span>
                    <button
                      onClick={() => setForm((f) => ({ ...f, conditions: f.conditions.filter((s) => s !== sop_id) }))}
                      style={{ background: "none", border: "none", color: C.error, cursor: "pointer", fontSize: 12 }}
                    >✕</button>
                  </div>
                );
              })}
              <div style={{ borderTop: `1px solid ${C.surfaceHover}`, marginTop: 6, paddingTop: 6, fontSize: 12, color: C.textMuted }}>
                預估總時長：<span style={{ color: C.warningAlt, fontWeight: 700 }}>{fmtHours(totalHours)}</span>
                <span style={{ fontSize: 10, marginLeft: 6 }}>（含 {Math.max(0, form.conditions.length - 1)} × 30min 緩衝）</span>
              </div>
            </div>

            {previewing ? (
              <div style={{ background: C.surface, borderRadius: 6, padding: "10px 12px", border: `1px solid ${C.border}`, color: C.textMuted, fontSize: 12 }}>
                ⏳ 計算預估時間中...
              </div>
            ) : preview ? (
              <div style={{
                background: C.successBgMid, borderRadius: 6, padding: "10px 12px",
                border: `1px solid ${C.success}`, borderLeft: `3px solid ${C.success}`,
              }}>
                <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>📋 預估時間（待管理員分配設備）</div>
                <div style={{ fontSize: 12, color: C.textPrimary, marginBottom: 4 }}>
                  🕐 預計開始：<span style={{ color: C.accentLight }}>{fmtDt(preview.start_time)}</span>
                </div>
                <div style={{ fontSize: 12, color: C.textPrimary }}>
                  🏁 預計結束：<span style={{ color: C.accentLight }}>{fmtDt(preview.end_time)}</span>
                </div>
              </div>
            ) : null}
            </>
          )}

          <div>
            <div style={labelStyle}>治具需求（選填）</div>
            <div style={{
              background: C.surface, borderRadius: 6, border: `1px solid ${C.border}`,
              maxHeight: 180, overflowY: "auto",
            }}>
              {fixtures.status === "error" ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: C.error, display: "flex", alignItems: "center", gap: 8 }}>
                  治具資料載入失敗
                  <button onClick={loadFixtures} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: C.surfaceHover, border: `1px solid ${C.border}`, color: C.textPrimary, cursor: "pointer" }}>重試</button>
                </div>
              ) : fixtures.status === "loading" ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: C.textMuted }}>載入中…</div>
              ) : fixtures.data.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: C.textMuted }}>無治具資料</div>
              ) : fixtures.data.map((f) => {
                const sel = form.fixtures.find((x) => x.fixture_id === f.id);
                const checked = !!sel;
                const qty = sel?.quantity ?? 1;
                return (
                  <div key={f.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "6px 12px", borderBottom: `1px solid ${C.surfaceHover}`,
                  }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setForm((prev) => ({ ...prev, fixtures: [...prev.fixtures, { fixture_id: f.id, quantity: 1 }] }));
                        } else {
                          setForm((prev) => ({ ...prev, fixtures: prev.fixtures.filter((x) => x.fixture_id !== f.id) }));
                        }
                      }}
                      style={{ cursor: "pointer", accentColor: C.accentLink }}
                    />
                    <span style={{ fontSize: 12, color: C.textPrimary, flex: 1 }}>
                      {f.interface_type} {f.form_factor}{f.size ? ` ${f.size}` : ""}
                    </span>
                    <span style={{ fontSize: 11, color: f.available_quantity > 0 ? C.success : C.error }}>
                      可借 {f.available_quantity}
                    </span>
                    {checked && (
                      <input
                        type="number"
                        min={1}
                        max={f.available_quantity || 1}
                        value={qty}
                        onChange={(e) => {
                          const q = Math.max(1, Math.min(f.available_quantity || 1, parseInt(e.target.value) || 1));
                          setForm((prev) => ({
                            ...prev,
                            fixtures: prev.fixtures.map((x) => x.fixture_id === f.id ? { ...x, quantity: q } : x),
                          }));
                        }}
                        style={{
                          width: 48, padding: "2px 6px", borderRadius: 4, fontSize: 12,
                          background: C.bg, border: `1px solid ${C.border}`, color: C.textPrimary,
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {form.fixtures.length > 0 && (
              <div style={{ fontSize: 11, color: C.reserved, marginTop: 4 }}>
                已選 {form.fixtures.length} 種治具，確認後自動預約
              </div>
            )}
          </div>

          <LabelInput label="備註" value={form.note}
            onChange={(v) => setForm((f) => ({ ...f, note: v }))} placeholder="可選" />

          {error && <div style={{ color: C.error, fontSize: 13 }}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
            <button onClick={handleClose} style={cancelBtn}>取消</button>
            <button onClick={submit} disabled={saving} style={primaryBtn}>
              {saving ? "送出中..." : "送出申請"}
            </button>
          </div>
      </div>
    </ScheduleModalShell>
    {showCloseConfirm && (
      <ConfirmModal
        title="確認關閉"
        message="表單尚未送出，確定要關閉？資料將會消失。"
        type="warning"
        confirmText="關閉"
        cancelText="繼續填寫"
        onConfirm={() => { setShowCloseConfirm(false); onClose(); }}
        onCancel={() => setShowCloseConfirm(false)}
      />
    )}
    </>
  );
}
