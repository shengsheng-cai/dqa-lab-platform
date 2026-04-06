import { useState } from "react";
import api from "../../api";
import { useToast } from "../Toast";

export default function CreatePurchaseModal({ fixtures, preFill, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [fixtureId, setFixtureId] = useState(preFill ? String(preFill.id) : "");
  const [quantity, setQuantity] = useState(preFill ? String(preFill.shortage || 1) : "1");
  const [vendor, setVendor] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!fixtureId) { setError("請選擇治具"); return; }
    const qty = parseInt(quantity);
    if (!qty || qty <= 0) { setError("數量需大於 0"); return; }
    setLoading(true);
    setError("");
    try {
      await api.post("/api/purchase-orders/", {
        fixture_id: parseInt(fixtureId),
        quantity: qty,
        vendor: vendor || null,
        unit_price: unitPrice ? parseFloat(unitPrice) : null,
        note: note || null,
      });
      showToast("採購單已新增", "success");
      onSubmit();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "新增失敗";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#cdd9e5",
    fontSize: 13,
    boxSizing: "border-box",
  };
  const labelStyle = { fontSize: 12, color: "#8b949e", marginBottom: 4 };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          width: 420,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          新增採購單
        </div>

        <div>
          <div style={labelStyle}>治具 *</div>
          <select
            value={fixtureId}
            onChange={(e) => setFixtureId(e.target.value)}
            style={inputStyle}
          >
            <option value="">請選擇治具</option>
            {fixtures.map((f) => (
              <option key={f.id} value={String(f.id)}>
                {f.interface_type} / {f.form_factor}
                {f.size ? ` (${f.size})` : ""}
                {" — "}可借 {f.available_quantity}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div style={labelStyle}>採購數量 *</div>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>廠商（選填）</div>
          <input
            type="text"
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="廠商名稱"
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>單價（選填）</div>
          <input
            type="number"
            min={0}
            step="0.01"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>

        <div>
          <div style={labelStyle}>備註（選填）</div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例：急需、替換損壞品..."
            style={inputStyle}
          />
        </div>

        {error && <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onClose}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "1px solid #30363d",
              background: "transparent",
              color: "#8b949e",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            style={{
              padding: "7px 18px",
              borderRadius: 6,
              border: "none",
              background: "#238636",
              color: "#fff",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "送出中..." : "建立採購單"}
          </button>
        </div>
      </div>
    </div>
  );
}
