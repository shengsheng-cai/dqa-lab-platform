// client/src/ai/useAIChat.jsx
import { useState, useRef, useEffect, useCallback } from "react";
import {
  loadChats,
  saveChats,
  createConversation,
  deleteConversation as _deleteConv,
} from "./aiStorage";
import { API_BASE } from "../api";

const MAX_HISTORY = 4;

function getAuthHeaders() {
  const pwd = localStorage.getItem("demo_password") || "";
  return {
    "Content-Type": "application/json",
    ...(pwd ? { "X-Demo-Password": pwd } : {}),
  };
}

export default function useAIChat() {
  const [store, setStore] = useState(() => loadChats());
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");

  const bottomRef = useRef(null);
  const chatAreaRef = useRef(null);
  const inputRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const streamTextRef = useRef("");
  const startTimeRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const activeIdRef = useRef(null);

  const activeId = store.activeConversationId;
  const conversations = store.conversations;
  const projectGroups = store.projectGroups;
  const messages = conversations[activeId]?.messages ?? [];

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
  }, [messages]);

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
          headers: getAuthHeaders(),
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
          setStreamText(fullText);
        }

        if (!controller.signal.aborted && fullText.trim()) {
          const elapsed = ((Date.now() - startTimeRef.current) / 1000).toFixed(
            1,
          );
          updateMessages(
            [...newMessages, { role: "assistant", content: fullText, elapsed }],
            sendingConvId,
          );
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
        if (!controller.signal.aborted) {
          setLoading(false);
          setStreamText("");
          streamTextRef.current = "";
          abortControllerRef.current = null;
          inputRef.current?.focus();
        }
      }
    },
    [messages, input, loading, updateMessages, scrollToBottomForce],
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
      updateMessages(messages.slice(0, msgIndex));
      sendMessage(userMsg);
    },
    [messages, sendMessage, updateMessages],
  );

  const clearConversation = useCallback(() => {
    abortControllerRef.current?.abort();
    updateMessages([]);
    setInput("");
    setLoading(false);
    setStreamText("");
    streamTextRef.current = "";
    inputRef.current?.focus();
  }, [updateMessages]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
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
