import { useState, useEffect, useCallback } from "react";
import api from "./api";

const ROLE_LABELS = { admin: "管理者", keeper: "保管人", engineer: "工程師" };
const ROLE_COLORS = { admin: "#f85149", keeper: "#f0a500", engineer: "#58a6ff" };

function RoleBadge({ role }) {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 8px",
        borderRadius: 4,
        fontWeight: 600,
        background: ROLE_COLORS[role] + "22",
        color: ROLE_COLORS[role] || "#8b949e",
        border: `1px solid ${ROLE_COLORS[role] || "#30363d"}44`,
      }}
    >
      {ROLE_LABELS[role] || role}
    </span>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const isEdit = !!user;
  const [displayName, setDisplayName] = useState(user?.display_name || "");
  const [role, setRole] = useState(user?.role || "engineer");
  const [lineUserId, setLineUserId] = useState(user?.line_user_id || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      setError("請輸入姓名");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (isEdit) {
        await api.patch(`/api/auth/users/${user.id}`, {
          display_name: displayName.trim(),
          role,
          line_user_id: lineUserId.trim() || null,
        });
      } else {
        await api.post("/api/auth/users", {
          display_name: displayName.trim(),
          role,
          line_user_id: lineUserId.trim() || null,
        });
      }
      onSaved();
    } catch (e) {
      setError(e.response?.data?.detail || "操作失敗");
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
          width: 380,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          {isEdit ? "編輯人員" : "新增人員"}
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            姓名 *
          </div>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="例：王小明"
            style={inputStyle}
            autoFocus
          />
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            角色
          </div>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            style={inputStyle}
          >
            <option value="engineer">工程師</option>
          </select>
        </div>

        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            LINE User ID（選填，用於推播通知）
          </div>
          <input
            value={lineUserId}
            onChange={(e) => setLineUserId(e.target.value)}
            placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            style={inputStyle}
          />
        </div>

        {error && (
          <div style={{ color: "#f85149", fontSize: 12 }}>{error}</div>
        )}

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
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "處理中..." : isEdit ? "儲存" : "新增"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ message, onConfirm, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2100,
      }}
    >
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 12,
          padding: 24,
          width: 320,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ fontSize: 14, color: "#cdd9e5" }}>{message}</div>
        <div style={{ display: "flex", gap: 8 }}>
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
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              background: "#da3633",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            確認刪除
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage({ active }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalUser, setModalUser] = useState(undefined); // undefined=隱藏, null=新增, obj=編輯
  const [deleteTarget, setDeleteTarget] = useState(null);

  const fetchUsers = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    try {
      const res = await api.get("/api/auth/users");
      setUsers(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [active]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleActive = async (user) => {
    try {
      await api.patch(`/api/auth/users/${user.id}`, {
        is_active: !user.is_active,
      });
      fetchUsers();
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.delete(`/api/auth/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchUsers();
    } catch (e) {
      alert(e.response?.data?.detail || "刪除失敗");
    }
  };

  const thStyle = {
    padding: "8px 12px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "10px 12px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  return (
    <div
      style={{
        padding: "20px 24px",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "#0d1117",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      {/* 標題列 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 20,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#cdd9e5" }}>
            人員管理
          </div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
            管理借用人名冊（工程師）與 LINE 推播 ID，保管人／管理者帳號請洽系統管理員
          </div>
        </div>
        <button
          onClick={() => setModalUser(null)}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            background: "#238636",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          + 新增人員
        </button>
      </div>

      {/* 人員表格 */}
      <div
        style={{
          background: "#161b22",
          border: "1px solid #30363d",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#21262d" }}>
              <th style={thStyle}>姓名</th>
              <th style={thStyle}>角色</th>
              <th style={thStyle}>LINE User ID</th>
              <th style={thStyle}>狀態</th>
              <th style={thStyle}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                >
                  載入中...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}
                >
                  尚無人員資料
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.id}
                  style={{
                    transition: "background .1s",
                    opacity: u.is_active ? 1 : 0.45,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#1c2128")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <td style={{ ...tdStyle, fontWeight: 600 }}>
                    {u.display_name}
                  </td>
                  <td style={tdStyle}>
                    <RoleBadge role={u.role} />
                  </td>
                  <td style={{ ...tdStyle, color: "#8b949e", fontSize: 11 }}>
                    {u.line_user_id ? (
                      <span style={{ color: "#3fb950" }}>{u.line_user_id}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 4,
                        background: u.is_active ? "#0d1f14" : "#21262d",
                        color: u.is_active ? "#3fb950" : "#8b949e",
                        border: `1px solid ${u.is_active ? "#238636" : "#30363d"}`,
                      }}
                    >
                      {u.is_active ? "啟用" : "停用"}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => setModalUser(u)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 4,
                          border: "1px solid #30363d",
                          background: "transparent",
                          color: "#8b949e",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        編輯
                      </button>
                      <button
                        onClick={() => handleToggleActive(u)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 4,
                          border: `1px solid ${u.is_active ? "#444" : "#238636"}`,
                          background: "transparent",
                          color: u.is_active ? "#8b949e" : "#3fb950",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        {u.is_active ? "停用" : "啟用"}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        style={{
                          padding: "3px 10px",
                          borderRadius: 4,
                          border: "1px solid #da363344",
                          background: "transparent",
                          color: "#f85149",
                          fontSize: 11,
                          cursor: "pointer",
                        }}
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 新增/編輯 Modal */}
      {modalUser !== undefined && (
        <UserModal
          user={modalUser}
          onClose={() => setModalUser(undefined)}
          onSaved={() => {
            setModalUser(undefined);
            fetchUsers();
          }}
        />
      )}

      {/* 刪除確認 Modal */}
      {deleteTarget && (
        <ConfirmModal
          message={`確定要刪除「${deleteTarget.display_name}」？此操作無法復原。`}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
