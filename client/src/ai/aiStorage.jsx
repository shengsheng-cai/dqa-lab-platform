// 對話儲存與管理（localStorage 存取、對話紀錄遷移、對話刪除等）

const STORAGE_KEY = "dqa_ai_chats_v2";
const LEGACY_KEY = "dqa_ai_chat_history";

/**
 * 從訊息列表產生標題（取第一則使用者訊息前 20 字）
 */
const titleFrom = (msgs) => {
  const first = msgs.find((m) => m.role === "user");
  if (!first) return "新對話";
  const raw = first.content.slice(0, 30);
  const cut = raw.search(/[，。？！,?!\n]/);
  return (
    (cut > 0 && cut <= 24 ? raw.slice(0, cut) : raw.slice(0, 20)) +
    (first.content.length > 20 ? "…" : "")
  );
};

/**
 * 生成新的對話 ID
 */
export const genId = () =>
  `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

/**
 * 創建新對話
 */
export const createConversation = ({
  title = "新對話",
  projectGroup = "未分組",
} = {}) => ({
  id: genId(),
  title,
  projectGroup,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  messages: [],
});

/**
 * 初始儲存空白的狀態
 */
const emptyStore = () => ({
  activeConversationId: null,
  conversations: {},
  projectGroups: ["未分組"],
});

/**
 * 將舊資料遷移至新的格式
 */
const migrate = (store) => {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return store;
    const parsed = JSON.parse(raw);
    const msgs = Array.isArray(parsed) ? parsed : parsed?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return store;
    }
    const conv = createConversation({
      title: titleFrom(msgs),
      projectGroup: "未分組",
    });
    conv.messages = msgs;
    store.conversations[conv.id] = conv;
    store.activeConversationId = conv.id;
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 遷移失敗不影響主流程 */
  }
  return store;
};

/**
 * 載入儲存的對話紀錄
 */
export const loadChats = () => {
  let store;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    store = raw ? JSON.parse(raw) : null;
  } catch {
    store = null;
  }

  if (!store) store = emptyStore();

  if (!store.projectGroups) store.projectGroups = ["未分組"];
  if (!store.projectGroups.includes("未分組"))
    store.projectGroups = ["未分組", ...store.projectGroups];

  if (store.projectGroups.includes("未分類")) {
    store.projectGroups = store.projectGroups.map((g) =>
      g === "未分類" ? "未分組" : g,
    );
    Object.values(store.conversations ?? {}).forEach((c) => {
      if (c.projectGroup === "未分類") c.projectGroup = "未分組";
    });
  }

  store = migrate(store);

  Object.values(store.conversations ?? {}).forEach((c) => {
    if (c.projectGroup && !store.projectGroups.includes(c.projectGroup)) {
      store.projectGroups.push(c.projectGroup);
    }
  });

  if (!store.projectGroups.includes("未分組")) {
    store.projectGroups.push("未分組");
  }

  if (Object.keys(store.conversations).length === 0) {
    const conv = createConversation();
    store.conversations[conv.id] = conv;
    store.activeConversationId = conv.id;
  } else if (!store.conversations[store.activeConversationId]) {
    const latest = Object.values(store.conversations).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    )[0];
    store.activeConversationId = latest.id;
  }
  return store;
};

/**
 * 儲存對話紀錄
 */
export const saveChats = (store) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full */
  }
};

/**
 * 刪除對話
 */
export const deleteConversation = (store, id) => {
  const next = { ...store, conversations: { ...store.conversations } };
  delete next.conversations[id];

  if (Object.keys(next.conversations).length === 0) {
    const conv = createConversation();
    next.conversations[conv.id] = conv;
    next.activeConversationId = conv.id;
  } else if (next.activeConversationId === id) {
    const latest = Object.values(next.conversations).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    )[0];
    next.activeConversationId = latest.id;
  }

  const usedGroups = new Set(
    Object.values(next.conversations).map((c) => c.projectGroup),
  );
  next.projectGroups = [
    "未分組",
    ...next.projectGroups.filter((g) => g !== "未分組" && usedGroups.has(g)),
  ];

  return next;
};

/**
 * 匯出對話紀錄
 */
export const exportChat = (messages, title = "對話紀錄") => {
  const lines = messages.map((m) => {
    const role = m.role === "user" ? "【使用者】" : "【AI 助手】";
    const time = m.elapsed ? ` (⏱ ${m.elapsed}s)` : "";
    const text = m.content
      .replace(/```[\w]*\n?/g, "")
      .replace(/```/g, "")
      .trim();
    return `${role}${time}\n${text}\n`;
  });
  const header =
    `DQA Lab 法規諮詢對話紀錄\n標題：${title}\n` +
    `匯出時間：${new Date().toLocaleString("zh-TW")}\n${"─".repeat(40)}\n\n`;
  const blob = new Blob([header + lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dqa_chat_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.txt`;
  a.click();
  // A6 fix: 延遲 1 秒再 revoke，避免部分瀏覽器下載來不及觸發
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
