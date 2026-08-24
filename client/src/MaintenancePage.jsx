import { useState, useEffect, useCallback } from "react";
import api from "./api";
import { DEVICE_IDS } from "./constants";
import { useToast } from "./components/useToast";
import DatePicker from "./components/fixture/DatePicker";
import DateTimePicker from "./components/schedule/DateTimePicker";
import { localDateStamp } from "./utils/timezone";
import {
  dateOnlyToApi,
  formatDateOnly,
  formatLocalDateTime,
  isKnownMaintenanceType,
  localDateTimeToApi,
  maintenanceTypeLabel,
  toDateOnlyInput,
  toLocalDateTimeInput,
} from "./utils/maintenance";
import { C } from "./styles/theme";

const pickerStyle = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 5,
  color: C.textPrimary,
  fontSize: 12,
};

function FieldRow({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: C.textMuted }}>{label}</label>
      <input
        type="text"
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.textPrimary, padding: "5px 8px", fontSize: 12 }}
      />
    </div>
  );
}

function DateFieldRow({ label, value, onChange, optional = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label}{optional ? "（選填）" : " *"}</div>
      {optional && !value ? (
        <button
          type="button"
          onClick={() => onChange(localDateStamp("-"))}
          style={{ ...pickerStyle, alignSelf: "flex-start", padding: "5px 10px", cursor: "pointer" }}
        >
          ＋ 設定日期
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <DatePicker label={label} value={value} onChange={onChange} style={pickerStyle} />
          {optional && (
            <button
              type="button"
              onClick={() => onChange("")}
              style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontSize: 11 }}
            >
              清除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DateTimeFieldRow({ label, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 11, color: C.textMuted }}>{label} *</div>
      <DateTimePicker label={label} value={value} onChange={onChange} style={pickerStyle} />
    </div>
  );
}

export default function MaintenancePage({ active, role, onCalibrationChange }) {
  const { showToast } = useToast();
  const [selectedDevice, setSelectedDevice] = useState("CH-01");
  const [calibrations, setCalibrations] = useState([]);
  const [maintenances, setMaintenances] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState("calibrations");
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const fetchCalibrations = useCallback(async () => {
    try {
      const res = await api.get(`/api/devices/${selectedDevice}/calibrations`);
      setCalibrations(res.data);
    } catch { /* ignore */ }
  }, [selectedDevice]);

  const fetchMaintenances = useCallback(async () => {
    try {
      const res = await api.get(`/api/devices/${selectedDevice}/maintenances`);
      setMaintenances(res.data);
    } catch { /* ignore */ }
  }, [selectedDevice]);

  useEffect(() => {
    if (!active) return;
    fetchCalibrations();
    fetchMaintenances();
  }, [active, selectedDevice, fetchCalibrations, fetchMaintenances]);

  const openCreate = (type) => {
    const now = new Date();
    now.setSeconds(0, 0);
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
    const nextYear = new Date(now);
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    setModalType(type);
    setEditItem(null);
    setForm(type === "calibrations"
      ? { calibration_date: localDateStamp("-", now), next_calibration_date: localDateStamp("-", nextYear), interval_days: 365, result: "pass", notes: "", created_by: "admin" }
      : { maintenance_date: toLocalDateTimeInput(now), maintenance_type: "preventive", description: "", performed_by: "", next_maintenance_date: "" }
    );
    setShowModal(true);
  };

  const openEdit = (item, type) => {
    setModalType(type);
    setEditItem(item);
    if (type === "calibrations") {
      setForm({ calibration_date: toDateOnlyInput(item.calibration_date), next_calibration_date: toDateOnlyInput(item.next_calibration_date), interval_days: item.interval_days, result: item.result, notes: item.notes || "", created_by: item.created_by });
    } else {
      setForm({ maintenance_date: toLocalDateTimeInput(item.maintenance_date), maintenance_type: item.maintenance_type, description: item.description, performed_by: item.performed_by, next_maintenance_date: toDateOnlyInput(item.next_maintenance_date) });
    }
    setShowModal(true);
  };

  const handleSave = async () => {
    const dateFields = modalType === "calibrations"
      ? [["calibration_date", "校驗日期"], ["next_calibration_date", "下次校驗日期"]]
      : [["maintenance_date", "維護日期"]];
    for (const [field, label] of dateFields) {
      if (!form[field]) { showToast(`${label} 為必填`, "error"); return; }
    }
    // 舊資料可能帶著系統不認得的類型。後端會擋，但那是一個難看的 422，
    // 在這裡先說清楚要做什麼。
    if (modalType !== "calibrations" && !isKnownMaintenanceType(form.maintenance_type)) {
      showToast(`這筆的維護類型「${form.maintenance_type}」系統不認得，請重新選擇`, "error");
      return;
    }

    setSaving(true);
    try {
      const payload = { ...form };
      if (modalType === "calibrations") {
        payload.calibration_date = dateOnlyToApi(payload.calibration_date);
        payload.next_calibration_date = dateOnlyToApi(payload.next_calibration_date);
      } else {
        payload.maintenance_date = localDateTimeToApi(payload.maintenance_date);
        payload.next_maintenance_date = dateOnlyToApi(payload.next_maintenance_date);
      }
      if (modalType === "calibrations") payload.interval_days = parseInt(payload.interval_days) || 365;

      if (editItem) {
        if (modalType === "calibrations") await api.put(`/api/devices/${selectedDevice}/calibrations/${editItem.id}`, payload);
        else await api.put(`/api/devices/${selectedDevice}/maintenances/${editItem.id}`, payload);
        showToast("更新成功", "success");
      } else {
        if (modalType === "calibrations") await api.post(`/api/devices/${selectedDevice}/calibrations`, payload);
        else await api.post(`/api/devices/${selectedDevice}/maintenances`, payload);
        showToast("新增成功", "success");
      }
      setShowModal(false);
      if (modalType === "calibrations") fetchCalibrations(); else fetchMaintenances();
      onCalibrationChange?.();
    } catch (e) {
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, type) => {
    if (!window.confirm("確定刪除？")) return;
    setDeleting(id);
    try {
      if (type === "calibrations") await api.delete(`/api/devices/${selectedDevice}/calibrations/${id}`);
      else await api.delete(`/api/devices/${selectedDevice}/maintenances/${id}`);
      showToast("已刪除", "success");
      if (type === "calibrations") fetchCalibrations(); else fetchMaintenances();
      onCalibrationChange?.();
    } catch (e) {
      showToast(e.response?.data?.detail || "刪除失敗", "error");
    } finally {
      setDeleting(null);
    }
  };

  const thS = { padding: "6px 10px", textAlign: "left", color: C.textMuted, fontWeight: 600, fontSize: 11, borderBottom: `1px solid ${C.border}` };
  const tdS = { padding: "6px 10px", fontSize: 11, color: C.textPrimary, borderBottom: `1px solid ${C.surfaceHover}` };
  const sectionHeader = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0 6px" };
  const sectionTitle = { fontSize: 12, fontWeight: 700, color: C.textMuted, letterSpacing: 1 };
  const addBtn = { padding: "3px 10px", fontSize: 11, borderRadius: 5, cursor: "pointer", background: `${C.accentDark}22`, border: `1px solid ${C.accentDark}`, color: C.accent };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: C.bg, color: C.textPrimary, overflow: "hidden" }}>
      {/* 設備切換 */}
      <div style={{ display: "flex", gap: 6, padding: "10px 16px", flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>
        {DEVICE_IDS.map(id => (
          <button key={id} onClick={() => setSelectedDevice(id)} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 5, cursor: "pointer", background: selectedDevice === id ? C.accentDark : C.surfaceHover, border: `1px solid ${selectedDevice === id ? C.accentDark : C.border}`, color: selectedDevice === id ? C.white : C.textMuted, fontWeight: selectedDevice === id ? 700 : 400 }}>{id}</button>
        ))}
      </div>

      {/* 內容區：左右兩欄 */}
      <div style={{ flex: 1, display: "flex", gap: 0, overflow: "hidden" }}>

        {/* 左：校驗紀錄 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px", borderRight: `1px solid ${C.border}` }}>
          <div style={sectionHeader}>
            <span style={sectionTitle}>校驗紀錄</span>
            {role === "admin" && <button onClick={() => openCreate("calibrations")} style={addBtn}>+ 新增</button>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["校驗日期", "下次校驗日期", "間隔", "結果", ...(role === "admin" ? ["操作"] : [])].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {calibrations.length === 0 ? (
                <tr><td colSpan={role === "admin" ? 5 : 4} style={{ ...tdS, color: C.textDim, textAlign: "center", padding: "16px 0" }}>尚無校驗紀錄</td></tr>
              ) : calibrations.map(c => (
                <tr key={c.id}>
                  <td style={tdS}>{formatDateOnly(c.calibration_date)}</td>
                  <td style={tdS}>{formatDateOnly(c.next_calibration_date)}</td>
                  <td style={tdS}>{c.interval_days}天</td>
                  <td style={tdS}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, fontWeight: 700, background: c.result === "pass" ? C.successBg : C.errorBg, color: c.result === "pass" ? C.success : C.error, border: `1px solid ${c.result === "pass" ? "#2d5a3a" : "#5a2d2d"}` }}>{c.result === "pass" ? "通過" : "不通過"}</span>
                  </td>
                  {role === "admin" && (
                    <td style={tdS}>
                      <button onClick={() => openEdit(c, "calibrations")} style={{ marginRight: 6, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.surfaceHover, border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer" }}>編輯</button>
                      <button onClick={() => handleDelete(c.id, "calibrations")} disabled={deleting === c.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.errorBg, border: "1px solid #5a2d2d", color: C.error, cursor: "pointer" }}>刪除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 右：維護紀錄 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
          <div style={sectionHeader}>
            <span style={sectionTitle}>維護紀錄</span>
            {role === "admin" && <button onClick={() => openCreate("maintenances")} style={addBtn}>+ 新增</button>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>{["維護日期", "類型", "說明", "執行人員", "下次維護日期", ...(role === "admin" ? ["操作"] : [])].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {maintenances.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdS, color: C.textDim, textAlign: "center", padding: "16px 0" }}>尚無維護紀錄</td></tr>
              ) : maintenances.map(m => (
                <tr key={m.id}>
                  <td style={tdS}>{formatLocalDateTime(m.maintenance_date)}</td>
                  <td style={{ ...tdS, color: isKnownMaintenanceType(m.maintenance_type) ? C.textPrimary : C.warning }}>
                    {maintenanceTypeLabel(m.maintenance_type)}
                  </td>
                  <td style={{ ...tdS, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</td>
                  <td style={tdS}>{m.performed_by}</td>
                  <td style={tdS}>{formatDateOnly(m.next_maintenance_date)}</td>
                  {role === "admin" && (
                    <td style={tdS}>
                      <button onClick={() => openEdit(m, "maintenances")} style={{ marginRight: 6, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.surfaceHover, border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer" }}>編輯</button>
                      <button onClick={() => handleDelete(m.id, "maintenances")} disabled={deleting === m.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: C.errorBg, border: "1px solid #5a2d2d", color: C.error, cursor: "pointer" }}>刪除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)" }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(480px, 92vw)", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>
              {editItem ? "編輯" : "新增"}{modalType === "calibrations" ? "校驗紀錄" : "維護紀錄"} — {selectedDevice}
            </div>
            {modalType === "calibrations" ? (
              <>
                <DateFieldRow label="校驗日期" value={form.calibration_date} onChange={v => setForm(f => ({ ...f, calibration_date: v }))} />
                <DateFieldRow label="下次校驗日期" value={form.next_calibration_date} onChange={v => setForm(f => ({ ...f, next_calibration_date: v }))} />
                <FieldRow label="間隔(天)" value={form.interval_days} onChange={v => setForm(f => ({ ...f, interval_days: v }))} placeholder="365" />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: C.textMuted }}>結果</label>
                  <select value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value }))} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.textPrimary, padding: "5px 8px", fontSize: 12 }}>
                    <option value="pass">通過</option>
                    <option value="fail">不通過</option>
                  </select>
                </div>
                <FieldRow label="備註" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="選填" />
                <FieldRow label="建立人 *" value={form.created_by} onChange={v => setForm(f => ({ ...f, created_by: v }))} placeholder="admin" />
              </>
            ) : (
              <>
                <DateTimeFieldRow label="維護日期" value={form.maintenance_date} onChange={v => setForm(f => ({ ...f, maintenance_date: v }))} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: C.textMuted }}>類型</label>
                  <select value={form.maintenance_type} onChange={e => setForm(f => ({ ...f, maintenance_type: e.target.value }))} style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 5, color: C.textPrimary, padding: "5px 8px", fontSize: 12 }}>
                    {/* 舊資料的值不在清單裡時，要讓它自己站一個選項並且不能送出。
                        沒有這一項的話下拉會自動停在第一個「預防性」，使用者只是想改說明，
                        一存檔類型就被悄悄換掉了。 */}
                    {!isKnownMaintenanceType(form.maintenance_type) && (
                      <option value={form.maintenance_type} disabled>
                        {maintenanceTypeLabel(form.maintenance_type)} — 請重新選擇
                      </option>
                    )}
                    <option value="preventive">預防性</option>
                    <option value="corrective">矯正性</option>
                    <option value="inspection">例行點檢</option>
                  </select>
                </div>
                <FieldRow label="說明 *" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="維護內容說明" />
                <FieldRow label="執行人員 *" value={form.performed_by} onChange={v => setForm(f => ({ ...f, performed_by: v }))} placeholder="王工程師" />
                <DateFieldRow label="下次維護日期" value={form.next_maintenance_date} onChange={v => setForm(f => ({ ...f, next_maintenance_date: v }))} optional />
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 5, background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted, cursor: "pointer" }}>取消</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 5, background: saving ? C.surfaceHover : C.accentDark, border: "none", color: C.white, cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "儲存中..." : "儲存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
