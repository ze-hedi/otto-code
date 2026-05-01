import React, { useRef } from 'react';

const Header = ({
  connectionMode,
  canUndo,
  onToggleConnectionMode,
  onUndo,
  onExport,
  onImport,
  onClear
}) => {
  const uploadInputRef = useRef(null);

  const handleUploadClick = () => {
    uploadInputRef.current.value = '';
    uploadInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.json') && file.type !== 'application/json') {
      alert('Please select a valid JSON file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      let parsed;
      try {
        parsed = JSON.parse(evt.target.result);
      } catch {
        alert('Invalid JSON: the file could not be parsed. Please check the file contents.');
        return;
      }
      onImport(parsed);
    };
    reader.readAsText(file);
  };

  return (
    <header className="wf-topbar">
      <a href="index.html" className="brand">
        <i className="bi bi-robot"></i>
        <span>Otto</span>
      </a>
      <span className="badge-page">Workflow Builder</span>

      <div className="topbar-actions">
        <button
          className={`tb-btn ${connectionMode ? 'connect-active' : ''}`}
          onClick={onToggleConnectionMode}
          title="Toggle connection mode (drag between node handles)"
        >
          <i className="bi bi-bezier2"></i>
          <span>{connectionMode ? 'Exit Connect' : 'Connect'}</span>
        </button>
        
        <button
          className="tb-btn"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo last action (Ctrl+Z)"
        >
          <i className="bi bi-arrow-counterclockwise"></i>
          <span>Undo</span>
        </button>
        
        <button
          className="tb-btn"
          onClick={onExport}
          disabled
          title="Export feature is currently disabled"
        >
          <i className="bi bi-download"></i>
          <span>Export</span>
        </button>
        
        <button
          className="tb-btn"
          onClick={handleUploadClick}
          disabled
          title="Upload feature is currently disabled"
        >
          <i className="bi bi-upload"></i>
          <span>Upload</span>
        </button>
        
        <input
          ref={uploadInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        
        <button
          className="tb-btn"
          onClick={onClear}
          title="Clear canvas"
        >
          <i className="bi bi-trash3"></i>
          <span>Clear</span>
        </button>
      </div>
    </header>
  );
};

export default Header;
