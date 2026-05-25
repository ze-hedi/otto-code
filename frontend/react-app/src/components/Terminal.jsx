import React, { useEffect, useRef, useState, useCallback } from 'react';
import ChatArea from './ChatArea';
import SessionStatsPanel from './SessionStatsPanel';
import { useAgentChat } from '../AgentChatContext';
import '../pages/ChatPage.css';

const ChatTab = ({ sessionId, onSendRef, onMessageSent }) => {
  const bottomRef = useRef(null);
  const { messages, streaming, error, sendMessage, abortAgent, approveToolCall, rejectToolCall } = useAgentChat(sessionId);

  const handleSend = useCallback((text) => {
    if (!text || streaming) return;
    sendMessage(text);
    onMessageSent?.();
  }, [streaming, sendMessage, onMessageSent]);

  // Expose sendMessage to parent via ref
  useEffect(() => {
    if (onSendRef) onSendRef.current = sendMessage;
  }, [sendMessage, onSendRef]);

  // Scroll to bottom when tab becomes visible (component mounts)
  useEffect(() => {
    bottomRef.current?.scrollIntoView();
  }, []);

  return (
    <div className="wf-terminal-chat-panel">
      <ChatArea
        messages={messages}
        streaming={streaming}
        error={error}
        onSend={handleSend}
        onAbort={abortAgent}
        onApproveToolCall={approveToolCall}
        onRejectToolCall={rejectToolCall}
        bottomRef={bottomRef}
      />
    </div>
  );
};

const AgentList = ({ chatTabs, activeTab, onSelect }) => {
  return (
    <div className="wf-agent-list">
      <div className="wf-agent-list-header">Agents</div>
      <div className="wf-agent-list-items">
        {chatTabs.map((tab) => (
          <button
            key={tab.sessionId}
            className={`wf-agent-list-item${activeTab === tab.sessionId ? ' wf-agent-list-item--active' : ''}`}
            onClick={() => onSelect(tab.sessionId)}
          >
            <span className="wf-agent-list-item-icon">⬡</span>
            <span className="wf-agent-list-item-name">{tab.agentName}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const Terminal = ({ logs, onClose, chatTabs, activeChatTab, onSwitchChatTab, onMessageSent }) => {
  const logsEndRef = useRef(null);
  const [activeTab, setActiveTab] = useState('runtime');
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Switch to latest chat tab when a new one is added
  useEffect(() => {
    if (activeChatTab) setActiveTab(activeChatTab);
  }, [activeChatTab]);

  // Hide stats when switching to runtime tab
  const handleTabSwitch = (tab) => {
    setActiveTab(tab);
    if (tab === 'runtime') setShowStats(false);
  };

  const handleAgentSelect = (sessionId) => {
    handleTabSwitch(sessionId);
    onSwitchChatTab && onSwitchChatTab(sessionId);
  };

  const isOnChatTab = activeTab !== 'runtime';

  return (
    <div className="wf-terminal">
      <div className="wf-terminal-header">
        <div className="wf-terminal-tabs">
          <button
            className={`wf-terminal-tab${activeTab === 'runtime' ? ' wf-terminal-tab--active' : ''}`}
            onClick={() => handleTabSwitch('runtime')}
          >
            Runtime
          </button>
          {chatTabs.length > 0 && (
            <button
              className={`wf-terminal-tab${isOnChatTab ? ' wf-terminal-tab--active' : ''}`}
              onClick={() => {
                const target = activeChatTab || chatTabs[0]?.sessionId;
                if (target) handleAgentSelect(target);
              }}
            >
              Agents ({chatTabs.length})
            </button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {isOnChatTab && (
            <button
              className={`chat-stats-btn${showStats ? ' active' : ''}`}
              onClick={() => setShowStats((prev) => !prev)}
              title="Toggle session stats"
            >
              ◈ Stats
            </button>
          )}
          <button className="wf-terminal-close" onClick={onClose}>×</button>
        </div>
      </div>

      {activeTab === 'runtime' && (
        <div className="wf-terminal-body">
          {logs.map((entry, i) => (
            <div key={i} className={`wf-terminal-line wf-terminal-line--${entry.type}`}>
              <span className="wf-terminal-time">{entry.timestamp}</span>
              <span className="wf-terminal-msg">{entry.message}</span>
            </div>
          ))}
          <div ref={logsEndRef} />
        </div>
      )}

      {isOnChatTab && (
        <div className="wf-terminal-split">
          <AgentList
            chatTabs={chatTabs}
            activeTab={activeTab}
            onSelect={handleAgentSelect}
          />
          <div className="wf-terminal-chat-area">
            {chatTabs.map((tab) => (
              activeTab === tab.sessionId && (
                <ChatTab key={tab.sessionId} sessionId={tab.sessionId} onMessageSent={onMessageSent} />
              )
            ))}
          </div>
        </div>
      )}

      {showStats && isOnChatTab && (
        <SessionStatsPanel
          agentId={activeTab}
          onClose={() => setShowStats(false)}
        />
      )}
    </div>
  );
};

export default Terminal;
