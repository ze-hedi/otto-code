import React, { useEffect, useRef, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import './ChatPage.css';

function ChatPage() {
  const { agentId } = useParams();
  const { state } = useLocation();
  const navigate = useNavigate();

  const [agent, setAgent] = useState(state?.agent || null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const agentLoggedRef = useRef(false);

  // Load agent info from DB if not passed via navigation state
  useEffect(() => {
    if (agent || !agentId) return;
    fetch(`/api/agents`)
      .then((r) => r.json())
      .then((all) => {
        const found = all.find((a) => a._id === agentId);
        if (found) setAgent(found);
      })
      .catch(() => {});
  }, [agentId, agent]);

  // Log agent info when agent is loaded (once only)
  useEffect(() => {
    if (!agent || agentLoggedRef.current) return;
    agentLoggedRef.current = true;
    if (agent.agentType === 'claude-code') {
      console.log('[ChatPage] Claude Code Agent loaded:', {
        id: agent._id,
        name: agent.name,
        model: agent.model,
        permissionMode: agent.permissionMode,
        maxTurns: agent.maxTurns,
        allowedTools: agent.allowedTools,
        mcpServers: agent.mcpServers,
        systemPrompt: agent.systemPrompt,
      });
    } else {
      console.log('[ChatPage] Pi Agent loaded:', {
        id: agent._id,
        name: agent.name,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
        sessionMode: agent.sessionMode,
        workingDir: agent.workingDir,
        tools: agent.tools,
        status: agent.status,
      });
    }
  }, [agent]);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const appendDelta = (text) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant' && last.streaming) {
        return [...prev.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...prev, { role: 'assistant', text, streaming: true, id: Date.now() }];
    });
  };

  const finalizeAssistant = () => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last, streaming: false }];
      }
      return prev;
    });
  };

  const appendToolEvent = (event) => {
    setMessages((prev) => [
      ...prev,
      { role: 'tool', event, id: Date.now() + Math.random() },
    ]);
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', text, id: Date.now() }]);
    setStreaming(true);

    try {
      const res = await fetch(`http://localhost:5000/runtime/chat/${agentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Server error ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split('\n');
        buf = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let evt;
          try { evt = JSON.parse(raw); } catch { continue; }

          if (evt.type === 'delta') appendDelta(evt.text);
          else if (evt.type === 'tool_start') appendToolEvent(evt);
          else if (evt.type === 'tool_end') appendToolEvent(evt);
          else if (evt.type === 'done') finalizeAssistant();
          else if (evt.type === 'error') throw new Error(evt.message);
        }
      }
    } catch (err) {
      setError(err.message);
      finalizeAssistant();
    } finally {
      setStreaming(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={() => navigate('/agents')}>
          ← Agents
        </button>
        <div className="chat-agent-info">
          <span className="chat-agent-name">{agent?.name ?? 'Agent'}</span>
          {agent?.model && (
            <span className="chat-agent-model">{agent.model}</span>
          )}
        </div>
        <div className="chat-status-dot" title="Active" />
      </div>

      {/* Message list */}
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Send a message to start the conversation.</p>
          </div>
        )}
        {messages.map((msg) => {
          if (msg.role === 'user') {
            return (
              <div key={msg.id} className="chat-bubble-row user">
                <div className="chat-bubble user">{msg.text}</div>
              </div>
            );
          }
          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} className="chat-bubble-row assistant">
                <div className={`chat-bubble assistant${msg.streaming ? ' streaming' : ''}`}>
                  <pre>{msg.text}</pre>
                  {msg.streaming && <span className="cursor" />}
                </div>
              </div>
            );
          }
          if (msg.role === 'tool') {
            const { event } = msg;
            if (event.type === 'tool_start') {
              return (
                <div key={msg.id} className="chat-tool-event">
                  <span className="tool-icon">⚙</span>
                  <span>Running <code>{event.name}</code>…</span>
                </div>
              );
            }
            if (event.type === 'tool_end') {
              return (
                <div key={msg.id} className={`chat-tool-event${event.isError ? ' error' : ' done'}`}>
                  <span className="tool-icon">{event.isError ? '✕' : '✓'}</span>
                  <span><code>{event.name}</code> {event.isError ? 'failed' : 'done'}</span>
                </div>
              );
            }
          }
          return null;
        })}
        {error && (
          <div className="chat-error">Error: {error}</div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={streaming}
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
        >
          {streaming ? '…' : '↑'}
        </button>
      </div>
    </div>
  );
}

export default ChatPage;
