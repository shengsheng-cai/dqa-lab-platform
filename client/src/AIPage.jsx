import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = "http://localhost:8000";
const STORAGE_KEY = "dqa_ai_chat_history";
const MAX_HISTORY = 50;

// ── 繁體中文強制前綴（只在送給 API 時加，不存入 messages）────
// BUG FIX: 前綴只附加在送出給 Ollama 的 message 欄位，
//          絕對不存入 messages state，避免多輪對話後不斷累積。
const TC_PREFIX = "[請用繁體中文回覆，不可有任何簡體字] ";

// ── 簡體中文特徵字偵測 ───────────────────────────────────────
const SIMPLIFIED_CHARS =
  "设备测试标准规范环境温湿电压电流频率认证报告执行确认检查记录";
function hasSimplified(text) {
  return SIMPLIFIED_CHARS.split("").some((c) => text.includes(c));
}

// ── localStorage 安全存入（容量保護）────────────────────────
function saveMessages(msgs) {
  const trimmed = msgs.slice(-MAX_HISTORY);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(-20)));
    } catch {}
  }
}

// ── 對話匯出 .txt ────────────────────────────────────────────
function exportChat(messages) {
  const lines = messages.map((m) => {
    const role = m.role === "user" ? "【使用者】" : "【AI 助手】";
    const time = m.elapsed ? ` (⏱ ${m.elapsed}s)` : "";
    return `${role}${time}\n${cleanText(m.content)}\n`;
  });
  const header = `DQA Lab 法規諮詢對話紀錄\n匯出時間：${new Date().toLocaleString("zh-TW")}\n${"─".repeat(40)}\n\n`;
  const blob = new Blob([header + lines.join("\n")], {
    type: "text/plain;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  a.href = url;
  a.download = `dqa_chat_${date}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── 前處理：清除 code block 標籤 ────────────────────────────
function cleanText(text) {
  return text
    .replace(/```[\w]*\n?/g, "")
    .replace(/```/g, "")
    .trim();
}

// ── Markdown 簡易渲染器 ──────────────────────────────────────
function renderMarkdown(rawText) {
  const text = cleanText(rawText);
  const lines = text.split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={i} style={styles.h3}>
          {line.slice(4)}
        </h3>,
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <h2 key={i} style={styles.h2}>
          {line.slice(3)}
        </h2>,
      );
    } else if (line.startsWith("# ")) {
      elements.push(
        <h1 key={i} style={styles.h1}>
          {line.slice(2)}
        </h1>,
      );
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      elements.push(
        <div key={i} style={styles.listItem}>
          <span style={styles.bullet}>▸</span>
          <span>{inlineMarkdown(line.slice(2))}</span>
        </div>,
      );
    } else if (/^\d+[\.\、]\s*/.test(line)) {
      const match = line.match(/^(\d+)[\.、]\s*(.*)$/);
      elements.push(
        <div key={i} style={styles.listItem}>
          <span style={styles.numBullet}>{match[1]}.</span>
          <span>{inlineMarkdown(match[2])}</span>
        </div>,
      );
    } else if (line.trim() === "") {
      elements.push(<div key={i} style={{ height: 8 }} />);
    } else {
      elements.push(
        <p key={i} style={styles.p}>
          {inlineMarkdown(line)}
        </p>,
      );
    }
    i++;
  }
  return elements;
}

function inlineMarkdown(text) {
  const parts = [];
  const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
  let last = 0,
    match,
    idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[2])
      parts.push(
        <strong key={idx++} style={{ color: "#cdd9e5" }}>
          {match[2]}
        </strong>,
      );
    else if (match[3])
      parts.push(
        <code key={idx++} style={styles.inlineCode}>
          {match[3]}
        </code>,
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// ── 預設快速提問 ─────────────────────────────────────────────
const DEFAULT_QUESTIONS = [
  "我有鐵路車載電子設備，需要哪些環境測試？",
  "IEC 60068 和 EN 50155 有什麼差別？",
  "我的產品要在戶外使用，適合哪個法規？",
  "DNV 認證需要哪些溫度測試條件？",
  "什麼情況下需要做濕熱循環測試？",
  "KEMA KEUR 適用於什麼類型的設備？",
];

// ── 可折疊 AI 泡泡 ───────────────────────────────────────────
const COLLAPSE_HEIGHT = 300;

function CollapsibleBubble({ children }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const innerRef = useRef(null);

  useEffect(() => {
    if (innerRef.current) {
      setOverflow(innerRef.current.scrollHeight > COLLAPSE_HEIGHT);
    }
  }, [children]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={innerRef}
        style={{
          maxHeight: overflow && !expanded ? COLLAPSE_HEIGHT : undefined,
          overflow: "hidden",
          transition: "max-height .3s ease",
        }}
      >
        {children}
      </div>
      {overflow && (
        <div style={expanded ? styles.collapseBarExpanded : styles.collapseBar}>
          <button
            style={styles.collapseBtn}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收合 ▲" : "顯示更多 ▼"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── 單則訊息元件 ─────────────────────────────────────────────
function MessageBubble({ m, onRetry }) {
  const [copied, setCopied] = useState(false);
  const simplified = m.role === "assistant" && hasSimplified(m.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(cleanText(m.content)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div
      style={m.role === "user" ? styles.userBubbleWrap : styles.aiBubbleWrap}
    >
      <div
        style={{
          maxWidth: m.role === "user" ? "70%" : "82%",
          width: "fit-content",
        }}
      >
        <div style={m.role === "user" ? styles.userBubble : styles.aiBubble}>
          {m.role === "assistant" ? (
            <CollapsibleBubble>{renderMarkdown(m.content)}</CollapsibleBubble>
          ) : (
            // messages.content 存的是原始使用者輸入，不含前綴，直接顯示即可
            <p style={{ margin: 0 }}>{m.content}</p>
          )}
        </div>
        {m.role === "assistant" && (
          <div style={styles.bubbleMeta}>
            {m.elapsed != null && (
              <span style={styles.elapsed}>⏱ {m.elapsed}s</span>
            )}
            {m.stopped && (
              <span style={{ ...styles.elapsed, color: "#f85149" }}>
                已停止
              </span>
            )}
            {simplified && (
              <>
                <span style={{ ...styles.elapsed, color: "#e3b341" }}>
                  ⚠️ 含簡體
                </span>
                {/*
                  BUG FIX: onRetry 呼叫 retryInTraditional(i)，
                  該函式從 messages[i-1] 取出乾淨的 user content（不含前綴），
                  再呼叫 sendMessage()，sendMessage 內部才加前綴送給 API。
                  因此這裡不需要也不應該在按鈕層手動拼接前綴。
                */}
                <button
                  style={{ ...styles.copyBtn, color: "#e3b341" }}
                  onClick={onRetry}
                >
                  重新用繁體回答
                </button>
              </>
            )}
            <button
              style={{
                ...styles.copyBtn,
                color: copied ? "#3fb950" : "#8b949e",
              }}
              onClick={handleCopy}
              title="複製回覆"
            >
              {copied ? "✓ 已複製" : "複製"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 主元件 ───────────────────────────────────────────────────
export default function AIPage() {
  const [messages, setMessages] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const prevSuggestionsRef = useRef(null);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const streamTextRef = useRef("");
  const startTimeRef = useRef(null);

  // ── localStorage 同步（含容量保護）──────────────────────────
  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  // ── 自動捲到底 ──────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  // ── textarea auto-resize ─────────────────────────────────────
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    const lineHeight = 22;
    const minH = lineHeight * 3;
    const maxH = lineHeight * 8;
    el.style.height = Math.min(Math.max(el.scrollHeight, minH), maxH) + "px";
  };

  // ── 產生追問建議 ─────────────────────────────────────────────
  const generateSuggestions = useCallback(
    async (currentMessages) => {
      setSuggestLoading(true);
      try {
        const recentHistory = currentMessages.slice(-6).map((m) => ({
          role: m.role,
          // BUG FIX: m.content 已是乾淨字串（不含 TC_PREFIX），
          //          直接送給建議 API 即可，不需要再加前綴。
          content: m.content,
        }));
        const prompt =
          "根據以上對話內容，產生 3 個使用者接下來可能想追問的問題，必須與環境測試法規相關。" +
          '只回傳 JSON 陣列，不要其他文字，格式：["問題一","問題二","問題三"]';

        const res = await fetch(`${API_BASE}/api/ai/standards-query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt, history: recentHistory }),
        });
        if (!res.ok) throw new Error("建議產生失敗");
        const data = await res.json();
        const raw = data.reply || "";
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const next = parsed.slice(0, 3);
            prevSuggestionsRef.current = next;
            setSuggestions(next);
            return;
          }
        }
        throw new Error("解析失敗");
      } catch (err) {
        console.warn("[AIPage] 追問建議產生失敗，保留上一輪", err);
        setSuggestions(prevSuggestionsRef.current);
      } finally {
        setSuggestLoading(false);
      }
    },
    [suggestions],
  );

  // ── 停止串流 ─────────────────────────────────────────────────
  const stopStream = () => {
    const currentText = streamTextRef.current;
    const elapsed = startTimeRef.current
      ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1)
      : null;
    if (currentText.trim()) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: currentText, elapsed, stopped: true },
      ]);
    }
    setStreamText("");
    streamTextRef.current = "";
    setLoading(false);
    abortControllerRef.current?.abort();
    inputRef.current?.focus();
  };

  // ── 送出訊息 ─────────────────────────────────────────────────
  // BUG FIX 核心：
  //   - `rawMsg`：使用者原始輸入，存入 messages state 及 history，不含前綴
  //   - `apiMsg`：送給 Ollama 的 message 欄位，加上 TC_PREFIX 防止語言飄移
  //   - history 組建時從 messages state 讀取（均為乾淨字串），不會疊加前綴
  const sendMessage = useCallback(
    async (text) => {
      // rawMsg = 使用者輸入的原始文字，不含任何前綴
      const rawMsg = (text !== undefined ? text : input).trim();
      if (!rawMsg || loading) return;

      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      // 存入 messages 的 user content 永遠是乾淨的 rawMsg
      const newMessages = [...messages, { role: "user", content: rawMsg }];
      setMessages(newMessages);
      setLoading(true);
      setSuggestLoading(true);
      setSuggestions(null);
      setStreamText("");
      streamTextRef.current = "";
      startTimeRef.current = Date.now();

      // history 從 messages state 建立，content 均為乾淨字串（不含前綴）
      const history = newMessages
        .slice(0, -1)
        .map((m) => ({ role: m.role, content: m.content }));

      // apiMsg 才加上繁體中文強制前綴，只用於本次 API 請求
      const apiMsg = TC_PREFIX + rawMsg;

      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/api/ai/standards-query-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // 送給後端的 message 含前綴，但 history 裡的內容乾淨
          body: JSON.stringify({ message: apiMsg, history }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("串流請求失敗");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          streamTextRef.current = fullText;
          setStreamText(fullText);
        }

        if (!controller.signal.aborted && fullText.trim()) {
          const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(
            1,
          );
          const finalMessages = [
            ...newMessages,
            { role: "assistant", content: fullText, elapsed },
          ];
          setMessages(finalMessages);
          generateSuggestions(finalMessages);
        }
      } catch (err) {
        setSuggestLoading(false);
        if (err.name !== "AbortError") {
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: "⚠️ 連線失敗，請確認後端與 Ollama 是否正常運行。",
            },
          ]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setStreamText("");
          streamTextRef.current = "";
          abortControllerRef.current = null;
          inputRef.current?.focus();
        }
      }
    },
    [messages, input, loading, generateSuggestions],
  );

  // ── 簡體重問 ─────────────────────────────────────────────────
  // BUG FIX:
  //   messages[i] 是含簡體的 AI 回覆，messages[i-1] 是對應的 user 訊息。
  //   由於 messages 裡的 user content 已是乾淨字串（不含前綴），
  //   直接把它傳給 sendMessage 即可。
  //   sendMessage 內部會自動加上 TC_PREFIX 再送給 API，不會在這裡重複疊加。
  const retryInTraditional = useCallback(
    (msgIndex) => {
      let userMsg = "";
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i].content; // 乾淨的原始輸入，無前綴
          break;
        }
      }
      // 直接把乾淨的 userMsg 傳入，sendMessage 會在內部加 TC_PREFIX
      if (userMsg) sendMessage(userMsg);
    },
    [messages, sendMessage],
  );

  // ── 清除對話 ─────────────────────────────────────────────────
  const clearChat = () => {
    setMessages([]);
    setSuggestions(null);
    prevSuggestionsRef.current = null;
    setInput("");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentQuestions = suggestions ?? DEFAULT_QUESTIONS;
  const isDynamic = suggestions !== null;
  const hasMessages = messages.length > 0;

  return (
    <div style={styles.page}>
      {/* ── 左側欄 ── */}
      <aside
        style={{
          ...styles.sidebar,
          width: sidebarOpen ? 240 : 36,
          minWidth: sidebarOpen ? 240 : 36,
        }}
      >
        {/* 頂部 */}
        <div style={styles.sidebarHeader}>
          {sidebarOpen && (
            <span style={styles.sidebarTitle}>
              {isDynamic ? "💡 追問建議" : "⚡ 快速提問"}
            </span>
          )}
          <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
            {sidebarOpen && isDynamic && (
              <button
                style={styles.resetBtn}
                onClick={() => {
                  setSuggestions(null);
                  prevSuggestionsRef.current = null;
                }}
                title="回到預設問題"
              >
                ↺
              </button>
            )}
            <button
              style={styles.toggleBtn}
              onClick={() => setSidebarOpen((v) => !v)}
              title={sidebarOpen ? "收合側欄" : "展開側欄"}
            >
              {sidebarOpen ? "◀" : "▶"}
            </button>
          </div>
        </div>

        {sidebarOpen ? (
          <>
            {suggestLoading ? (
              <div style={styles.suggestLoading}>
                <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                <span style={{ ...styles.dot, animationDelay: "200ms" }} />
                <span style={{ ...styles.dot, animationDelay: "400ms" }} />
                <span style={{ fontSize: 11, color: "#8b949e", marginLeft: 4 }}>
                  產生建議中...
                </span>
              </div>
            ) : (
              currentQuestions.map((q, i) => (
                <button
                  key={i}
                  style={{
                    ...styles.quickBtn,
                    borderLeft: isDynamic ? "2px solid #58a6ff33" : "none",
                    paddingLeft: isDynamic ? 8 : 10,
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.5 : 1,
                  }}
                  onClick={() => sendMessage(q)}
                  disabled={loading}
                  onMouseEnter={(e) => {
                    if (!loading) e.currentTarget.style.background = "#21262d";
                  }}
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  {q}
                </button>
              ))
            )}

            <div
              style={{
                marginTop: "auto",
                paddingTop: 16,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {hasMessages && (
                <button
                  style={styles.exportBtn}
                  onClick={() => exportChat(messages)}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "#1c2d1c")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  📥 匯出對話
                </button>
              )}
              <button
                style={styles.clearBtn}
                onClick={clearChat}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "#3d1c1c")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                🗑 清除對話
              </button>
            </div>
            <div style={styles.modelBadge}>
              <span style={{ color: "#3fb950" }}>●</span> qwen2.5:7b（本機）
            </div>
          </>
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "center",
              paddingTop: 4,
            }}
          >
            {currentQuestions.map((q, i) => (
              <button
                key={i}
                style={{
                  ...styles.iconBtn,
                  cursor: loading ? "not-allowed" : "pointer",
                }}
                onClick={() => setSidebarOpen(true)}
                title={q}
                disabled={loading}
              >
                {isDynamic ? "💡" : "⚡"}
              </button>
            ))}
          </div>
        )}
      </aside>

      {/* ── 右側主區 ── */}
      <div style={styles.main}>
        <div style={styles.chatArea}>
          {messages.length === 0 && !loading && (
            <div style={styles.emptyHint}>
              <div style={styles.emptyIcon}>🔬</div>
              <div style={styles.emptyTitle}>DQA Lab 法規諮詢助手</div>
              <div style={styles.emptyDesc}>
                描述你的產品或測試需求，AI 將從 6 大法規、64
                個測試條件中推薦最適合的方案。
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <MessageBubble
              key={i}
              m={m}
              onRetry={() => retryInTraditional(i)}
            />
          ))}

          {loading && streamText && (
            <div style={styles.aiBubbleWrap}>
              <div style={{ ...styles.aiBubble, borderColor: "#58a6ff" }}>
                {renderMarkdown(streamText)}
                <span style={styles.cursor}>▍</span>
              </div>
            </div>
          )}

          {loading && !streamText && (
            <div style={styles.aiBubbleWrap}>
              <div style={styles.aiBubble}>
                <div style={styles.typingWrap}>
                  <span style={{ ...styles.dot, animationDelay: "0ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "200ms" }} />
                  <span style={{ ...styles.dot, animationDelay: "400ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── 輸入區 ── */}
        <div style={styles.inputArea}>
          <textarea
            ref={(el) => {
              inputRef.current = el;
              textareaRef.current = el;
            }}
            style={{ ...styles.textarea, minHeight: 66 }}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="描述你的產品與測試需求，按 Enter 送出（Shift+Enter 換行）..."
            rows={3}
            disabled={loading}
          />
          {loading ? (
            <button
              style={styles.stopBtn}
              onClick={stopStream}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#3d1c1c")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              ⏹ 停止
            </button>
          ) : (
            <button
              style={{
                ...styles.sendBtn,
                opacity: !input.trim() ? 0.4 : 1,
                cursor: !input.trim() ? "not-allowed" : "pointer",
              }}
              onClick={() => sendMessage()}
              disabled={!input.trim()}
            >
              送出
            </button>
          )}
        </div>
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes dotBounce { 0%,80%,100%{transform:translateY(0);opacity:.4} 40%{transform:translateY(-6px);opacity:1} }
      `}</style>
    </div>
  );
}

// ── 樣式 ─────────────────────────────────────────────────────
const styles = {
  page: {
    display: "flex",
    height: "100%",
    backgroundColor: "#0d1117",
    color: "#cdd9e5",
    fontFamily: "'Noto Sans TC', sans-serif",
    overflow: "hidden",
  },
  sidebar: {
    backgroundColor: "#161b22",
    borderRight: "1px solid #30363d",
    padding: "12px 12px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflowY: "auto",
    overflowX: "hidden",
    transition: "width .2s ease, min-width .2s ease",
    flexShrink: 0,
  },
  sidebarHeader: {
    display: "flex",
    alignItems: "center",
    marginBottom: 8,
    minHeight: 28,
    gap: 4,
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: "#8b949e",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
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
    lineHeight: 1,
    flexShrink: 0,
    transition: "background .15s",
  },
  resetBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    color: "#58a6ff",
    fontSize: 12,
    padding: "4px 7px",
    cursor: "pointer",
    borderRadius: 4,
    lineHeight: 1,
    flexShrink: 0,
    transition: "background .15s",
  },
  quickBtn: {
    background: "transparent",
    border: "none",
    color: "#8b949e",
    fontSize: 12,
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 6,
    lineHeight: 1.5,
    transition: "all .15s",
    width: "100%",
  },
  iconBtn: {
    background: "transparent",
    border: "none",
    fontSize: 14,
    padding: "4px",
    borderRadius: 4,
    lineHeight: 1,
    transition: "background .15s",
  },
  exportBtn: {
    background: "transparent",
    border: "1px solid #1c4a1c",
    color: "#3fb950",
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    transition: "all .15s",
    whiteSpace: "nowrap",
  },
  clearBtn: {
    background: "transparent",
    border: "1px solid #3d1c1c",
    color: "#f85149",
    fontSize: 12,
    padding: "6px 12px",
    borderRadius: 6,
    cursor: "pointer",
    width: "100%",
    transition: "all .15s",
    whiteSpace: "nowrap",
  },
  modelBadge: {
    fontSize: 11,
    color: "#8b949e",
    marginTop: 12,
    paddingLeft: 4,
    display: "flex",
    alignItems: "center",
    gap: 6,
    whiteSpace: "nowrap",
  },
  suggestLoading: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "12px 10px",
  },
  collapseBar: {
    position: "relative",
    textAlign: "center",
    paddingTop: 8,
    background: "linear-gradient(to bottom, transparent, #161b22 60%)",
    marginTop: -40,
  },
  collapseBarExpanded: {
    textAlign: "center",
    paddingTop: 8,
  },
  collapseBtn: {
    background: "#21262d",
    border: "1px solid #30363d",
    color: "#58a6ff",
    fontSize: 11,
    padding: "3px 12px",
    borderRadius: 10,
    cursor: "pointer",
    transition: "background .15s",
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  chatArea: {
    flex: 1,
    overflowY: "auto",
    overflowX: "hidden",
    padding: "24px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  emptyHint: {
    margin: "auto",
    textAlign: "center",
    maxWidth: 480,
    padding: 40,
  },
  emptyIcon: { fontSize: 48, marginBottom: 16 },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: "#cdd9e5",
    marginBottom: 8,
  },
  emptyDesc: { fontSize: 14, color: "#8b949e", lineHeight: 1.7 },
  userBubbleWrap: { display: "flex", justifyContent: "flex-end" },
  aiBubbleWrap: { display: "flex", justifyContent: "flex-start" },
  userBubble: {
    background: "#1f6feb",
    color: "#fff",
    borderRadius: "16px 16px 4px 16px",
    padding: "10px 16px",
    fontSize: 14,
    lineHeight: 1.6,
  },
  aiBubble: {
    background: "#161b22",
    border: "1px solid #30363d",
    borderRadius: "16px 16px 16px 4px",
    padding: "12px 18px",
    fontSize: 14,
    lineHeight: 1.7,
    transition: "border-color .3s",
  },
  bubbleMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
    paddingLeft: 4,
    flexWrap: "wrap",
  },
  elapsed: { fontSize: 11, color: "#8b949e" },
  copyBtn: {
    background: "none",
    border: "none",
    fontSize: 11,
    cursor: "pointer",
    padding: "2px 6px",
    borderRadius: 4,
    transition: "color .15s",
  },
  cursor: {
    display: "inline-block",
    color: "#58a6ff",
    animation: "blink 1s infinite",
    marginLeft: 2,
  },
  typingWrap: {
    display: "flex",
    gap: 5,
    padding: "4px 2px",
    alignItems: "center",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "#58a6ff",
    display: "inline-block",
    animation: "dotBounce 1.2s infinite",
  },
  inputArea: {
    borderTop: "1px solid #30363d",
    padding: "16px 24px",
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    backgroundColor: "#161b22",
  },
  textarea: {
    flex: 1,
    background: "#0d1117",
    border: "1px solid #30363d",
    borderRadius: 8,
    color: "#cdd9e5",
    fontSize: 14,
    padding: "10px 14px",
    resize: "none",
    outline: "none",
    fontFamily: "inherit",
    lineHeight: 1.6,
    overflow: "hidden",
    transition: "height .1s ease",
  },
  sendBtn: {
    background: "#238636",
    border: "none",
    color: "#fff",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 20px",
    borderRadius: 8,
    whiteSpace: "nowrap",
    transition: "opacity .15s",
    height: 42,
  },
  stopBtn: {
    background: "transparent",
    border: "1px solid #f85149",
    color: "#f85149",
    fontWeight: 600,
    fontSize: 14,
    padding: "10px 20px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all .15s",
    height: 42,
  },
  h1: { fontSize: 18, fontWeight: 700, color: "#cdd9e5", margin: "8px 0 4px" },
  h2: { fontSize: 16, fontWeight: 700, color: "#cdd9e5", margin: "8px 0 4px" },
  h3: { fontSize: 14, fontWeight: 700, color: "#58a6ff", margin: "8px 0 4px" },
  p: { margin: "2px 0", color: "#cdd9e5" },
  listItem: {
    display: "flex",
    gap: 8,
    margin: "3px 0",
    alignItems: "flex-start",
  },
  bullet: { color: "#58a6ff", flexShrink: 0, marginTop: 1 },
  numBullet: { color: "#58a6ff", flexShrink: 0, minWidth: 20 },
  inlineCode: {
    background: "#21262d",
    border: "1px solid #30363d",
    borderRadius: 4,
    padding: "1px 5px",
    fontSize: 12,
    fontFamily: "monospace",
    color: "#ff7b72",
  },
};
