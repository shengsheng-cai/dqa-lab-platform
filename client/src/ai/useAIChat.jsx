// client/src/ai/useAIChat.jsx
import { useState, useRef, useEffect, useCallback } from "react";
import {
  loadChats,
  saveChats,
  createConversation,
  deleteConversation as _deleteConv,
} from "./aiStorage";
import { API_BASE, buildAuthHeaders } from "../api";

const MAX_HISTORY = 4;
// Matches \n[META:{...}] — sop_ids values never contain }, so [^}]* is safe
const META_REGEX = /\n\[META:(\{[^}]*\})\]/g;
const APPLY_REGEX = /\n?\[APPLY[^\]]*\]/g;
const S_ID_REGEX = /\[S:[^\]]*\]\s*/g;
const RECOMMENDED_ID_REGEX = /\n?\[已推薦條件ID:[^\]]*\]/g;

// Extract metadata from streaming response, stripping ALL META blocks from display
function parseStreamingResponse(fullText) {
  let metadata = null;
  let displayText = fullText.replace(META_REGEX, (_, jsonStr) => {
    try {
      metadata = JSON.parse(jsonStr);
    } catch {}
    return "";
  });
  displayText = displayText.replace(APPLY_REGEX, "");
  displayText = displayText.replace(S_ID_REGEX, "");
  displayText = displayText.replace(RECOMMENDED_ID_REGEX, "");
  return { displayText, metadata };
}

export default function useAIChat() {
  const [store, setStore] = useState(() => loadChats());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [cooldownSeconds, setCooldownSeconds] = useState(0);

  const bottomRef = useRef(null);
  const chatAreaRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const streamTextRef = useRef("");
  const streamRafRef = useRef(null);
  const startTimeRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const activeIdRef = useRef(null);
  // A8: debounce timer ref
  const saveDebounceRef = useRef(null);
  const cooldownRef = useRef(null);

  const activeId = store.activeConversationId;
  const conversations = store.conversations;
  const projectGroups = store.projectGroups;
  const messages = conversations[activeId]?.messages ?? [];
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // A8 fix: saveChats 加 debounce 500ms，避免每次 store 更新都寫 localStorage
  useEffect(() => {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      saveChats(store);
    }, 500);
    return () => {
      if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    };
  }, [store]);

  // 清除 cooldown interval on unmount
  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

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
  }, [messages]);

  const scrollToBottomForce = useCallback(() => {
    userScrolledUpRef.current = false;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const startCooldown = useCallback((secs) => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldownSeconds(secs);
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current);
          cooldownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const updateMessages = useCallback((newMsgs, targetId) => {
    setStore((prev) => {
      const id = targetId ?? prev.activeConversationId;
      const conv = prev.conversations[id];
      if (!conv) return prev;
      const isFirstMsg = conv.messages.length === 0 && newMsgs.length > 0;
      const title = isFirstMsg
        ? (() => {
            const raw = newMsgs[0].content.slice(0, 30);
            const cut = raw.search(/[，。？！,?!\n]/);
            return (
              (cut > 0 && cut <= 24 ? raw.slice(0, cut) : raw.slice(0, 20)) +
              (newMsgs[0].content.length > 20 ? "…" : "")
            );
          })()
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
      setStore((prev) => ({ ...prev, activeConversationId: id }));
      setInput("");
    },
    [loading],
  );

  const addConversation = useCallback(({ projectGroup } = {}) => {
    const conv = createConversation({ projectGroup: projectGroup || "未分組" });
    setStore((prev) => ({
      ...prev,
      conversations: { ...prev.conversations, [conv.id]: conv },
      activeConversationId: conv.id,
    }));
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

  const handleInputChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    const lh = 22;
    el.style.height =
      Math.min(Math.max(el.scrollHeight, lh * 3), lh * 8) + "px";
  }, []);

  // A5 fix: stopStream 移除 focus()，統一由 finally 處理
  const stopStream = useCallback(() => {
    if (streamRafRef.current) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
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
    abortControllerRef.current = null;
  }, []);

  const sendMessage = useCallback(
    async (text) => {
      const currentMessages = messagesRef.current;
      const rawMsg = (text !== undefined ? text : input).trim();
      if (!rawMsg || loading || cooldownSeconds > 0) return;

      setInput("");
      if (textareaRef.current) textareaRef.current.style.height = "auto";

      const newMessages = [
        ...currentMessages,
        { role: "user", content: rawMsg },
      ];
      updateMessages(newMessages);
      scrollToBottomForce();
      setLoading(true);
      setStreamText("");
      streamTextRef.current = "";
      startTimeRef.current = Date.now();

      const sendingConvId = activeIdRef.current;
      const history = newMessages
        .slice(0, -1)
        .slice(-MAX_HISTORY)
        .map((m) => ({
          role: m.role,
          content: m.role === "assistant" && m.sop_ids?.length
            ? m.content + `\n[已推薦條件ID:${m.sop_ids.join(",")}]`
            : m.content,
        }));
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await fetch(`${API_BASE}/api/ai/standards-query-stream`, {
          method: "POST",
          headers: buildAuthHeaders(),
          body: JSON.stringify({ message: rawMsg, history }),
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
          if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = requestAnimationFrame(() => {
            const t = streamTextRef.current;
            const { displayText } = parseStreamingResponse(t);
            setStreamText(displayText);
          });
        }
        if (streamRafRef.current) {
          cancelAnimationFrame(streamRafRef.current);
          streamRafRef.current = null;
        }

        if (!controller.signal.aborted && fullText.trim()) {
          const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
          const { displayText, metadata } = parseStreamingResponse(fullText);
          const sop_ids = metadata?.sop_ids || [];
          updateMessages(
            [...newMessages, { role: "assistant", content: displayText, elapsed, sop_ids }],
            sendingConvId,
          );

          // 解析 429 等待秒數，啟動冷卻鎖
          const waitMatch = displayText.match(/請稍候\s*(\d+)\s*秒/);
          if (waitMatch) {
            startCooldown(parseInt(waitMatch[1]));
          }
        }
      } catch (err) {
        if (err.name !== "AbortError") {
          updateMessages(
            [
              ...newMessages,
              {
                role: "assistant",
                content: "⚠️ 連線失敗，請確認後端是否正常運行。",
              },
            ],
            sendingConvId,
          );
        }
      } finally {
        setLoading(false);
        setStreamText("");
        streamTextRef.current = "";
        abortControllerRef.current = null;
        if (!controller.signal.aborted) {
          inputRef.current?.focus();
        }
      }
    },
    [input, loading, cooldownSeconds, updateMessages, scrollToBottomForce, startCooldown],
  );

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
      const slicedMessages = messages.slice(0, msgIndex);
      messagesRef.current = slicedMessages;
      updateMessages(slicedMessages);
      sendMessage(userMsg);
    },
    [messages, sendMessage, updateMessages],
  );

  const clearConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    updateMessages([]);
    setInput("");
    setLoading(false);
    setStreamText("");
    streamTextRef.current = "";
    inputRef.current?.focus();
  }, [updateMessages]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        sendMessage();
      }
    },
    [sendMessage],
  );

  return {
    activeId,
    conversations,
    projectGroups,
    messages,
    input,
    loading,
    streamText,
    cooldownSeconds,
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