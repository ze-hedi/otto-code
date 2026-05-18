import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

function ChatArea({
  messages,
  streaming,
  error,
  input,
  onInputChange,
  onKeyDown,
  onSend,
  onAbort,
  onApproveToolCall,
  onRejectToolCall,
  bottomRef,
  textareaRef,
}) {
  const [expandedThinking, setExpandedThinking] = useState({});
  const [expandedTools, setExpandedTools] = useState(new Set());
  const [fullResultTools, setFullResultTools] = useState(new Set());
  const [rejectingToolId, setRejectingToolId] = useState(null);
  const [rejectComment, setRejectComment] = useState('');

  const toggleThinking = useCallback((id) => {
    setExpandedThinking((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="chat-area">
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
          if (msg.role === 'thinking') {
            const isExpanded = expandedThinking[msg.id] ?? false;
            return (
              <div key={msg.id} className="chat-bubble-row assistant">
                <div className={`chat-bubble-thinking${msg.streaming ? ' streaming' : ''}`}>
                  <button
                    className="thinking-header"
                    onClick={() => toggleThinking(msg.id)}
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
          }
          if (msg.role === 'assistant') {
            return (
              <div key={msg.id} className="chat-bubble-row assistant">
                <div className={`chat-bubble assistant${msg.streaming ? ' streaming' : ''}`}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
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
                    }}
                  >
                    {msg.text}
                  </ReactMarkdown>
                  {msg.streaming && <span className="cursor" />}
                </div>
              </div>
            );
          }
          if (msg.role === 'tool') {
            const isExpanded = expandedTools.has(msg.id);
            const showFull = fullResultTools.has(msg.id);
            const argsStr = msg.args ? JSON.stringify(msg.args, null, 2) : null;
            const resultStr = msg.result != null
              ? (typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result, null, 2))
              : null;
            const resultLines = resultStr ? resultStr.split('\n') : [];
            const isTruncated = resultLines.length > 10;
            const displayResult = isTruncated && !showFull ? resultLines.slice(0, 10).join('\n') + '\n…' : resultStr;
            const isRejecting = rejectingToolId === msg.id;

            return (
              <div key={msg.id} className={`chat-tool-block${msg.done ? (msg.isError ? ' error' : ' done') : ''}${msg.pendingApproval ? ' pending-approval' : ''}`}>
                <div
                  className="chat-tool-event"
                  onClick={() => setExpandedTools((prev) => {
                    const next = new Set(prev);
                    next.has(msg.id) ? next.delete(msg.id) : next.add(msg.id);
                    return next;
                  })}
                >
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
                          onClick={(e) => { e.stopPropagation(); setRejectingToolId(msg.id); setRejectComment(''); }}
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
                              setRejectingToolId(null);
                              setRejectComment('');
                            }}
                          >
                            Confirm Reject
                          </button>
                          <button
                            className="tool-reject-cancel-btn"
                            onClick={(e) => { e.stopPropagation(); setRejectingToolId(null); }}
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
                            onClick={(e) => { e.stopPropagation(); setFullResultTools((prev) => new Set(prev).add(msg.id)); }}
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

      {/* Input bar */}
      <div className="chat-input-bar">
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder="Send a message… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={onInputChange}
          onKeyDown={onKeyDown}
          disabled={streaming}
        />
        {streaming ? (
          <button className="chat-stop-btn" onClick={onAbort} title="Stop agent">
            ■
          </button>
        ) : (
          <button
            className="chat-send-btn"
            onClick={onSend}
            disabled={!input.trim()}
          >
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatArea;
