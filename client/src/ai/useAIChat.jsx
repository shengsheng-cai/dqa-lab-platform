// client/src/ai/useAIChat.jsx
import { useState, useRef, useEffect, useCallback } from "react";
import {
  loadChats,
  saveChats,
  createConversation,
  deleteConversation as _deleteConv,
} from "./aiStorage";

const API_BASE = "http://localhost:8000";
const TC_PREFIX =
  "[MUST reply in Traditional Chinese zh-TW ONLY, NO Simplified Chinese] ";
const MAX_HISTORY = 4;

export default function useAIChat() {
  const [store, setStore] = useState(() => loadChats());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [suggestions, setSuggestions] = useState(null);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const bottomRef = useRef(null);
  const chatAreaRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const suggestAbortRef = useRef(null);
  const streamTextRef = useRef("");
  const startTimeRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const prevSuggestionsRef = useRef(null);
  const activeIdRef = useRef(null);

  const activeId = store.activeConversationId;
  const conversations = store.conversations;
  const projectGroups = store.projectGroups;
  const messages = conversations[activeId]?.messages ?? [];

  // 同步 activeIdRef 供非同步回調使用
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    saveChats(store);
  }, [store]);

  useEffect(() => {
    const el = chatAreaRef.current;
    if (!el) return;
    const onScroll = () => {
      userScrolledUpRef.current =
        el.scrollHeight - el.scrollTop - el.clientHeight > 80;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current)
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const scrollToBottomForce = useCallback(() => {
    userScrolledUpRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const updateMessages = useCallback((newMsgs, targetId) => {
    setStore((prev) => {
      const id = targetId ?? prev.activeConversationId;
      const conv = prev.conversations[id];
      if (!conv) return prev;
      const isFirstMsg = conv.messages.length === 0 && newMsgs.length > 0;
      const title = isFirstMsg
        ? newMsgs[0].content.slice(0, 20) +
          (newMsgs[0].content.length > 20 ? "…" : "")
        : conv.title;
      return {
        ...prev,
        conversations: {
          ...prev.conversations,
          [id]: {
            ...conv,
            title,
            messages: newMsgs,
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  }, []);

  const switchConversation = useCallback(
    (id) => {
      if (loading) return;
      // 取消進行中的追問建議
      suggestAbortRef.current?.abort();
      setStore((prev) => ({ ...prev, activeConversationId: id }));
      setSuggestions(null);
      prevSuggestionsRef.current = null;
      setInput("");
    },
    [loading],
  );

  // fix: 正確解構 projectGroup 參數
  const addConversation = useCallback(({ projectGroup } = {}) => {
    const conv = createConversation({ projectGroup: projectGroup || "未分組" });
    setStore((prev) => ({
      ...prev,
      conversations: { ...prev.conversations, [conv.id]: conv },
      activeConversationId: conv.id,
    }));
    setSuggestions(null);
    prevSuggestionsRef.current = null;
    setInput("");
  }, []);

  const deleteConversation = useCallback((id) => {
    setStore((prev) => _deleteConv(prev, id));
  }, []);

  const renameConversation = useCallback((id, title) => {
    setStore((prev) => {
      const conv = prev.conversations[id];
      if (!conv) return prev;
      return {
        ...prev,
        conversations: { ...prev.conversations, [id]: { ...conv, title } },
      };
    });
  }, []);

  const setConversationGroup = useCallback((id, projectGroup) => {
    setStore((prev) => {
      const conv = prev.conversations[id];
      if (!conv) return prev;
      // 若新分組不在 projectGroups 陣列，自動補入
      const groups = prev.projectGroups.includes(projectGroup)
        ? prev.projectGroups
        : [
            ...prev.projectGroups.filter((g) => g !== "未分組"),
            projectGroup,
            "未分組",
          ];
      return {
        ...prev,
        projectGroups: groups,
        conversations: {
          ...prev.conversations,
          [id]: { ...conv, projectGroup },
        },
      };
    });
  }, []);

  const addProjectGroup = useCallback((name) => {
    setStore((prev) => ({
      ...prev,
      projectGroups: prev.projectGroups.includes(name)
        ? prev.projectGroups
        : [...prev.projectGroups.filter((g) => g !== "未分組"), name, "未分組"],
    }));
  }, []);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    const lh = 22;
    el.style.height =
      Math.min(Math.max(el.scrollHeight, lh * 3), lh * 8) + "px";
  };

  const generateSuggestions = useCallback(
    async (currentMessages, forConvId) => {
      // 取消上一輪未完成的追問請求
      suggestAbortRef.current?.abort();
      const controller = new AbortController();
      suggestAbortRef.current = controller;

      await new Promise((r) => setTimeout(r, 3000));
      if (controller.signal.aborted) return;

      setSuggestLoading(true);
      try {
        const history = currentMessages.slice(-MAX_HISTORY).map((m) => ({
          role: m.role,
          content: m.content,
        }));
        const prompt =
          TC_PREFIX +
          "根據以上對話內容，產生 3 個使用者接下來可能想追問的問題，必須與環境測試法規相關。" +
          "所有問題必須使用繁體中文，不可有任何簡體字。" +
          '只回傳 JSON 陣列，不要其他文字，格式：["問題一","問題二","問題三"]';
        const res = await fetch(`${API_BASE}/api/ai/standards-query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: prompt, history }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("建議產生失敗");
        const data = await res.json();
        const match = (data.reply ?? "").match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const next = parsed.slice(0, 3);
            // fix: 只在對話未切換的情況下更新建議
            if (activeIdRef.current === forConvId) {
              prevSuggestionsRef.current = next;
              setSuggestions(next);
            }
            return;
          }
        }
        throw new Error("解析失敗");
      } catch (err) {
        if (err.name === "AbortError") return;
        console.warn("[useAIChat] 追問建議失敗，保留上一輪", err);
        if (activeIdRef.current === forConvId) {
          setSuggestions(prevSuggestionsRef.current);
        }
      } finally {
        if (!controller.signal.aborted) setSuggestLoading(false);
      }
    },
    [],
  );

  // fix: abort 先執行，再清狀態，避免 finally 誤判
  const stopStream = useCallback(() => {
    abortControllerRef.current?.abort();
    const text = streamTextRef.current;
    const elapsed = startTimeRef.current
      ? ((Date.now() - startTimeRef.current) / 1000).toFixed(1)
      : null;
    if (text.trim()) {
      setStore((prev) => {
        const conv = prev.conversations[prev.activeConversationId];
        if (!conv) return prev;
        return {
          ...prev,
          conversations: {
            ...prev.conversations,
            [prev.activeConversationId]: {
              ...conv,
              messages: [
                ...conv.messages,
                { role: "assistant", content: text, elapsed, stopped: true },
              ],
              updatedAt: new Date().toISOString(),
            },
          },
        };
      });
    }
    setStreamText("");
    streamTextRef.current = "";
    setLoading(false);
    setSuggestLoading(false);
    abortControllerRef.current = null;
    inputRef.current?.focus();
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const rawMsg = (text !== undefined ? text : input).trim();
      if (!rawMsg || loading) return;

      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      const newMessages = [...messages, { role: "user", content: rawMsg }];
      updateMessages(newMessages);
      scrollToBottomForce();
      setLoading(true);
      setSuggestLoading(true);
      setSuggestions(null);
      setStreamText("");
      streamTextRef.current = "";
      startTimeRef.current = Date.now();

      const sendingConvId = activeIdRef.current;

      const history = newMessages
        .slice(0, -1)
        .slice(-MAX_HISTORY)
        .map((m) => ({ role: m.role, content: m.content }));
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/api/ai/standards-query-stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: TC_PREFIX + rawMsg, history }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("串流請求失敗");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          fullText += decoder.decode(value, { stream: true });
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
          updateMessages(finalMessages, sendingConvId);
          generateSuggestions(finalMessages, sendingConvId);
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          setSuggestLoading(false);
          updateMessages(
            [
              ...newMessages,
              {
                role: "assistant",
                content: "⚠️ 連線失敗，請確認後端與 Ollama 是否正常運行。",
              },
            ],
            sendingConvId,
          );
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
    [
      messages,
      input,
      loading,
      updateMessages,
      generateSuggestions,
      scrollToBottomForce,
    ],
  );

  // fix: 清除舊的 assistant 回覆後再重送
  const retryInTraditional = useCallback(
    (msgIndex) => {
      let userMsg = "";
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          userMsg = messages[i].content;
          break;
        }
      }
      if (!userMsg) return;
      // 移除從該 assistant 訊息開始之後的所有訊息
      const trimmed = messages.slice(0, msgIndex);
      updateMessages(trimmed);
      sendMessage(userMsg);
    },
    [messages, sendMessage, updateMessages],
  );

  const clearConversation = useCallback(() => {
    // 中止進行中的串流與追問
    abortControllerRef.current?.abort();
    suggestAbortRef.current?.abort();
    updateMessages([]);
    setSuggestions(null);
    prevSuggestionsRef.current = null;
    setInput("");
    setLoading(false);
    setStreamText("");
    streamTextRef.current = "";
    setSuggestLoading(false);
    inputRef.current?.focus();
  }, [updateMessages]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return {
    activeId,
    conversations,
    projectGroups,
    messages,
    input,
    loading,
    streamText,
    suggestions,
    suggestLoading,
    bottomRef,
    chatAreaRef,
    inputRef,
    textareaRef,
    switchConversation,
    addConversation,
    deleteConversation,
    renameConversation,
    setConversationGroup,
    addProjectGroup,
    sendMessage,
    stopStream,
    retryInTraditional,
    clearConversation,
    handleInputChange,
    handleKeyDown,
  };
}
