import { useState, useEffect } from "react";
import api from "../../api";
import { useToast } from "../useToast";
import ConfirmModal from "../ConfirmModal";
import ModalShell from "./ModalShell";
import { inputStyle } from "./modalStyles";
import { isUnlinkedKeeper } from "../../utils/keeper";

export default function SetKeeperModal({ fixture, onClose, onSubmit }) {
  const { showToast } = useToast();
  const [users, setUsers] = useState([]);
  const [keeperUserId, setKeeperUserId] = useState(
    fixture.keeper_user_id ? String(fixture.keeper_user_id) : ""
  );
  const [loading, setLoading] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const unlinked = isUnlinkedKeeper(fixture);

  useEffect(() => {
    api
      .get("/api/auth/users?active_only=true")
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]));
  }, []);

  const save = async () => {
    setLoading(true);
    try {
      await api.patch(`/api/fixtures/${fixture.id}/keeper`, {
        keeper_user_id: keeperUserId ? parseInt(keeperUserId) : null,
      });
      showToast(keeperUserId ? "保管人已設定" : "保管人已清除", "success");
      onSubmit();
      onClose();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      showToast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  // 選單留在「無保管人」而畫面上明明寫著一個名字，按下去會把那個名字清掉。
  // 舊資料的文字保管人就是這樣被無聲刪掉的，所以這一步要先問過。
  const willClearKeeper = !keeperUserId && !!fixture.keeper_name;

  const handleSubmit = () => {
    if (willClearKeeper) {
      setConfirmClear(true);
      return;
    }
    save();
  };

  return (
    <>
    <ModalShell width={360} gap={12} onClose={onClose}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          設定保管人
        </div>
        <div style={{ fontSize: 13, color: "#8b949e" }}>
          {fixture.interface_type} — {fixture.form_factor}
          {fixture.keeper_name && (
            <span style={{ marginLeft: 8, color: unlinked ? "#f0a500" : "#58a6ff" }}>
              目前：{fixture.keeper_name}
            </span>
          )}
        </div>
        {unlinked && (
          <div style={{ fontSize: 12, color: "#f0a500", background: "#2d2200", border: "1px solid #f0a50044", borderRadius: 6, padding: "8px 10px", lineHeight: 1.6 }}>
            「{fixture.keeper_name}」是舊資料留下的文字，還沒連到系統裡的人員。
            從下面挑一個人就會連起來；維持「無保管人」並確認，則會把這段文字清掉。
          </div>
        )}
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
    </ModalShell>
    {confirmClear && (
      <ConfirmModal
        title="清除保管人"
        type="warning"
        confirmText="清除"
        message={
          `${fixture.interface_type} — ${fixture.form_factor}\n\n`
          + `目前的保管人「${fixture.keeper_name}」會被清除，之後這個治具沒有保管人。`
        }
        onConfirm={() => { setConfirmClear(false); save(); }}
        onCancel={() => setConfirmClear(false)}
      />
    )}
    </>
  );
}
