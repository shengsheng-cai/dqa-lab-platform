import { useState, useEffect, useCallback } from "react";
import api from "./api";
import { DEVICE_IDS } from "./constants";
import { useToast } from "./components/Toast";

const MAINTENANCE_TYPE_LABEL = {
  preventive: "預防性",
  corrective: "矯正性",
  inspection: "例行點檢",
};

function FieldRow({ label, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "#8b949e" }}>{label}</label>
      <input
        type="text"
        value={value ?? ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, color: "#cdd9e5", padding: "5px 8px", fontSize: 12 }}
      />
    </div>
  );
}

export default function MaintenancePage({ active, role, onCalibrationChange }) {
  const { showToast } = useToast();
  const [selectedDevice, setSelectedDevice] = useState("CH-01");
  const [subTab, setSubTab] = useState("calibrations");
  const [calibrations, setCalibrations] = useState([]);
  const [maintenances, setMaintenances] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const fetchCalibrations = useCallback(async () => {
    try {
      const res = await api.get(`/api/devices/${selectedDevice}/calibrations`);
      setCalibrations(res.data);
    } catch (_) {}
  }, [selectedDevice]);

  const fetchMaintenances = useCallback(async () => {
    try {
      const res = await api.get(`/api/devices/${selectedDevice}/maintenances`);
      setMaintenances(res.data);
    } catch (_) {}
  }, [selectedDevice]);

  useEffect(() => {
    if (!active) return;
    fetchCalibrations();
    fetchMaintenances();
  }, [active, selectedDevice, fetchCalibrations, fetchMaintenances]);

  const openCreate = () => {
    setEditItem(null);
    setForm(subTab === "calibrations"
      ? { calibration_date: "", next_calibration_date: "", interval_days: 365, certificate_number: "", result: "pass", notes: "", created_by: "admin" }
      : { maintenance_date: "", maintenance_type: "preventive", description: "", performed_by: "", next_maintenance_date: "" }
    );
    setShowModal(true);
  };

  const openEdit = (item) => {
    setEditItem(item);
    const fmt = (v) => v ? v.replace("T", " ").slice(0, 16) : "";
    if (subTab === "calibrations") {
      setForm({ calibration_date: fmt(item.calibration_date), next_calibration_date: fmt(item.next_calibration_date), interval_days: item.interval_days, certificate_number: item.certificate_number || "", result: item.result, notes: item.notes || "", created_by: item.created_by });
    } else {
      setForm({ maintenance_date: fmt(item.maintenance_date), maintenance_type: item.maintenance_type, description: item.description, performed_by: item.performed_by, next_maintenance_date: fmt(item.next_maintenance_date) });
    }
    setShowModal(true);
  };

  const validateDateField = (val, fieldName) => {
    if (!val) return null;
    if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(val.trim())) {
      return `${fieldName} 格式錯誤，請輸入 YYYY-MM-DD 或 YYYY-MM-DD HH:MM`;
    }
    return null;
  };

  const toIso = (val) => {
    if (!val) return null;
    const v = val.trim();
    if (v.length === 10) return `${v}T00:00:00`;
    return v.replace(" ", "T") + ":00";
  };

  const handleSave = async () => {
    const dateFields = subTab === "calibrations"
      ? [["calibration_date", "校驗日期"], ["next_calibration_date", "下次校驗日期"]]
      : [["maintenance_date", "維護日期"]];
    for (const [field, label] of dateFields) {
      const err = validateDateField(form[field], label);
      if (err) { showToast(err, "error"); return; }
      if (!form[field]) { showToast(`${label} 為必填`, "error"); return; }
    }

    setSaving(true);
    try {
      const payload = { ...form };
      const isoFields = subTab === "calibrations"
        ? ["calibration_date", "next_calibration_date"]
        : ["maintenance_date", "next_maintenance_date"];
      for (const f of isoFields) {
        if (payload[f]) payload[f] = toIso(payload[f]);
        else payload[f] = null;
      }
      if (subTab === "calibrations") payload.interval_days = parseInt(payload.interval_days) || 365;

      if (editItem) {
        if (subTab === "calibrations") await api.put(`/api/devices/${selectedDevice}/calibrations/${editItem.id}`, payload);
        else await api.put(`/api/devices/${selectedDevice}/maintenances/${editItem.id}`, payload);
        showToast("更新成功", "success");
      } else {
        if (subTab === "calibrations") await api.post(`/api/devices/${selectedDevice}/calibrations`, payload);
        else await api.post(`/api/devices/${selectedDevice}/maintenances`, payload);
        showToast("新增成功", "success");
      }
      setShowModal(false);
      if (subTab === "calibrations") fetchCalibrations(); else fetchMaintenances();
      onCalibrationChange?.();
    } catch (e) {
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("確定刪除？")) return;
    setDeleting(id);
    try {
      if (subTab === "calibrations") await api.delete(`/api/devices/${selectedDevice}/calibrations/${id}`);
      else await api.delete(`/api/devices/${selectedDevice}/maintenances/${id}`);
      showToast("已刪除", "success");
      if (subTab === "calibrations") fetchCalibrations(); else fetchMaintenances();
      onCalibrationChange?.();
    } catch (e) {
      showToast(e.response?.data?.detail || "刪除失敗", "error");
    } finally {
      setDeleting(null);
    }
  };

  const fmtDt = (v) => v ? v.replace("T", " ").slice(0, 16) : "—";
  const thS = { padding: "6px 10px", textAlign: "left", color: "#8b949e", fontWeight: 600, fontSize: 11, borderBottom: "1px solid #30363d" };
  const tdS = { padding: "6px 10px", fontSize: 11, color: "#cdd9e5", borderBottom: "1px solid #21262d" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "#0d1117", color: "#cdd9e5", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 6, padding: "10px 16px", flexShrink: 0, borderBottom: "1px solid #30363d" }}>
        {DEVICE_IDS.map(id => (
          <button key={id} onClick={() => setSelectedDevice(id)} style={{ padding: "4px 10px", fontSize: 12, borderRadius: 5, cursor: "pointer", background: selectedDevice === id ? "#1f6feb" : "#21262d", border: `1px solid ${selectedDevice === id ? "#1f6feb" : "#30363d"}`, color: selectedDevice === id ? "#fff" : "#8b949e", fontWeight: selectedDevice === id ? 700 : 400 }}>{id}</button>
        ))}
      </div>

      <div style={{ display: "flex", padding: "0 16px", borderBottom: "1px solid #30363d", flexShrink: 0, background: "#0d1117" }}>
        {[{ key: "calibrations", label: "校驗紀錄" }, { key: "maintenances", label: "維護紀錄" }].map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)} style={{ padding: "7px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: "transparent", border: "none", borderBottom: subTab === t.key ? "2px solid #58a6ff" : "2px solid transparent", color: subTab === t.key ? "#cdd9e5" : "#8b949e" }}>{t.label}</button>
        ))}
        {role === "admin" && (
          <button onClick={openCreate} style={{ marginLeft: "auto", padding: "4px 12px", fontSize: 11, borderRadius: 5, cursor: "pointer", background: "#1f6feb22", border: "1px solid #1f6feb", color: "#58a6ff" }}>+ 新增</button>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {subTab === "calibrations" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>{["校驗日期", "下次校驗日期", "間隔(天)", "證書號", "結果", "備註", ...(role === "admin" ? ["操作"] : [])].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {calibrations.length === 0 ? (
                <tr><td colSpan={7} style={{ ...tdS, color: "#484f58", textAlign: "center", padding: "20px 0" }}>尚無校驗紀錄</td></tr>
              ) : calibrations.map(c => (
                <tr key={c.id}>
                  <td style={tdS}>{fmtDt(c.calibration_date)}</td>
                  <td style={tdS}>{fmtDt(c.next_calibration_date)}</td>
                  <td style={tdS}>{c.interval_days}</td>
                  <td style={tdS}>{c.certificate_number || "—"}</td>
                  <td style={tdS}>
                    <span style={{ fontSize: 10, padding: "2px 6px", borderRadius: 8, fontWeight: 700, background: c.result === "pass" ? "#0f2318" : "#2d0f0f", color: c.result === "pass" ? "#3fb950" : "#f85149", border: `1px solid ${c.result === "pass" ? "#2d5a3a" : "#5a2d2d"}` }}>{c.result === "pass" ? "通過" : "不通過"}</span>
                  </td>
                  <td style={{ ...tdS, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.notes || "—"}</td>
                  {role === "admin" && (
                    <td style={tdS}>
                      <button onClick={() => openEdit(c)} style={{ marginRight: 6, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#21262d", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer" }}>編輯</button>
                      <button onClick={() => handleDelete(c.id)} disabled={deleting === c.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#2d0f0f", border: "1px solid #5a2d2d", color: "#f85149", cursor: "pointer" }}>刪除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
            <thead>
              <tr>{["維護日期", "類型", "說明", "執行人員", "下次維護日期", ...(role === "admin" ? ["操作"] : [])].map(h => <th key={h} style={thS}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {maintenances.length === 0 ? (
                <tr><td colSpan={6} style={{ ...tdS, color: "#484f58", textAlign: "center", padding: "20px 0" }}>尚無維護紀錄</td></tr>
              ) : maintenances.map(m => (
                <tr key={m.id}>
                  <td style={tdS}>{fmtDt(m.maintenance_date)}</td>
                  <td style={tdS}>{MAINTENANCE_TYPE_LABEL[m.maintenance_type] || m.maintenance_type}</td>
                  <td style={{ ...tdS, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.description}</td>
                  <td style={tdS}>{m.performed_by}</td>
                  <td style={tdS}>{m.next_maintenance_date ? fmtDt(m.next_maintenance_date) : "—"}</td>
                  {role === "admin" && (
                    <td style={tdS}>
                      <button onClick={() => openEdit(m)} style={{ marginRight: 6, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#21262d", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer" }}>編輯</button>
                      <button onClick={() => handleDelete(m.id)} disabled={deleting === m.id} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "#2d0f0f", border: "1px solid #5a2d2d", color: "#f85149", cursor: "pointer" }}>刪除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div onClick={() => setShowModal(false)} style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(0,0,0,0.6)" }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(480px, 92vw)", background: "#161b22", border: "1px solid #30363d", borderRadius: 10, padding: 24, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#cdd9e5" }}>
              {editItem ? "編輯" : "新增"}{subTab === "calibrations" ? "校驗紀錄" : "維護紀錄"} — {selectedDevice}
            </div>
            {subTab === "calibrations" ? (
              <>
                <FieldRow label="校驗日期 *" value={form.calibration_date} onChange={v => setForm(f => ({ ...f, calibration_date: v }))} placeholder="YYYY-MM-DD HH:MM" />
                <FieldRow label="下次校驗日期 *" value={form.next_calibration_date} onChange={v => setForm(f => ({ ...f, next_calibration_date: v }))} placeholder="YYYY-MM-DD HH:MM" />
                <FieldRow label="間隔(天)" value={form.interval_days} onChange={v => setForm(f => ({ ...f, interval_days: v }))} placeholder="365" />
                <FieldRow label="證書號" value={form.certificate_number} onChange={v => setForm(f => ({ ...f, certificate_number: v }))} placeholder="CAL-2026-001" />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: "#8b949e" }}>結果</label>
                  <select value={form.result} onChange={e => setForm(f => ({ ...f, result: e.target.value }))} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, color: "#cdd9e5", padding: "5px 8px", fontSize: 12 }}>
                    <option value="pass">通過</option>
                    <option value="fail">不通過</option>
                  </select>
                </div>
                <FieldRow label="備註" value={form.notes} onChange={v => setForm(f => ({ ...f, notes: v }))} placeholder="選填" />
                <FieldRow label="建立人 *" value={form.created_by} onChange={v => setForm(f => ({ ...f, created_by: v }))} placeholder="admin" />
              </>
            ) : (
              <>
                <FieldRow label="維護日期 *" value={form.maintenance_date} onChange={v => setForm(f => ({ ...f, maintenance_date: v }))} placeholder="YYYY-MM-DD HH:MM" />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 11, color: "#8b949e" }}>類型</label>
                  <select value={form.maintenance_type} onChange={e => setForm(f => ({ ...f, maintenance_type: e.target.value }))} style={{ background: "#0d1117", border: "1px solid #30363d", borderRadius: 5, color: "#cdd9e5", padding: "5px 8px", fontSize: 12 }}>
                    <option value="preventive">預防性</option>
                    <option value="corrective">矯正性</option>
                    <option value="inspection">例行點檢</option>
                  </select>
                </div>
                <FieldRow label="說明 *" value={form.description} onChange={v => setForm(f => ({ ...f, description: v }))} placeholder="維護內容說明" />
                <FieldRow label="執行人員 *" value={form.performed_by} onChange={v => setForm(f => ({ ...f, performed_by: v }))} placeholder="王工程師" />
                <FieldRow label="下次維護日期" value={form.next_maintenance_date} onChange={v => setForm(f => ({ ...f, next_maintenance_date: v }))} placeholder="YYYY-MM-DD HH:MM（選填）" />
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setShowModal(false)} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 5, background: "transparent", border: "1px solid #30363d", color: "#8b949e", cursor: "pointer" }}>取消</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: "5px 14px", fontSize: 12, borderRadius: 5, background: saving ? "#21262d" : "#1f6feb", border: "none", color: "#fff", cursor: saving ? "not-allowed" : "pointer", fontWeight: 600 }}>
                {saving ? "儲存中..." : "儲存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
