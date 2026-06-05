import { useState, useEffect } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import { DEVICE_IDS } from "../../constants";
import DateTimePicker from "./DateTimePicker";
import {
  fmtDt, toLocalInput,
  overlayStyle, modalStyle, modalHeader, closeBtn,
  inputStyle, labelStyle, primaryBtn, cancelBtn,
} from "./scheduleUtils";

const EMPTY_FORM = { device_id: DEVICE_IDS[0], start_time: "", end_time: "", reason: "" };

export default function ManageBlockedPeriodsModal({ onClose, onChanged }) {
  const { showToast } = useToast();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState(null);

  async function fetchList() {
    setLoading(true);
    try {
      const res = await api.get("/api/device-blocked-periods");
      setList(res.data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchList(); }, []);

  function openNew() {
    setEditingId(null);
    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setForm({
      device_id: DEVICE_IDS[0],
      start_time: fmt(now),
      end_time: fmt(new Date(now.getTime() + 8 * 3600000)),
      reason: "",
    });
    setError("");
    setShowForm(true);
  }

  function openEdit(item) {
    setEditingId(item.id);
    setForm({
      device_id: item.device_id,
      start_time: toLocalInput(item.start_time),
      end_time: toLocalInput(item.end_time),
      reason: item.reason || "",
    });
    setError("");
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingId(null);
    setError("");
  }

  async function submit() {
    if (!form.start_time || !form.end_time) return setError("請填入開始與結束時間");
    if (new Date(form.end_time) <= new Date(form.start_time)) return setError("結束時間必須晚於開始時間");
    setSaving(true);
    setError("");
    try {
      const payload = {
        device_id: form.device_id,
        start_time: new Date(form.start_time).toISOString(),
        end_time: new Date(form.end_time).toISOString(),
        reason: form.reason.trim() || null,
      };
      if (editingId !== null) {
        await api.patch(`/api/device-blocked-periods/${editingId}`, payload);
        showToast("已更新", "success");
      } else {
        await api.post("/api/device-blocked-periods", payload);
        showToast("已新增", "success");
      }
      setShowForm(false);
      setEditingId(null);
      await fetchList();
      onChanged();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      setError(msg);
      showToast(msg, "error", 4000, e.response?.data?.hint);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setDeletingId(id);
    try {
      await api.delete(`/api/device-blocked-periods/${id}`);
      showToast("已刪除", "success");
      await fetchList();
      onChanged();
    } catch (e) {
      showToast(e.response?.data?.detail || "刪除失敗", "error", 4000, e.response?.data?.hint);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={{ ...modalStyle, width: 560, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ ...modalHeader, borderRadius: "10px 10px 0 0" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>管理設備不可用時段</span>
          <button onClick={onClose} style={closeBtn}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "12px 20px" }}>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <button onClick={openNew} style={primaryBtn}>+ 新增</button>
          </div>

          {loading ? (
            <div style={{ color: "#8b949e", fontSize: 13, textAlign: "center", padding: 20 }}>載入中...</div>
          ) : list.length === 0 ? (
            <div style={{ color: "#484f58", fontSize: 13, textAlign: "center", padding: 20 }}>目前無不可用時段</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ color: "#8b949e", borderBottom: "1px solid #30363d" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500 }}>設備</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500 }}>開始</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500 }}>結束</th>
                  <th style={{ padding: "4px 8px", textAlign: "left", fontWeight: 500 }}>原因</th>
                  <th style={{ padding: "4px 8px", width: 72 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((item) => (
                  <tr key={item.id} style={{ borderBottom: "1px solid #21262d", color: "#cdd9e5" }}>
                    <td style={{ padding: "6px 8px", fontWeight: 600 }}>{item.device_id}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmtDt(item.start_time)}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{fmtDt(item.end_time)}</td>
                    <td style={{ padding: "6px 8px", color: "#8b949e" }}>{item.reason || "—"}</td>
                    <td style={{ padding: "6px 8px", display: "flex", gap: 6 }}>
                      <button onClick={() => openEdit(item)}
                        style={{ ...cancelBtn, padding: "2px 8px", fontSize: 12 }}>編輯</button>
                      <button onClick={() => handleDelete(item.id)}
                        disabled={deletingId === item.id}
                        style={{ ...cancelBtn, padding: "2px 8px", fontSize: 12, color: "#f85149", borderColor: "#f85149" }}>
                        {deletingId === item.id ? "..." : "刪除"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {showForm && (
          <div style={{ borderTop: "1px solid #30363d", padding: "14px 20px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#cdd9e5", marginBottom: 2 }}>
              {editingId !== null ? "編輯時段" : "新增時段"}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: "0 0 100px" }}>
                <div style={labelStyle}>設備</div>
                <select value={form.device_id} onChange={(e) => setForm((f) => ({ ...f, device_id: e.target.value }))}
                  style={inputStyle}>
                  {DEVICE_IDS.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>原因</div>
                <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  placeholder="e.g. 年度校正" style={inputStyle} />
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>開始時間</div>
                <DateTimePicker
                  value={form.start_time}
                  onChange={(v) => setForm((f) => ({ ...f, start_time: v }))}
                  style={inputStyle}
                />
              </div>
              <div style={{ flex: 1 }}>
                <div style={labelStyle}>結束時間</div>
                <DateTimePicker
                  value={form.end_time}
                  onChange={(v) => setForm((f) => ({ ...f, end_time: v }))}
                  style={inputStyle}
                />
              </div>
            </div>
            {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={cancelForm} style={cancelBtn}>取消</button>
              <button onClick={submit} disabled={saving} style={primaryBtn}>
                {saving ? "儲存中..." : editingId !== null ? "儲存變更" : "新增"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
