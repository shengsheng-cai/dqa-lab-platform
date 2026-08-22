import { useState } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import ModalShell from "./ModalShell";

function getStatus(f) {
  if (f.available_quantity === 0 && f.total_quantity === 0)
    return "out_of_stock";
  if (f.shortage > 0) return "shortage";
  if (f.loaned_quantity > 0) return "loaned";
  if (f.reserved_quantity > 0) return "reserved";
  return "ok";
}

export default function StocktakeModal({ fixtures, onClose, onComplete }) {
  const { showToast } = useToast();
  const [actuals, setActuals] = useState({});
  const [loading, setLoading] = useState(false);

  // 有東西借出或預約在外時，現場數不到那幾件，所以整個品項不進盤點。
  // 但不能靜默丟掉——使用者會以為清單就是全部，盤完得到「差異 0」而誤判庫存都對。
  const isCountable = (f) => {
    const s = getStatus(f);
    return s === "ok" || s === "shortage" || s === "out_of_stock";
  };
  const active = fixtures.filter(isCountable);
  const excluded = fixtures.filter((f) => !isCountable(f));

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const results = active.map((f) => ({
        fixture: f,
        actual: parseInt(actuals[f.id] !== undefined ? actuals[f.id] : f.total_quantity),
      }));
      const diffs = results.filter((r) => r.actual !== r.fixture.total_quantity);
      await Promise.all(
        results.map(({ fixture, actual }) =>
          api.post(`/api/fixtures/${fixture.id}/inventory?actual_quantity=${actual}`)
        )
      );
      showToast(`盤點完成：正常 ${active.length - diffs.length} 、差異 ${diffs.length}`, "success");
      onComplete();
    } catch (e) {
      showToast(e.response?.data?.detail || "盤點失敗", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ModalShell width={600} maxHeight="80vh" onClose={onClose}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>月盤點</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 4 }}>
            對照系統庫存，輸入實際清點數量。數量不符的項目會標示差異。
          </div>
        </div>

        {active.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 60px", gap: "4px 8px", alignItems: "center", padding: "0 10px 8px", borderBottom: "1px solid #30363d", marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: "#8b949e" }}>治具</div>
            <div style={{ fontSize: 11, color: "#8b949e", textAlign: "center" }}>系統庫存</div>
            <div style={{ fontSize: 11, color: "#8b949e", textAlign: "center" }}>實際清點</div>
            <div style={{ fontSize: 11, color: "#8b949e", textAlign: "center" }}>差異</div>
          </div>
        )}

        {active.length === 0 && (
          <div style={{
            padding: "18px 10px", textAlign: "center",
            fontSize: 13, color: "#8b949e",
            border: "1px dashed #30363d", borderRadius: 6,
          }}>
            沒有可盤點的項目：{excluded.length} 種治具目前有借出或預約在外，現場數不到完整數量。
            <div style={{ fontSize: 12, marginTop: 6, color: "#6e7681" }}>
              等治具歸還後再盤，或先處理下方列出的項目。
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {active.map((f) => {
            const actual = actuals[f.id];
            const actualNum = actual !== undefined ? parseInt(actual) : f.total_quantity;
            const isDiff = actual !== undefined && actualNum !== f.total_quantity;
            const diff = actualNum - f.total_quantity;
            return (
              <div
                key={f.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 90px 90px 60px",
                  gap: "4px 8px",
                  alignItems: "center",
                  padding: "8px 10px",
                  background: isDiff ? "#3d1f1a" : "#0d1117",
                  borderRadius: 6,
                  border: `1px solid ${isDiff ? "#da3633" : "#30363d"}`,
                }}
              >
                <div style={{ fontSize: 12, color: "#cdd9e5" }}>
                  {f.interface_type} / {f.form_factor}
                </div>
                <div style={{ fontSize: 13, color: "#8b949e", textAlign: "center" }}>
                  {f.total_quantity}
                </div>
                <input
                  type="number"
                  min="0"
                  value={actual !== undefined ? actual : f.total_quantity}
                  onChange={(e) => setActuals((p) => ({ ...p, [f.id]: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "5px 8px",
                    borderRadius: 4,
                    border: `1px solid ${isDiff ? "#f85149" : "#30363d"}`,
                    background: "#0d1117",
                    color: isDiff ? "#f85149" : "#cdd9e5",
                    fontSize: 13,
                    textAlign: "center",
                    boxSizing: "border-box",
                  }}
                />
                <div style={{ fontSize: 12, fontWeight: 600, textAlign: "center", color: isDiff ? (diff > 0 ? "#3fb950" : "#f85149") : "#444d56" }}>
                  {isDiff ? (diff > 0 ? `▲ +${diff}` : `▼ ${diff}`) : "—"}
                </div>
              </div>
            );
          })}
        </div>

        {excluded.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 6 }}>
              未納入本次盤點（{excluded.length} 種）：有借出或預約在外，數量無法在現場核對
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {excluded.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: 6,
                    background: "#0d1117", border: "1px dashed #30363d",
                    fontSize: 12, color: "#6e7681",
                  }}
                >
                  <span>{f.interface_type} / {f.form_factor}</span>
                  <span>
                    系統庫存 {f.total_quantity}
                    {f.loaned_quantity > 0 && `・借出 ${f.loaned_quantity}`}
                    {f.reserved_quantity > 0 && `・預約 ${f.reserved_quantity}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 20, alignItems: "center", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 12, color: "#8b949e", marginRight: "auto" }}>
            本次盤點涵蓋 {active.length} 種，未納入 {excluded.length} 種
          </span>
          <button
            onClick={onClose}
            style={{
              padding: "8px 16px",
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
            disabled={loading || active.length === 0}
            style={{
              padding: "8px 16px",
              borderRadius: 6,
              border: "none",
              background: active.length === 0 ? "#21262d" : "#238636",
              color: active.length === 0 ? "#484f58" : "#fff",
              cursor: loading || active.length === 0 ? "not-allowed" : "pointer",
              fontSize: 13,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "提交中..." : "完成盤點"}
          </button>
        </div>
    </ModalShell>
  );
}
