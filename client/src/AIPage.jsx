// client/src/AIPage.jsx
import { useState } from "react";
import useAIChat from "./ai/useAIChat";
import ChatSidebar from "./ai/ChatSidebar";
import ChatArea from "./ai/ChatArea";

export default function AIPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const {
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
    clearConversation,
    sendMessage,
    stopStream,
    retryInTraditional,
    handleInputChange,
    handleKeyDown,
  } = useAIChat();

  return (
    <div style={S.page}>
      <ChatSidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        conversations={conversations}
        activeId={activeId}
        projectGroups={projectGroups}
        loading={loading}
        onSwitch={switchConversation}
        onAdd={addConversation}
        onDelete={deleteConversation}
        onRename={renameConversation}
        onSetGroup={setConversationGroup}
        onAddGroup={addProjectGroup}
        onClear={clearConversation}
      />
      <ChatArea
        messages={messages}
        loading={loading}
        streamText={streamText}
        suggestions={suggestions}
        suggestLoading={suggestLoading}
        input={input}
        chatAreaRef={chatAreaRef}
        bottomRef={bottomRef}
        inputRef={inputRef}
        textareaRef={textareaRef}
        onSend={sendMessage}
        onStop={stopStream}
        onRetry={retryInTraditional}
        onInputChange={handleInputChange}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
}

const S = {
  page: {
    display: "flex",
    flex: 1,
    height: "100%",
    backgroundColor: "#0d1117",
    color: "#cdd9e5",
    fontFamily: "'Noto Sans TC', sans-serif",
    overflow: "hidden",
  },
};
