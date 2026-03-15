// client/src/ai/aiStorage.jsx
const STORAGE_KEY = "dqa_ai_chats_v2";
const LEGACY_KEY = "dqa_ai_chat_history";

export const genId = () =>
  `conv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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

const emptyStore = () => ({
  activeConversationId: null,
  conversations: {},
  projectGroups: ["未分組"],
});

const titleFrom = (messages) => {
  const first = messages?.find((m) => m.role === "user");
  if (!first) return "新對話";
  return first.content.slice(0, 20) + (first.content.length > 20 ? "…" : "");
};

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

export const loadChats = () => {
  let store;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    store = raw ? JSON.parse(raw) : null;
  } catch {
    store = null;
  }

  if (!store) store = emptyStore();

  // 確保「未分組」永遠存在
  if (!store.projectGroups) store.projectGroups = ["未分組"];
  if (!store.projectGroups.includes("未分組"))
    store.projectGroups = ["未分組", ...store.projectGroups];

  // 舊資料遷移：把「未分類」替換為「未分組」
  if (store.projectGroups.includes("未分類")) {
    store.projectGroups = store.projectGroups.map((g) =>
      g === "未分類" ? "未分組" : g,
    );
    Object.values(store.conversations ?? {}).forEach((c) => {
      if (c.projectGroup === "未分類") c.projectGroup = "未分組";
    });
  }

  store = migrate(store);

  // 掃描所有對話的 projectGroup，若不在 projectGroups 陣列就補進去
  Object.values(store.conversations ?? {}).forEach((c) => {
    if (c.projectGroup && !store.projectGroups.includes(c.projectGroup)) {
      store.projectGroups.push(c.projectGroup);
    }
  });

  // 清除無任何對話的空分組（「未分組」永遠保留）
  const usedGroups = new Set(
    Object.values(store.conversations ?? {}).map((c) => c.projectGroup),
  );
  store.projectGroups = [
    ...new Set([
      ...store.projectGroups.filter((g) => g !== "未分組" && usedGroups.has(g)),
      "未分組",
    ]),
  ];

  if (Object.keys(store.conversations).length === 0) {
    const conv = createConversation();
    store.conversations[conv.id] = conv;
    store.activeConversationId = conv.id;
  } else if (!store.conversations[store.activeConversationId]) {
    // activeConversationId 指向不存在的對話，修正為最新一筆
    const latest = Object.values(store.conversations).sort(
      (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt),
    )[0];
    store.activeConversationId = latest.id;
  }
  return store;
};

export const saveChats = (store) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* storage full */
  }
};

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

  // 清除已無對話的空分組（「未分組」永遠保留）
  const usedGroups = new Set(
    Object.values(next.conversations).map((c) => c.projectGroup),
  );
  next.projectGroups = [
    "未分組",
    ...next.projectGroups.filter((g) => g !== "未分組" && usedGroups.has(g)),
  ];

  return next;
};

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
  URL.revokeObjectURL(url);
};
