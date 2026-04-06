import { useState, useEffect } from "react";
import api from "../../api";
import { useToast } from "../Toast";

export default function SetKeeperModal({ fixture, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [keeperUserId, setKeeperUserId] = useState(
    fixture.keeper_user_id ? String(fixture.keeper_user_id) : ""
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api
      .get("/api/fixtures/users")
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      await api.patch(`/api/fixtures/${fixture.id}/keeper`, {
        keeper_user_id: keeperUserId ? parseInt(keeperUserId) : null,
      });
      showToast("保管人已設定", "success");
      onSubmit();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid #30363d",
    background: "#0d1117",
    color: "#cdd9e5",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box",
  };

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
          width: 360,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          設定保管人
        </div>
        <div style={{ fontSize: 13, color: "#8b949e" }}>
          {fixture.interface_type} — {fixture.form_factor}
          {fixture.keeper_name && (
            <span style={{ marginLeft: 8, color: "#58a6ff" }}>
              目前：{fixture.keeper_name}
            </span>
          )}
        </div>
        <select
          value={keeperUserId}
          onChange={(e) => setKeeperUserId(e.target.value)}
          style={inputStyle}
        >
          <option value="">— 無保管人 —</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name}（{u.role}）
            </option>
          ))}
        </select>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "transparent",
              color: "#8b949e",
              border: "1px solid #30363d",
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
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "#238636",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {loading ? "儲存中..." : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}
