// client/src/ai/ChatSidebar.jsx
import { useState } from "react";
import { exportChat } from "./aiStorage";

export default function ChatSidebar({
  open,
  onToggle,
  conversations,
  activeId,
  projectGroups,
  loading,
  onSwitch,
  onAdd,
  onDelete,
  onRename,
  onSetGroup,
  onAddGroup,
  onClear,
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [newGroupInput, setNewGroupInput] = useState("");
  const [showGroupInput, setShowGroupInput] = useState(false);

  // 收集所有對話實際用到的分組（含孤立分組）
  const allGroupsInUse = [
    ...new Set(Object.values(conversations).map((c) => c.projectGroup)),
  ];

  // 合併 projectGroups 陣列與實際用到的分組，確保無孤立對話被遺漏
  const allGroups = [...new Set([...projectGroups, ...allGroupsInUse])];

  // 依分組聚合對話
  const grouped = allGroups.reduce((acc, g) => {
    acc[g] = Object.values(conversations)
      .filter((c) => c.projectGroup === g)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    return acc;
  }, {});

  // 排序：「未分組」永遠最後
  const sortedGroups = [...allGroups.filter((g) => g !== "未分組"), "未分組"];

  const commitRename = () => {
    if (editingTitle.trim()) onRename(editingId, editingTitle.trim());
    setEditingId(null);
  };

  const commitAddGroup = () => {
    const name = newGroupInput.trim();
    if (name) {
      onAddGroup(name);
      // 同時在新分組建立一個新對話，避免空分組被自動清除
      onAdd({ projectGroup: name });
    }
    setNewGroupInput("");
    setShowGroupInput(false);
  };

  const activeConv = conversations[activeId];

  return (
    <aside
      style={{
        ...S.sidebar,
        width: open ? 220 : 36,
        minWidth: open ? 220 : 36,
      }}
    >
      <div style={S.header}>
        {open && <span style={S.headerTitle}>對話紀錄</span>}
        <button
          style={S.toggleBtn}
          onClick={onToggle}
          title={open ? "收合" : "展開"}
        >
          {open ? "◀" : "▶"}
        </button>
      </div>

      {open && (
        <>
          <button
            style={S.newBtn}
            onClick={() => onAdd()}
            disabled={loading}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "#1f6feb22")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "transparent")
            }
          >
            ＋ 新對話
          </button>

          <div style={S.listArea}>
            {sortedGroups.map((group) => {
              const items = grouped[group] ?? [];
              // 空分組一律不顯示
              if (items.length === 0) return null;
              return (
                <div key={group}>
                  <div style={S.groupLabel}>{group}</div>
                  {items.map((conv) => {
                    const isActive = conv.id === activeId;
                    return (
                      <div key={conv.id} style={{ position: "relative" }}>
                        {editingId === conv.id ? (
                          <input
                            autoFocus
                            style={S.renameInput}
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                        ) : deleteConfirm === conv.id ? (
                          <div style={S.confirmRow}>
                            <span style={S.confirmText}>確認刪除？</span>
                            <button
                              style={S.confirmYes}
                              onClick={() => {
                                onDelete(conv.id);
                                setDeleteConfirm(null);
                              }}
                            >
                              刪除
                            </button>
                            <button
                              style={S.confirmNo}
                              onClick={() => setDeleteConfirm(null)}
                            >
                              取消
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              ...S.convItem,
                              ...(isActive ? S.convItemActive : {}),
                            }}
                            onClick={() => onSwitch(conv.id)}
                            onMouseEnter={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background = "#21262d";
                            }}
                            onMouseLeave={(e) => {
                              if (!isActive)
                                e.currentTarget.style.background =
                                  "transparent";
                            }}
                          >
                            <span style={S.convTitle} title={conv.title}>
                              {conv.title}
                            </span>
                            <div style={S.convActions}>
                              <button
                                style={S.iconBtn}
                                title="重新命名"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(conv.id);
                                  setEditingTitle(conv.title);
                                }}
                              >
                                ✏️
                              </button>
                              <button
                                style={S.iconBtn}
                                title="匯出"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  exportChat(conv.messages, conv.title);
                                }}
                              >
                                📥
                              </button>
                              <button
                                style={{ ...S.iconBtn, color: "#f85149" }}
                                title="刪除"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirm(conv.id);
                                }}
                              >
                                🗑
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          <div style={S.groupActions}>
            {showGroupInput ? (
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  autoFocus
                  style={S.groupInput}
                  placeholder="分組名稱"
                  value={newGroupInput}
                  onChange={(e) => setNewGroupInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAddGroup();
                    if (e.key === "Escape") setShowGroupInput(false);
                  }}
                />
                <button style={S.confirmYes} onClick={commitAddGroup}>
                  新增
                </button>
              </div>
            ) : (
              <button
                style={S.addGroupBtn}
                onClick={() => setShowGroupInput(true)}
              >
                ＋ 新增分組
              </button>
            )}
          </div>

          {activeConv?.messages?.length > 0 && (
            <button
              style={S.clearBtn}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#3d1c1c")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
              onClick={onClear}
            >
              🗑 清除目前對話
            </button>
          )}

          <div style={S.modelBadge}>
            <span style={{ color: "#3fb950" }}>●</span> qwen2.5:7b（本機）
          </div>
        </>
      )}
    </aside>
  );
}

const S = {
  sidebar: {
    backgroundColor: "#161b22",
    borderRight: "1px solid #30363d",
    padding: "12px 8px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    height: "100%",
    overflowX: "hidden",
    transition: "width .2s ease, min-width .2s ease",
    flexShrink: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    minHeight: 28,
    flexShrink: 0,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#8b949e",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    paddingLeft: 4,
  },
  toggleBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    color: "#8b949e",
    fontSize: 10,
    padding: "4px 7px",
    cursor: "pointer",
    borderRadius: 4,
    flexShrink: 0,
  },
  newBtn: {
    background: "transparent",
    border: "1px solid #30363d",
    color: "#58a6ff",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    transition: "background .15s",
    marginBottom: 8,
    flexShrink: 0,
  },
  listArea: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
    overflowX: "hidden",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  groupLabel: {
    fontSize: 10,
    color: "#6e7681",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    padding: "8px 4px 4px",
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  emptyBadge: {
    fontSize: 9,
    color: "#484f58",
    background: "#21262d",
    borderRadius: 3,
    padding: "1px 4px",
  },
  convItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px",
    borderRadius: 6,
    cursor: "pointer",
    transition: "background .15s",
    gap: 4,
  },
  convItemActive: {
    background: "#21262d",
    borderLeft: "2px solid #58a6ff",
    padding: "6px 8px 6px 6px",
  },
  convTitle: {
    fontSize: 12,
    color: "#cdd9e5",
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  convActions: { display: "flex", gap: 2, flexShrink: 0, opacity: 0.6 },
  iconBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 3px",
    borderRadius: 3,
  },
  confirmRow: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    background: "#21262d",
    borderRadius: 6,
  },
  confirmText: { fontSize: 11, color: "#f85149", flex: 1 },
  confirmYes: {
    background: "#da3633",
    border: "none",
    color: "#fff",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
  },
  confirmNo: {
    background: "#21262d",
    border: "1px solid #30363d",
    color: "#8b949e",
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 4,
    cursor: "pointer",
  },
  renameInput: {
    width: "100%",
    background: "#0d1117",
    border: "1px solid #58a6ff",
    borderRadius: 4,
    color: "#cdd9e5",
    fontSize: 12,
    padding: "4px 8px",
    outline: "none",
  },
  groupActions: {
    marginTop: 8,
    paddingTop: 8,
    borderTop: "1px solid #21262d",
    flexShrink: 0,
  },
  groupInput: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 4,
    color: "#cdd9e5",
    fontSize: 11,
    padding: "4px 6px",
    outline: "none",
  },
  addGroupBtn: {
    background: "transparent",
    border: "none",
    color: "#6e7681",
    fontSize: 11,
    cursor: "pointer",
    padding: "4px 0",
    width: "100%",
    textAlign: "left",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid #3d1c1c",
    color: "#f85149",
    fontSize: 11,
    padding: "5px 10px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    marginTop: 8,
    transition: "background .15s",
    flexShrink: 0,
  },
  modelBadge: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 8,
    paddingTop: 12,
    paddingLeft: 4,
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
};
