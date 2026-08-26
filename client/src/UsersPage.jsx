import { useState, useEffect, useCallback, useRef } from "react";
import api from "./api";
import { useToast } from "./components/useToast";
import ConfirmModal from "./components/ConfirmModal";
import { C } from "./styles/theme";

const ROLE_LABELS = { admin: "管理者" };
const ROLE_COLORS = { admin: "#f85149" };
const ADMIN_ONLY_ERROR = "此頁僅限管理者";

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
  const [role, setRole] = useState(user?.role || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!displayName.trim()) {
      setError("請輸入姓名");
      return;
    }
    if (!role.trim()) {
      setError("請輸入角色");
      return;
    }
    setLoading(true);
    setError("");
    try {
      if (isEdit) {
        await api.patch(`/api/auth/users/${user.id}`, {
          display_name: displayName.trim(),
          role,
        });
        showToast("員工資料已更新", "success");
      } else {
        await api.post("/api/auth/users", {
          display_name: displayName.trim(),
          role,
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
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="例：管理者、工程師、保管人"
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

// ── 訪客 Token 管理 ────────────────────────────────────────────

function DemoTokenSection({ active }) {
  const { showToast } = useToast();
  const [tokens, setTokens] = useState([]);
  const [hideInactive, setHideInactive] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState("");
  const [expiresDays, setExpiresDays] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState(null); // 剛建立的 token（高亮顯示）
  const [deleteToken, setDeleteToken] = useState(null);
  const [deletingToken, setDeletingToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const tokenRef = useRef(null);

  const fetchTokens = useCallback(async () => {
    if (!active) return;
    try {
      const res = await api.get("/api/auth/demo-tokens");
      setTokens(res.data);
    } catch { /* ignore */ }
  }, [active]);

  useEffect(() => { fetchTokens(); }, [fetchTokens]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  // 複製失敗時把 Token 選起來讓人自己按 Ctrl/Cmd + C：
  // 這個提示一關就再也看不到完整 Token，不能只丟一句失敗就算了。
  // 沒有 clipboard API 的環境下，下面那行會直接丟例外，走的是同一條 fallback。
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(newToken);
      setCopied(true);
      showToast("Token 已複製", "success");
    } catch {
      const el = tokenRef.current;
      const sel = window.getSelection();
      const selected = Boolean(el && sel);
      if (selected) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      showToast(
        selected
          ? "複製失敗，Token 已選取，請直接按 Ctrl/Cmd + C"
          : "複製失敗，請手動選取上方 Token 再複製",
        "error",
      );
    }
  };

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

  // 撤銷失敗時故意不關視窗、也不重整列表：那把 Token 可能還有效，
  // 要讓管理者留在原地看到它還在，而不是回到一個看起來已經處理完的列表。
  const performDeleteToken = async () => {
    setDeletingToken(true);
    try {
      await api.delete(`/api/auth/demo-tokens/${deleteToken.id}`);
      showToast(`Token「${deleteToken.token}」已撤銷`, "success");
      setDeleteToken(null);
      fetchTokens();
    } catch (e) {
      showToast(e.response?.data?.detail || "撤銷失敗，此 Token 可能仍然有效", "error");
    } finally {
      setDeletingToken(false);
    }
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    return iso.slice(0, 10);
  };

  return (
    <div>

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
          <span ref={tokenRef} style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 700, color: "#3fb950", letterSpacing: 2 }}>{newToken}</span>
          <span style={{ fontSize: 11, color: "#8b949e" }}>請立即複製，此提示關閉後不再顯示</span>
          <button
            onClick={handleCopy}
            style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 4, background: copied ? "#1f6feb" : "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 12, minWidth: 72 }}
          >
            {copied ? "✓ 已複製" : "複製"}
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
      {(() => {
        const visible = hideInactive
          ? tokens.filter((t) => t.is_active && !t.expired && !t.used_up)
          : tokens;
        const hiddenCount = tokens.length - visible.length;
        return (
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#21262d", borderBottom: "1px solid #30363d" }}>
                  {["Token", "用途", "到期日", "次數"].map((h) => (
                    <th key={h} style={{ padding: "6px 10px", fontSize: 11, color: "#8b949e", fontWeight: 600, textAlign: "left" }}>{h}</th>
                  ))}
                  <th style={{ padding: "6px 10px", fontSize: 11, color: "#8b949e", fontWeight: 600, textAlign: "right" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "#8b949e", cursor: "pointer", marginRight: 8, fontWeight: 400 }}>
                      <input
                        type="checkbox"
                        checked={hideInactive}
                        onChange={(e) => setHideInactive(e.target.checked)}
                        style={{ cursor: "pointer" }}
                      />
                      隱藏已失效
                    </label>
                    <button
                      onClick={() => setShowForm((v) => !v)}
                      style={{ padding: "2px 10px", borderRadius: 5, background: "#1f6feb", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      + 生成
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: "28px 0", textAlign: "center", color: "#484f58", fontSize: 13 }}>
                    {tokens.length === 0 ? "尚無訪客 Token，點擊「+ 生成」建立第一個" : `所有 Token 已失效（共 ${tokens.length} 筆）`}
                  </td></tr>
                ) : visible.map((t) => {
                  const invalid = !t.is_active || t.expired || t.used_up;
                  return (
                    <tr key={t.id} style={{ borderBottom: "1px solid #21262d", opacity: invalid ? 0.5 : 1 }}>
                      <td style={{ padding: "8px 10px" }}>
                        <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color: invalid ? "#8b949e" : "#58a6ff", letterSpacing: 1 }}>{t.token}</span>
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: "#cdd9e5" }}>{t.label || <span style={{ color: "#484f58" }}>—</span>}</td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: t.expired ? "#f85149" : "#8b949e", whiteSpace: "nowrap" }}>
                        {t.expires_at ? fmtDate(t.expires_at) + (t.expired ? " 過期" : "") : "永不到期"}
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 12, color: t.used_up ? "#f85149" : "#8b949e", whiteSpace: "nowrap" }}>
                        {t.use_count} / {t.max_uses ?? "∞"}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ display: "flex", gap: 5, justifyContent: "flex-end" }}>
                          <button onClick={() => handleToggle(t.id)} style={{ ...iconActionBtn, color: t.is_active ? "#8b949e" : "#3fb950", borderColor: t.is_active ? "#30363d" : "#238636" }}>
                            {t.is_active ? "停用" : "啟用"}
                          </button>
                          <button onClick={() => setDeleteToken(t)} style={{ ...iconActionBtn, color: "#f85149", borderColor: "#da363344" }}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {hiddenCount > 0 && (
              <div style={{ fontSize: 11, color: "#484f58", textAlign: "center", padding: "8px 0" }}>
                已隱藏 {hiddenCount} 筆失效 Token
              </div>
            )}
          </div>
        );
      })()}
      {deleteToken && (
        <ConfirmModal
          title="撤銷訪客 Token"
          message={`確定撤銷 Token「${deleteToken.token}」${deleteToken.label ? `（${deleteToken.label}）` : ""}？\n撤銷後持有者無法再用它登入，此操作無法復原。`}
          type="danger"
          confirmText={deletingToken ? "撤銷中…" : "確認撤銷"}
          confirmDisabled={deletingToken}
          onConfirm={performDeleteToken}
          onCancel={() => { setDeleteToken(null); setDeletingToken(false); }}
        />
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

const iconActionBtn = {
  padding: "4px 8px",
  borderRadius: 4,
  border: "1px solid #30363d",
  background: "transparent",
  color: "#8b949e",
  fontSize: 13,
  cursor: "pointer",
  lineHeight: 1,
};

export default function UsersPage({ active, role }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [modalUser, setModalUser] = useState(undefined); // undefined=隱藏, null=新增, obj=編輯
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { showToast } = useToast();

  const fetchUsers = useCallback(async () => {
    if (!active || role !== "admin") return;
    setLoading(true);
    setLoadError("");
    try {
      const res = await api.get("/api/auth/users");
      setUsers(res.data);
    } catch (e) {
      console.error(e);
      setLoadError(e.response?.status === 403 ? ADMIN_ONLY_ERROR : "人員資料載入失敗");
    } finally {
      setLoading(false);
    }
  }, [active, role]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleToggleActive = async (user) => {
    const action = user.is_active ? "停用" : "啟用";
    try {
      await api.patch(`/api/auth/users/${user.id}`, {
        is_active: !user.is_active,
      });
      showToast(`已${action}「${user.display_name}」`, "success");
      fetchUsers();
    } catch (e) {
      console.error(e);
      showToast(e.response?.data?.detail || `「${user.display_name}」${action}失敗`, "error");
    }
  };

  // 只有成功才把視窗收掉。失敗時人還在，畫面不能看起來已經處理完，
  // 不然使用者以為刪掉了，那個人其實還能登入。
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const name = deleteTarget.display_name;
    setDeleting(true);
    try {
      await api.delete(`/api/auth/users/${deleteTarget.id}`);
      showToast(`已刪除「${name}」`, "success");
      setDeleteTarget(null);
      fetchUsers();
    } catch (e) {
      console.error(e);
      showToast(e.response?.data?.detail || `「${name}」刪除失敗`, "error", 4000, e.response?.data?.hint);
    } finally {
      setDeleting(false);
    }
  };

  const thStyle = {
    padding: "6px 10px",
    fontSize: 11,
    color: "#8b949e",
    fontWeight: 600,
    textAlign: "left",
    borderBottom: "1px solid #21262d",
    whiteSpace: "nowrap",
  };
  const tdStyle = {
    padding: "8px 10px",
    fontSize: 13,
    color: "#cdd9e5",
    borderBottom: "1px solid #21262d",
  };

  if (role !== "admin") return null;
  if (loadError === ADMIN_ONLY_ERROR) {
    return <div style={{ padding: 24, color: C.error }}>{ADMIN_ONLY_ERROR}</div>;
  }

  return (
    <div
      style={{
        padding: "16px 20px",
        height: "100%",
        overflowY: "auto",
        backgroundColor: "#0d1117",
        fontFamily: "system-ui, -apple-system, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* ── 左側：人員管理 ── */}
        <div style={{ flex: "0 0 38%", minWidth: 0 }}>
          <div style={{ background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#21262d" }}>
                  <th style={thStyle}>姓名</th>
                  <th style={thStyle}>角色</th>
                  <th style={thStyle}>狀態</th>
                  <th style={{ ...thStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>操作</span>
                    <button
                      onClick={() => setModalUser(null)}
                      style={{ padding: "2px 10px", borderRadius: 5, background: "#238636", color: "#fff", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      + 新增
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loadError ? (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: C.error }}>{loadError}</td></tr>
                ) : loading ? (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}>載入中...</td></tr>
                ) : users.length === 0 ? (
                  <tr><td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#8b949e" }}>尚無人員資料</td></tr>
                ) : (
                  users.map((u) => (
                    <tr
                      key={u.id}
                      style={{ transition: "background .1s", opacity: u.is_active ? 1 : 0.45 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#1c2128")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ ...tdStyle, fontWeight: 600 }}>{u.display_name}</td>
                      <td style={tdStyle}><RoleBadge role={u.role} /></td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: u.is_active ? "#0d1f14" : "#21262d", color: u.is_active ? "#3fb950" : "#8b949e", border: `1px solid ${u.is_active ? "#238636" : "#30363d"}` }}>
                          {u.is_active ? "啟用" : "停用"}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={() => setModalUser(u)} style={iconActionBtn}>編輯</button>
                          <button onClick={() => handleToggleActive(u)} style={{ ...iconActionBtn, color: u.is_active ? "#8b949e" : "#3fb950", borderColor: u.is_active ? "#30363d" : "#238636" }}>
                            {u.is_active ? "停用" : "啟用"}
                          </button>
                          <button onClick={() => setDeleteTarget(u)} style={{ ...iconActionBtn, color: "#f85149", borderColor: "#da363344" }}>刪除</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── 右側：訪客 Token ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <DemoTokenSection active={active} />
        </div>
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
          title="刪除人員"
          message={`確定要刪除「${deleteTarget.display_name}」？此操作無法復原。`}
          type="danger"
          confirmText={deleting ? "刪除中…" : "確認刪除"}
          confirmDisabled={deleting}
          onConfirm={handleDelete}
          onCancel={() => { setDeleteTarget(null); setDeleting(false); }}
        />
      )}
    </div>
  );
}
