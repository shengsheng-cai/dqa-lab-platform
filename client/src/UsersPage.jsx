import { useState, useEffect, useCallback } from "react";
import api from "./api";
import { useToast } from "./components/Toast";
import { parseUtcDate } from "./constants";

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
  const { showToast } = useToast();
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
        showToast("員工資料已更新", "success");
      } else {
        await api.post("/api/auth/users", {
          display_name: displayName.trim(),
          role,
          line_user_id: lineUserId.trim() || null,
        });
        showToast("員工已新增", "success");
      }
      onSaved();
    } catch (e) {
      const msg = e.response?.data?.detail || "操作失敗";
      setError(msg);
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
            <option value="keeper">保管人</option>
            <option value="admin">管理者</option>
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

// ── LINE 綁定申請管理 ───────────────────────────────────────────

function ApproveBindingModal({ request, users, onConfirm, onClose }) {
  const { showToast } = useToast();
  const [selectedUserId, setSelectedUserId] = useState("");
  const [approving, setApproving] = useState(false);

  const handleConfirm = async () => {
    if (!selectedUserId) return;
    setApproving(true);
    try {
      await api.post(`/api/line/bind-requests/${request.id}/approve`, {
        user_id: parseInt(selectedUserId)
      });
      showToast("LINE 綁定已核准", "success");
      onConfirm();
    } catch (e) {
      const msg = e.response?.data?.detail || "核准失敗";
      showToast(msg, "error");
    } finally {
      setApproving(false);
    }
  };

  const selectStyle = {
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
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2100 }}>
      <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 24, width: 380, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#cdd9e5" }}>
          核准綁定申請
        </div>
        <div style={{ fontSize: 12, color: "#8b949e" }}>
          申請人：<span style={{ color: "#cdd9e5" }}>{request.requested_name}</span>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#8b949e", marginBottom: 4 }}>
            綁定員工 *
          </div>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={selectStyle}
            autoFocus
          >
            <option value="">請選擇員工</option>
            {users.map(u => (
              <option key={u.id} value={u.id}>
                {u.display_name} ({ROLE_LABELS[u.role] || u.role})
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "8px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 13 }}
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedUserId || approving}
            style={{ flex: 1, padding: "8px", borderRadius: 6, background: "#238636", color: "#fff", border: "none", cursor: selectedUserId && !approving ? "pointer" : "not-allowed", fontSize: 13, fontWeight: 600, opacity: (!selectedUserId || approving) ? 0.6 : 1 }}
          >
            {approving ? "核准中..." : "確認"}
          </button>
        </div>
      </div>
    </div>
  );
}

function LineBindRequestsSection({ active, role }) {
  const { showToast } = useToast();
  const [requests, setRequests] = useState([]);
  const [users, setUsers] = useState([]);
  const [processing, setProcessing] = useState(null);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const fetchRequests = useCallback(async () => {
    if (!active || role !== "admin") return;
    try {
      const res = await api.get("/api/line/bind-requests");
      setRequests(res.data);
    } catch (_) {}
  }, [active, role]);

  const fetchUsers = useCallback(async () => {
    if (!active || role !== "admin") return;
    try {
      const res = await api.get("/api/auth/users");
      setUsers(res.data);
    } catch (_) {}
  }, [active, role]);

  useEffect(() => {
    fetchRequests();
    fetchUsers();
  }, [fetchRequests, fetchUsers]);

  const handleApprove = (request) => {
    setSelectedRequest(request);
  };

  const handleApproveConfirm = () => {
    setSelectedRequest(null);
    fetchRequests();
    fetchUsers();  // 刷新員工列表，顯示最新的 LINE ID
  };

  const handleReject = async (id) => {
    if (!window.confirm("確定拒絕此申請？")) return;
    setProcessing(id);
    try {
      await api.post(`/api/line/bind-requests/${id}/reject`);
      showToast("申請已拒絕", "success");
      fetchRequests();
    } catch (e) {
      const msg = e.response?.data?.detail || "拒絕失敗";
      showToast(msg, "error");
    } finally {
      setProcessing(null);
    }
  };

  if (role !== "admin") return null;

  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>LINE 綁定申請</div>
        {requests.length > 0 && (
          <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "#f0a50022", color: "#f0a500", fontWeight: 700, border: "1px solid #f0a50044" }}>
            {requests.length} 待審核
          </span>
        )}
      </div>

      {requests.length === 0 ? (
        <div style={{ color: "#484f58", textAlign: "center", padding: "24px 0", fontSize: 13, background: "#161b22", border: "1px solid #30363d", borderRadius: 8 }}>
          目前無待審核的綁定申請
        </div>
      ) : (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#21262d" }}>
                {["申請姓名", "LINE User ID", "申請時間", "操作"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", fontSize: 11, color: "#8b949e", fontWeight: 600, textAlign: "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid #21262d" }}>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#cdd9e5", fontWeight: 600 }}>{r.requested_name}</td>
                  <td style={{ padding: "10px 12px", fontSize: 11, color: "#8b949e", fontFamily: "monospace" }}>{r.line_user_id}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: "#8b949e" }}>{r.created_at?.slice(0, 16).replace("T", " ")}</td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleApprove(r)}
                        disabled={processing === r.id}
                        style={{ padding: "3px 12px", borderRadius: 4, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, opacity: processing === r.id ? 0.6 : 1 }}
                      >
                        核准
                      </button>
                      <button
                        onClick={() => handleReject(r.id)}
                        disabled={processing === r.id}
                        style={{ padding: "3px 10px", borderRadius: 4, background: "transparent", color: "#f85149", border: "1px solid #da363344", cursor: "pointer", fontSize: 11, opacity: processing === r.id ? 0.6 : 1 }}
                      >
                        拒絕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selectedRequest && (
        <ApproveBindingModal
          request={selectedRequest}
          users={users}
          onConfirm={handleApproveConfirm}
          onClose={() => setSelectedRequest(null)}
        />
      )}
    </div>
  );
}

// ── LINE 推播失敗紀錄 ────────────────────────────────────────────

function NotifFailuresSection({ active, role }) {
  const { showToast } = useToast();
  const [failures, setFailures] = useState([]);
  const [clearing, setClearing] = useState(false);

  const fetchFailures = useCallback(() => {
    if (!active || role !== "admin") return;
    api.get("/api/notification-failures/").then((res) => setFailures(res.data)).catch(() => {});
  }, [active, role]);

  useEffect(() => { fetchFailures(); }, [fetchFailures]);

  const handleClear = async () => {
    setClearing(true);
    try {
      await api.post("/api/notification-failures/clear");
      setFailures([]);
      showToast("失敗記錄已清除", "success");
    } catch (e) {
      const msg = e.response?.data?.detail || "清除失敗";
      showToast(msg, "error");
    } finally {
      setClearing(false);
    }
  };

  if (role !== "admin") return null;

  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>LINE 推播失敗紀錄</div>
        {failures.length > 0 && (
          <span style={{ background: "#da3633", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 8, padding: "2px 7px" }}>
            {failures.length} 筆未讀
          </span>
        )}
        {failures.length > 0 && (
          <button
            onClick={handleClear}
            disabled={clearing}
            style={{ marginLeft: "auto", padding: "4px 14px", borderRadius: 6, border: "1px solid #30363d", background: "transparent", color: "#8b949e", fontSize: 12, cursor: "pointer" }}
          >
            {clearing ? "清除中…" : "全部標為已讀"}
          </button>
        )}
      </div>
      {failures.length === 0 ? (
        <div style={{ color: "#484f58", textAlign: "center", padding: "24px 0", fontSize: 13, background: "#161b22", border: "1px solid #30363d", borderRadius: 8 }}>
          目前沒有推播失敗紀錄
        </div>
      ) : (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#21262d" }}>
                {["時間", "目標", "訊息摘要", "錯誤原因"].map((h) => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left", color: "#8b949e", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id} style={{ borderTop: "1px solid #30363d" }}>
                  <td style={{ padding: "8px 12px", color: "#8b949e", whiteSpace: "nowrap" }}>
                    {f.created_at ? parseUtcDate(f.created_at).toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "-"}
                  </td>
                  <td style={{ padding: "8px 12px", color: "#cdd9e5" }}>{f.target || "-"}</td>
                  <td style={{ padding: "8px 12px", color: "#8b949e", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.message_preview || "-"}</td>
                  <td style={{ padding: "8px 12px", color: "#f85149", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.error_msg || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ── 訪客 Token 管理 ────────────────────────────────────────────

function DemoTokenSection({ active }) {
  const { showToast } = useToast();
  const [tokens, setTokens] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null); // 剛建立的 token（高亮顯示）

  const fetchTokens = useCallback(async () => {
    if (!active) return;
    try {
      const res = await api.get("/api/auth/demo-tokens");
      setTokens(res.data);
    } catch (_) {}
  }, [active]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await api.post("/api/auth/demo-tokens", {
        label: label.trim() || null,
        expires_days: expiresDays ? parseInt(expiresDays) : null,
        max_uses: maxUses ? parseInt(maxUses) : null,
      });
      setNewToken(res.data.token);
      setLabel(""); setExpiresDays(""); setMaxUses("");
      setShowForm(false);
      showToast("訪客 Token 已生成", "success");
      fetchTokens();
    } catch (e) {
      const msg = e.response?.data?.detail || "建立失敗";
      showToast(msg, "error");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id) => {
    try {
      await api.patch(`/api/auth/demo-tokens/${id}/toggle`);
      showToast("Token 狀態已更新", "success");
      fetchTokens();
    } catch (e) {
      const msg = e.response?.data?.detail || "更新失敗";
      showToast(msg, "error");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("確定刪除此 Token？")) return;
    try {
      await api.delete(`/api/auth/demo-tokens/${id}`);
      fetchTokens();
    } catch (_) {}
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    return iso.slice(0, 10);
  };

  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#cdd9e5" }}>訪客 Token 管理</div>
          <div style={{ fontSize: 12, color: "#8b949e", marginTop: 2 }}>
            管理者生成一次性訪客 Token，取代固定密碼。Token 可設定到期日與使用次數上限。
          </div>
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          style={{ padding: "8px 16px", borderRadius: 6, background: "#1f6feb", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
        >
          + 生成 Token
        </button>
      </div>

      {/* 建立表單 */}
      {showForm && (
        <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "16px 20px", marginBottom: 16, display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#8b949e" }}>用途標籤（選填）</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="例：廠商 Demo、主管審閱"
              style={inputS}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#8b949e" }}>有效天數（空白=永不到期）</label>
            <input
              value={expiresDays}
              onChange={(e) => setExpiresDays(e.target.value)}
              placeholder="例：7"
              type="number"
              min="1"
              style={{ ...inputS, width: 100 }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 11, color: "#8b949e" }}>最多使用次數（空白=無限）</label>
            <input
              value={maxUses}
              onChange={(e) => setMaxUses(e.target.value)}
              placeholder="例：1"
              type="number"
              min="1"
              style={{ ...inputS, width: 100 }}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={creating}
            style={{ padding: "8px 20px", borderRadius: 6, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, opacity: creating ? 0.6 : 1 }}
          >
            {creating ? "建立中…" : "建立"}
          </button>
          <button
            onClick={() => setShowForm(false)}
            style={{ padding: "8px 14px", borderRadius: 6, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 13 }}
          >
            取消
          </button>
        </div>
      )}

      {/* 剛建立的 token 提示 */}
      {newToken && (
        <div style={{ background: "#1f3a1f", border: "1px solid #238636", borderRadius: 8, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12, color: "#8b949e" }}>新 Token：</span>
          <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#3fb950", letterSpacing: 2 }}>{newToken}</span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>請立即複製，此提示關閉後不再顯示</span>
          <button
            onClick={() => { navigator.clipboard?.writeText(newToken); }}
            style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 4, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 12 }}
          >
            複製
          </button>
          <button
            onClick={() => setNewToken(null)}
            style={{ padding: "4px 10px", borderRadius: 4, background: "transparent", color: "#8b949e", border: "1px solid #30363d", cursor: "pointer", fontSize: 12 }}
          >
            關閉
          </button>
        </div>
      )}

      {/* Token 列表 */}
      {tokens.length === 0 ? (
        <div style={{ color: "#484f58", textAlign: "center", padding: "28px 0", fontSize: 13 }}>尚無訪客 Token，點擊「生成 Token」建立第一個</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid #30363d" }}>
              {["Token", "用途", "到期日", "使用次數", "狀態", "操作"].map((h) => (
                <th key={h} style={{ padding: "8px 12px", fontSize: 11, color: "#8b949e", fontWeight: 600, textAlign: "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const invalid = !t.is_active || t.expired || t.used_up;
              return (
                <tr key={t.id} style={{ borderBottom: "1px solid #21262d", opacity: invalid ? 0.5 : 1 }}>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontFamily: "monospace", fontSize: 14, fontWeight: 700, color: invalid ? "#8b949e" : "#58a6ff", letterSpacing: 1 }}>{t.token}</span>
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 13, color: "#cdd9e5" }}>{t.label || <span style={{ color: "#484f58" }}>—</span>}</td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: t.expired ? "#f85149" : "#8b949e" }}>
                    {t.expires_at ? fmtDate(t.expires_at) + (t.expired ? " (已過期)" : "") : "永不到期"}
                  </td>
                  <td style={{ padding: "10px 12px", fontSize: 12, color: t.used_up ? "#f85149" : "#8b949e" }}>
                    {t.use_count} / {t.max_uses ?? "∞"}{t.used_up ? " (已用盡)" : ""}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: invalid ? "#21262d" : "#1f3a1f", color: invalid ? "#8b949e" : "#3fb950", fontWeight: 600 }}>
                      {t.is_active && !t.expired && !t.used_up ? "有效" : "無效"}
                    </span>
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        onClick={() => handleToggle(t.id)}
                        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #30363d", background: "transparent", color: "#8b949e", fontSize: 11, cursor: "pointer" }}
                      >
                        {t.is_active ? "停用" : "啟用"}
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        style={{ padding: "3px 10px", borderRadius: 4, border: "1px solid #da363344", background: "transparent", color: "#f85149", fontSize: 11, cursor: "pointer" }}
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const inputS = {
  padding: "6px 10px",
  background: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 6,
  color: "#cdd9e5",
  fontSize: 13,
  outline: "none",
  width: 180,
};

export default function UsersPage({ active, role }) {
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
      showToast("激活狀態更新失敗", "error");
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
    } finally {
      setDeleteTarget(null);
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
                  <td style={tdStyle}>
                    {u.line_user_id ? (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#0d1f14", color: "#3fb950", border: "1px solid #23863644", fontWeight: 600 }}>
                        已綁定
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "#21262d", color: "#8b949e", border: "1px solid #30363d" }}>
                        未綁定
                      </span>
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

      {/* LINE 綁定申請 */}
      <LineBindRequestsSection active={active} role={role} />

      {/* LINE 推播失敗紀錄 */}
      <NotifFailuresSection active={active} role={role} />

      {/* 訪客 Token 管理 */}
      <DemoTokenSection active={active} />

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
