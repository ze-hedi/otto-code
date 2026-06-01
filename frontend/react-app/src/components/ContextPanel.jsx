import React, { useState, useEffect, useCallback } from 'react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';

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

const ContextPanel = ({ projectMainRepo, onClose }) => {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);

  // Fetch file list on mount
  useEffect(() => {
    setLoading(true);
    fetch(`http://localhost:5000/runtime/context/list?root=${encodeURIComponent(projectMainRepo)}`)
      .then(res => res.ok ? res.json() : { files: [] })
      .then(data => { setFiles(data.files || []); setLoading(false); })
      .catch(() => { setFiles([]); setLoading(false); });
  }, [projectMainRepo]);

  const handleFileClick = useCallback((fileName) => {
    setSelectedFile(fileName);
    setFileLoading(true);
    setDirty(false);
    setSaveError(null);
    setPreviewMode(false);
    fetch(`http://localhost:5000/runtime/context/read?root=${encodeURIComponent(projectMainRepo)}&file=${encodeURIComponent(fileName)}`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.json();
      })
      .then(data => { setFileContent(data.content); setFileLoading(false); })
      .catch(() => { setFileContent(null); setFileLoading(false); });
  }, [projectMainRepo]);

  const handleSave = useCallback(() => {
    if (!selectedFile || fileContent === null) return;
    setSaving(true);
    setSaveError(null);
    fetch(`http://localhost:5000/runtime/context/write?root=${encodeURIComponent(projectMainRepo)}&file=${encodeURIComponent(selectedFile)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: fileContent }),
    })
      .then(res => {
        if (!res.ok) throw new Error('Save failed');
        setDirty(false);
        setSaving(false);
      })
      .catch(err => { setSaveError(err.message); setSaving(false); });
  }, [projectMainRepo, selectedFile, fileContent]);

  const handleBack = useCallback(() => {
    setSelectedFile(null);
    setFileContent(null);
    setDirty(false);
    setSaveError(null);
    setPreviewMode(false);
  }, []);

  return (
    <div className="wf-detail-panel wf-detail-panel--wide">
      <div className="wf-detail-panel-header">
        {selectedFile ? (
          <>
            <button className="wf-context-back-btn" onClick={handleBack}>←</button>
            <span className="wf-detail-panel-title">
              {selectedFile}
              {dirty && <span className="wf-context-dirty"> ●</span>}
            </span>
            <div className="wf-context-mode-toggle">
              <button
                className={`wf-context-mode-btn${!previewMode ? ' wf-context-mode-btn--active' : ''}`}
                onClick={() => setPreviewMode(false)}
                title="Edit"
              >
                <i className="bi bi-pencil"></i>
              </button>
              <button
                className={`wf-context-mode-btn${previewMode ? ' wf-context-mode-btn--active' : ''}`}
                onClick={() => setPreviewMode(true)}
                title="Preview"
              >
                <i className="bi bi-eye"></i>
              </button>
            </div>
          </>
        ) : (
          <span className="wf-detail-panel-title">Context</span>
        )}
        <button className="wf-detail-panel-close" onClick={onClose}>×</button>
      </div>
      <div className="wf-detail-panel-body">
        {/* ── File list view ── */}
        {!selectedFile && (
          <>
            {loading && (
              <div className="loading-spinner"><div className="spinner"></div><p>Loading...</p></div>
            )}
            {!loading && files.length === 0 && (
              <div className="empty-state"><p>No context files found</p><small>Add .md files to the <code>context/</code> directory in your project repo.</small></div>
            )}
            {!loading && files.length > 0 && (
              <div className="wf-context-file-list">
                {files.map(f => (
                  <div
                    key={f.name}
                    className="wf-context-file-item"
                    onClick={() => handleFileClick(f.name)}
                  >
                    <span className="wf-context-file-icon">📄</span>
                    <span className="wf-context-file-name">{f.name}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── File content view ── */}
        {selectedFile && (
          <>
            {fileLoading && (
              <div className="loading-spinner"><div className="spinner"></div><p>Loading file...</p></div>
            )}
            {!fileLoading && fileContent !== null && (
              <div className="wf-context-editor-wrap">
                {previewMode ? (
                  <div className="wf-context-preview">
                    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
                      {fileContent}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <>
                    <Editor
                      height="calc(100% - 40px)"
                      language="markdown"
                      value={fileContent}
                      onChange={(val) => { setFileContent(val || ''); setDirty(true); }}
                      options={{
                        minimap: { enabled: false },
                        lineNumbers: 'on',
                        wordWrap: 'on',
                        wrappingIndent: 'same',
                        scrollBeyondLastLine: false,
                        fontSize: 13,
                        padding: { top: 8 },
                        overviewRulerLanes: 0,
                        folding: true,
                        glyphMargin: false,
                      }}
                      theme="vs-dark"
                    />
                    <div className="wf-context-save-row">
                      <button
                        className="wf-context-save-btn"
                        onClick={handleSave}
                        disabled={!dirty || saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      {saveError && <span className="wf-context-save-error">{saveError}</span>}
                    </div>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ContextPanel;
