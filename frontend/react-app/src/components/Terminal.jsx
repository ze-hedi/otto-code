import React, { useEffect, useRef, useState, useCallback } from 'react';
import ChatArea from './ChatArea';
import { useAgentChat } from '../AgentChatContext';
import '../pages/ChatPage.css';

const Terminal = ({ logs, onClose, activeAgent, sessionId }) => {
  const logsEndRef = useRef(null);
  const bottomRef = useRef(null);
  const [activeTab, setActiveTab] = useState('runtime');

  const { messages, streaming, error, sendMessage, abortAgent, approveToolCall, rejectToolCall } = useAgentChat(sessionId);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Switch to chat tab when activeAgent becomes available
  useEffect(() => {
    if (activeAgent) setActiveTab('chat');
  }, [activeAgent]);

  const handleSend = useCallback((text) => {
    if (!text || streaming) return;
    sendMessage(text);
  }, [streaming, sendMessage]);

  return (
    <div className="wf-terminal">
      <div className="wf-terminal-header">
        <div className="wf-terminal-tabs">
          <button
            className={`wf-terminal-tab${activeTab === 'runtime' ? ' wf-terminal-tab--active' : ''}`}
            onClick={() => setActiveTab('runtime')}
          >
            Runtime
          </button>
          {activeAgent && (
            <button
              className={`wf-terminal-tab${activeTab === 'chat' ? ' wf-terminal-tab--active' : ''}`}
              onClick={() => setActiveTab('chat')}
            >
              Chat
            </button>
          )}
        </div>
        <button className="wf-terminal-close" onClick={onClose}>×</button>
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

      {activeTab === 'chat' && activeAgent && (
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
      )}
    </div>
  );
};

export default Terminal;
