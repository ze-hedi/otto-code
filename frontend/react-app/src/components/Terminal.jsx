import React, { useEffect, useRef, useState, useCallback } from 'react';
import ChatArea from './ChatArea';
import SessionStatsPanel from './SessionStatsPanel';
import { useAgentChat } from '../AgentChatContext';
import '../pages/ChatPage.css';

const ChatTab = ({ sessionId, onSendRef }) => {
  const bottomRef = useRef(null);
  const { messages, streaming, error, sendMessage, abortAgent, approveToolCall, rejectToolCall } = useAgentChat(sessionId);

  const handleSend = useCallback((text) => {
    if (!text || streaming) return;
    sendMessage(text);
  }, [streaming, sendMessage]);

  // Expose sendMessage to parent via ref
  useEffect(() => {
    if (onSendRef) onSendRef.current = sendMessage;
  }, [sendMessage, onSendRef]);

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

const Terminal = ({ logs, onClose, chatTabs, activeChatTab, onSwitchChatTab }) => {
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
          {chatTabs.map((tab) => (
            <button
              key={tab.sessionId}
              className={`wf-terminal-tab${activeTab === tab.sessionId ? ' wf-terminal-tab--active' : ''}`}
              onClick={() => { handleTabSwitch(tab.sessionId); onSwitchChatTab && onSwitchChatTab(tab.sessionId); }}
            >
              Chat ({tab.agentName})
            </button>
          ))}
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

      {chatTabs.map((tab) => (
        activeTab === tab.sessionId && (
          <ChatTab key={tab.sessionId} sessionId={tab.sessionId} />
        )
      ))}

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
