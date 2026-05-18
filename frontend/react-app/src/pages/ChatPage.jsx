import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAgentChat } from '../AgentChatContext';
import SessionStatsPanel from '../components/SessionStatsPanel';
import AgentConfigPanel from '../components/AgentConfigPanel';
import SubAgentsPanel from '../components/SubAgentsPanel';
import SubAgentSessionView from '../components/SubAgentSessionView';
import CodeBrowser from '../components/CodeBrowser';
import ChatArea from '../components/ChatArea';
import './ChatPage.css';

function ChatPage() {
  const { agentId, sessionId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  // Use sessionId if available, fall back to agentId for backward compat (orchestrators, old links)
  const chatKey = sessionId || agentId;

  // Chat state from the global context (survives navigation)
  const { messages, streaming, error, sendMessage, abortAgent, hydrateFromServer, approveToolCall, rejectToolCall } = useAgentChat(chatKey);

  // Local UI state
  const [agent, setAgent] = useState(state?.agent || null);
  const [showStats, setShowStats] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showSubAgents, setShowSubAgents] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [subAgentView, setSubAgentView] = useState(null);

  const bottomRef = useRef(null);
  const agentLoggedRef = useRef(false);

  // Load agent info from DB if not passed via navigation state
  useEffect(() => {
    if (agent || !agentId) return;
    fetch(`/api/agents`)
      .then((r) => r.json())
      .then((all) => {
        const found = all.find((a) => a._id === agentId);
        if (found) {
          setAgent(found);
        } else {
          return fetch('/api/orchestrators')
            .then((r) => r.json())
            .then((orchs) => {
              const orch = orchs.find((o) => o._id === agentId);
              if (orch) setAgent({ ...orch, type: 'orchestrator' });
            });
        }
      })
      .catch(() => {});
  }, [agentId, agent]);

  // Log agent info when agent is loaded (once only)
  useEffect(() => {
    if (!agent || agentLoggedRef.current) return;
    agentLoggedRef.current = true;
  }, [agent]);

  // Hydrate messages from server if this session has an existing server-side conversation
  useEffect(() => {
    if (chatKey) hydrateFromServer();
  }, [chatKey, hydrateFromServer]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback((text) => {
    if (!text || streaming) return;
    sendMessage(text);
  }, [streaming, sendMessage]);

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={() => navigate(agent?.type === 'orchestrator' ? '/orchestrators' : '/agents')}>
          ← {agent?.type === 'orchestrator' ? 'Orchestrators' : 'Agents'}
        </button>
        <div className="chat-agent-info">
          <span className="chat-agent-name">{agent?.name ?? 'Agent'}</span>
          {agent?.model && (
            <span className="chat-agent-model">{agent.model}</span>
          )}
        </div>
        <div className="chat-status-dot" title="Active" />
        <button
          className={`chat-stats-btn${showStats ? ' active' : ''}`}
          onClick={() => { const next = !showStats; setShowStats(next); if (next) { setShowConfig(false); setShowSubAgents(false); setShowCode(false); } }}
          title="Toggle session stats"
        >
          ◈ Stats
        </button>
        <button
          className={`chat-stats-btn${showConfig ? ' active' : ''}`}
          onClick={() => { const next = !showConfig; setShowConfig(next); if (next) { setShowStats(false); setShowSubAgents(false); setShowCode(false); } }}
          title="Toggle agent config"
        >
          ⬡ Agent
        </button>
        {agent?.type === 'orchestrator' && (
          <button
            className={`chat-stats-btn${showSubAgents ? ' active' : ''}`}
            onClick={() => { const next = !showSubAgents; setShowSubAgents(next); if (next) { setShowStats(false); setShowConfig(false); setShowCode(false); } }}
            title="Toggle sub-agents"
          >
            ⊞ Sub-agents
          </button>
        )}
        {/* Code browser button hidden for now
        <button
          className={`chat-stats-btn${showCode ? ' active' : ''}`}
          onClick={() => { const next = !showCode; setShowCode(next); if (next) { setShowStats(false); setShowConfig(false); setShowSubAgents(false); } }}
          title="Browse agent workspace files"
        >
          ⟨/⟩ Code
        </button>
        */}
        <button
          className="chat-stats-btn"
          onClick={() => {
            if (agent?.type === 'orchestrator') {
              navigate(`/orch-dashboard/${agentId}/${chatKey}`);
            } else {
              navigate(`/dashboard/${agentId}/${chatKey}`);
            }
          }}
          title="Open dashboard"
        >
          ▦ Dashboard
        </button>
      </div>

      <div className="chat-body">
        {showCode && (
          <CodeBrowser agentId={chatKey} />
        )}
        {!showCode && subAgentView && (
          <SubAgentSessionView
            subAgentView={subAgentView}
            onBack={() => setSubAgentView(null)}
          />
        )}
        {!showCode && !subAgentView && (
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
        )}

        {showStats && (
          <SessionStatsPanel
            agentId={chatKey}
            onClose={() => setShowStats(false)}
          />
        )}
        {showConfig && (
          <AgentConfigPanel
            agentId={chatKey}
            onClose={() => setShowConfig(false)}
          />
        )}
        {showSubAgents && (
          <SubAgentsPanel
            agentId={chatKey}
            orchestratorId={chatKey}
            onClose={() => setShowSubAgents(false)}
            onViewSubAgent={(view) => setSubAgentView(view)}
          />
        )}
      </div>
    </div>
  );
}

export default ChatPage;
