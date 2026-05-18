import React, { useState, useCallback, useRef, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

// ── Memoized message components ────────────────────────────────────────────────

const markdownComponents = {
  code({ node, inline, className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || '');
    return !inline && match ? (
      <SyntaxHighlighter
        style={oneDark}
        language={match[1]}
        PreTag="div"
        {...props}
      >
        {String(children).replace(/\n$/, '')}
      </SyntaxHighlighter>
    ) : (
      <code className={className} {...props}>{children}</code>
    );
  },
};

const remarkPlugins = [remarkGfm];

const UserMessage = memo(function UserMessage({ msg }) {
  return (
    <div className="chat-bubble-row user">
      <div className="chat-bubble user">{msg.text}</div>
    </div>
  );
});

const ThinkingMessage = memo(function ThinkingMessage({ msg, isExpanded, onToggle }) {
  return (
    <div className="chat-bubble-row assistant">
      <div className={`chat-bubble-thinking${msg.streaming ? ' streaming' : ''}`}>
        <button
          className="thinking-header"
          onClick={onToggle}
          aria-expanded={isExpanded}
        >
          <span className="thinking-icon">{msg.streaming ? '💭' : '🧠'}</span>
          <span className="thinking-label">
            {msg.streaming ? 'Thinking…' : 'Thinking'}
          </span>
          {msg.streaming && <span className="thinking-spinner" />}
          {!msg.streaming && (
            <span className="thinking-toggle">{isExpanded ? '▲' : '▼'}</span>
          )}
        </button>
        {(isExpanded || msg.streaming) && (
          <div className="thinking-body">
            <pre className="thinking-text">{msg.text}</pre>
            {msg.streaming && <span className="cursor" />}
          </div>
        )}
      </div>
    </div>
  );
});

const AssistantMessage = memo(function AssistantMessage({ msg }) {
  return (
    <div className="chat-bubble-row assistant">
      <div className={`chat-bubble assistant${msg.streaming ? ' streaming' : ''}`}>
        <ReactMarkdown
          remarkPlugins={remarkPlugins}
          components={markdownComponents}
        >
          {msg.text}
        </ReactMarkdown>
        {msg.streaming && <span className="cursor" />}
      </div>
    </div>
  );
});

const ToolMessage = memo(function ToolMessage({
  msg,
  isExpanded,
  showFull,
  onToggleExpand,
  onShowFull,
  onApproveToolCall,
  onRejectToolCall,
}) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState('');

  const argsStr = msg.args ? JSON.stringify(msg.args, null, 2) : null;
  const resultStr = msg.result != null
    ? (typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2))
    : null;
  const resultLines = resultStr ? resultStr.split('\n') : [];
  const isTruncated = resultLines.length > 10;
  const displayResult = isTruncated && !showFull ? resultLines.slice(0, 10).join('\n') + '\n…' : resultStr;

  return (
    <div className={`chat-tool-block${msg.done ? (msg.isError ? ' error' : ' done') : ''}${msg.pendingApproval ? ' pending-approval' : ''}`}>
      <div className="chat-tool-event" onClick={onToggleExpand}>
        <span className="tool-icon">{msg.pendingApproval ? '⏸' : !msg.done ? '⚙' : msg.isError ? '✕' : '✓'}</span>
        <span>{msg.pendingApproval ? <>Approve <code>{msg.name}</code>?</> : !msg.done ? <>Running <code>{msg.name}</code>…</> : <><code>{msg.name}</code> {msg.isError ? 'failed' : 'done'}</>}</span>
        <span className={`tool-chevron${isExpanded ? ' expanded' : ''}`}>›</span>
      </div>
      {msg.pendingApproval && (
        <div className="tool-approval">
          {argsStr && (
            <div className="tool-approval-args">
              <span className="tool-details-label">Arguments</span>
              <pre>{argsStr}</pre>
            </div>
          )}
          {!isRejecting ? (
            <div className="tool-approval-actions">
              <button
                className="tool-approve-btn"
                onClick={(e) => { e.stopPropagation(); onApproveToolCall?.(msg.toolCallId); }}
              >
                Approve
              </button>
              <button
                className="tool-reject-btn"
                onClick={(e) => { e.stopPropagation(); setIsRejecting(true); setRejectComment(''); }}
              >
                Reject
              </button>
            </div>
          ) : (
            <div className="tool-reject-form">
              <textarea
                className="tool-reject-input"
                placeholder="Why are you rejecting this tool call?"
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="tool-approval-actions">
                <button
                  className="tool-reject-confirm-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRejectToolCall?.(msg.toolCallId, rejectComment);
                    setIsRejecting(false);
                    setRejectComment('');
                  }}
                >
                  Confirm Reject
                </button>
                <button
                  className="tool-reject-cancel-btn"
                  onClick={(e) => { e.stopPropagation(); setIsRejecting(false); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {isExpanded && !msg.pendingApproval && (
        <div className="tool-details">
          {argsStr && (
            <>
              <span className="tool-details-label">Input</span>
              <pre>{argsStr}</pre>
            </>
          )}
          {msg.done && resultStr && (
            <>
              <span className="tool-details-label">Output</span>
              <pre>{displayResult}</pre>
              {isTruncated && !showFull && (
                <button
                  className="tool-show-more"
                  onClick={(e) => { e.stopPropagation(); onShowFull(); }}
                >
                  Show more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
});

// ── ChatInput (owns its own state so keystrokes never re-render the message list) ──

const ChatInput = memo(function ChatInput({ streaming, onSend, onAbort }) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  const handleChange = useCallback((e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    onSend(text);
    setInput('');
    const el = textareaRef.current;
    if (el) { el.style.height = 'auto'; }
  }, [input, streaming, onSend]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  return (
    <div className="chat-input-bar">
      <textarea
        ref={textareaRef}
        className="chat-input"
        placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
        value={input}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={streaming}
      />
      {streaming ? (
        <button className="chat-stop-btn" onClick={onAbort} title="Stop agent">
          ■
        </button>
      ) : (
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim()}
        >
          ↑
        </button>
      )}
    </div>
  );
});

// ── MessageList (memoized separately from input) ───────────────────────────────

const MessageList = memo(function MessageList({
  messages,
  streaming,
  error,
  onApproveToolCall,
  onRejectToolCall,
  bottomRef,
}) {
  const [expandedThinking, setExpandedThinking] = useState({});
  const [expandedTools, setExpandedTools] = useState(new Set());
  const [fullResultTools, setFullResultTools] = useState(new Set());

  const toggleThinking = useCallback((id) => {
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const toggleTool = useCallback((id) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const showFullResult = useCallback((id) => {
    setFullResultTools((prev) => new Set(prev).add(id));
  }, []);

  return (
    <div className="chat-messages">
      {messages.length === 0 && (
        <div className="chat-empty">
          <p>Send a message to start the conversation.</p>
        </div>
      )}
      {messages.map((msg) => {
        if (msg.role === 'user') {
          return <UserMessage key={msg.id} msg={msg} />;
        }
        if (msg.role === 'thinking') {
          return (
            <ThinkingMessage
              key={msg.id}
              msg={msg}
              isExpanded={expandedThinking[msg.id] ?? false}
              onToggle={() => toggleThinking(msg.id)}
            />
          );
        }
        if (msg.role === 'assistant') {
          return <AssistantMessage key={msg.id} msg={msg} />;
        }
        if (msg.role === 'tool') {
          return (
            <ToolMessage
              key={msg.id}
              msg={msg}
              isExpanded={expandedTools.has(msg.id)}
              showFull={fullResultTools.has(msg.id)}
              onToggleExpand={() => toggleTool(msg.id)}
              onShowFull={() => showFullResult(msg.id)}
              onApproveToolCall={onApproveToolCall}
              onRejectToolCall={onRejectToolCall}
            />
          );
        }
        return null;
      })}
      {streaming && messages[messages.length - 1]?.role === 'user' && (
        <div className="chat-bubble-row assistant">
          <div className="chat-typing-indicator">
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
            <span className="chat-typing-dot" />
          </div>
        </div>
      )}
      {error && (
        <div className="chat-error">Error: {error}</div>
      )}
      <div ref={bottomRef} />
    </div>
  );
});

// ── ChatArea (thin shell — no local state, so parent re-renders are cheap) ─────

function ChatArea({
  messages,
  streaming,
  error,
  onSend,
  onAbort,
  onApproveToolCall,
  onRejectToolCall,
  bottomRef,
}) {
  return (
    <div className="chat-area">
      <MessageList
        messages={messages}
        streaming={streaming}
        error={error}
        onApproveToolCall={onApproveToolCall}
        onRejectToolCall={onRejectToolCall}
        bottomRef={bottomRef}
      />
      <ChatInput
        streaming={streaming}
        onSend={onSend}
        onAbort={onAbort}
      />
    </div>
  );
}

export default ChatArea;
