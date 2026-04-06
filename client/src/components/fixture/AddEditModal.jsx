import { useState } from "react";
import api from "../../api";
import { useToast } from "../Toast";

export default function AddEditModal({ fixture, onClose, onSuccess }) {
  const { showToast } = useToast();
  const isEdit = !!fixture;
  const [showAdvanced, setShowAdvanced] = useState(isEdit);
  const [form, setForm] = useState({
    interface_type: fixture?.interface_type || "",
    form_factor: fixture?.form_factor || "",
    priority: fixture?.priority ?? "",
    size: fixture?.size || "",
    purpose: fixture?.purpose || "",
    total_quantity: fixture?.total_quantity ?? 0,
    shortage: fixture?.shortage ?? 0,
    usage_frequency: fixture?.usage_frequency ?? "",
    replacement_years: fixture?.replacement_years || "",
    note: fixture?.note || "",
    keeper_name: fixture?.keeper_name || "",
    deputy_name: fixture?.deputy_name || "",
    vendor: fixture?.vendor || "",
    model_number: fixture?.model_number || "",
    unit_price: fixture?.unit_price ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async () => {
    if (!form.interface_type || !form.form_factor) {
      setError("介面和型態為必填");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const body = {
        ...form,
        priority: form.priority === "" ? null : Number(form.priority),
        total_quantity: Number(form.total_quantity) || 0,
        shortage: Number(form.shortage) || 0,
        usage_frequency: form.usage_frequency === "" ? null : Number(form.usage_frequency),
        unit_price: form.unit_price === "" ? null : Number(form.unit_price),
        size: form.size || null,
        purpose: form.purpose || null,
        replacement_years: form.replacement_years || null,
        note: form.note || null,
        keeper_name: form.keeper_name || null,
        deputy_name: form.deputy_name || null,
        vendor: form.vendor || null,
        model_number: form.model_number || null,
      };
      if (isEdit) {
        await api.patch(`/api/fixtures/${fixture.id}`, body);
        showToast("治具已更新", "success");
      } else {
        await api.post("/api/fixtures/", body);
        showToast("治具已新增", "success");
      }
      onSuccess();
      onClose();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
      showToast(e.response?.data?.detail || "操作失敗", "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    padding: "7px 10px", borderRadius: 6, border: "1px solid #30363d",
    background: "#0d1117", color: "#cdd9e5", fontSize: 13,
    width: "100%", boxSizing: "border-box",
  };
  const label = (txt) => (
    <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 3 }}>{txt}</div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000 }}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 24, width: 520, maxHeight: "85vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          {isEdit ? "編輯治具" : "新增治具"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div>
            {label("介面 *")}
            <input value={form.interface_type} onChange={(e) => set("interface_type", e.target.value)} style={inputStyle} placeholder="e.g. USB-C" />
          </div>
          <div>
            {label("型態 *")}
            <input value={form.form_factor} onChange={(e) => set("form_factor", e.target.value)} style={inputStyle} placeholder="e.g. 轉接頭" />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            {label("現有數量")}
            <input type="number" min={0} value={form.total_quantity} onChange={(e) => set("total_quantity", e.target.value)} style={{ ...inputStyle, width: "calc(50% - 5px)", boxSizing: "border-box" }} />
          </div>
        </div>
        <button
          onClick={() => setShowAdvanced((v) => !v)}
          style={{ background: "transparent", border: "none", color: "#58a6ff", cursor: "pointer", fontSize: 12, padding: "2px 0", textAlign: "left", display: "flex", alignItems: "center", gap: 4 }}
        >
          {showAdvanced ? "▲ 隱藏進階選項" : "▼ 進階選項"}
        </button>
        {showAdvanced && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                {label("優先度")}
                <input type="number" value={form.priority} onChange={(e) => set("priority", e.target.value)} style={inputStyle} placeholder="數字越小越前" />
              </div>
              <div>
                {label("尺寸")}
                <input value={form.size} onChange={(e) => set("size", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("缺貨數")}
                <input type="number" min={0} value={form.shortage} onChange={(e) => set("shortage", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("使用頻率")}
                <select value={form.usage_frequency} onChange={(e) => set("usage_frequency", e.target.value)} style={inputStyle}>
                  <option value="">—</option>
                  <option value="1">每天</option>
                  <option value="2">週</option>
                  <option value="3">月</option>
                  <option value="4">季</option>
                  <option value="5">年</option>
                </select>
              </div>
              <div>
                {label("汰換年限")}
                <input value={form.replacement_years} onChange={(e) => set("replacement_years", e.target.value)} style={inputStyle} placeholder="e.g. 3年" />
              </div>
              <div>
                {label("單價")}
                <input type="number" min={0} value={form.unit_price} onChange={(e) => set("unit_price", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("保管人")}
                <input value={form.keeper_name} onChange={(e) => set("keeper_name", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("代理人")}
                <input value={form.deputy_name} onChange={(e) => set("deputy_name", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("廠商")}
                <input value={form.vendor} onChange={(e) => set("vendor", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("型號")}
                <input value={form.model_number} onChange={(e) => set("model_number", e.target.value)} style={inputStyle} />
              </div>
              <div>
                {label("用途")}
                <input value={form.purpose} onChange={(e) => set("purpose", e.target.value)} style={inputStyle} />
              </div>
            </div>
            <div>
              {label("備註")}
              <input value={form.note} onChange={(e) => set("note", e.target.value)} style={inputStyle} />
            </div>
          </>
        )}
        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: "8px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 13 }}>
            取消
          </button>
          <button onClick={handleSubmit} disabled={loading} style={{ flex: 1, padding: "8px", borderRadius: 6, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
            {loading ? "儲存中..." : isEdit ? "儲存" : "新增"}
          </button>
        </div>
      </div>
    </div>
  );
}
