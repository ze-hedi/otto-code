import React, { useState, useEffect } from 'react';
import AgentForm from './AgentForm';

function AgentDetailPanel({ agent, availableTools, onClose, onAgentUpdated }) {
  const [loading, setLoading] = useState(true);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [icon, setIcon] = useState('🤖');
  const [selectedTools, setSelectedTools] = useState([]);
  const [model, setModel] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState('medium');
  const [sessionMode, setSessionMode] = useState('memory');
  const [workingDir, setWorkingDir] = useState('');
  const [systemPromptMode, setSystemPromptMode] = useState('write');
  const [systemPromptText, setSystemPromptText] = useState('');
  const [systemPromptFile, setSystemPromptFile] = useState(null);
  const [skills, setSkills] = useState([]);
  const [skillsDragOver, setSkillsDragOver] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!agent) return;

    // Populate scalar fields immediately from the agent object we already have
    setFormName(agent.name || '');
    setFormDescription(agent.description || '');
    setModel(agent.model || '');
    setThinkingLevel(agent.thinkingLevel || 'medium');
    setSessionMode(agent.sessionMode || 'memory');
    setWorkingDir(agent.workingDir || '');
    setIcon(agent.icon || '🤖');
    setSelectedTools(
      agent.tools ? agent.tools.map((t) => (typeof t === 'object' ? t._id : t)) : []
    );
    setApiKey('');
    setShowApiKey(false);

    // Fetch files (system prompt + skills) separately
    fetch(`http://localhost:4000/api/agents/${agent._id}/files`)
      .then((res) => (res.ok ? res.json() : []))
      .catch(() => [])
      .then((files) => {
        const soul = files.find((f) => f.type === 'soul');
        const skillsFile = files.find((f) => f.type === 'skills');
        if (soul) {
          setSystemPromptMode('upload');
          setSystemPromptFile({ name: 'system_prompt.md', content: soul.content });
        } else {
          setSystemPromptMode('write');
          setSystemPromptText('');
          setSystemPromptFile(null);
        }
        setSkills(
          skillsFile ? [{ name: 'skills.md', content: skillsFile.content, preloaded: true }] : []
        );
        setLoading(false);
      });
  }, [agent]);

  const getSystemPrompt = () => {
    if (systemPromptMode === 'write') {
      return systemPromptText.trim()
        ? { name: 'system_prompt.md', content: systemPromptText.trim() }
        : null;
    }
    return systemPromptFile || null;
  };

  const handleUpdate = async () => {
    if (!formName.trim() || !formDescription.trim() || !model) return;
    const payload = {
      name: formName,
      description: formDescription,
      model,
      thinkingLevel,
      sessionMode,
      ...(sessionMode === 'disk' || sessionMode === 'continue' ? { workingDir } : {}),
      systemPrompt: getSystemPrompt(),
      skills,
      icon,
      tools: selectedTools,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    };
    try {
      const res = await fetch(`http://localhost:4000/api/agents/${agent._id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Unexpected response: ${text.slice(0, 200)}`);
      }
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      onAgentUpdated(data);
    } catch (err) {
      alert(`Failed to update agent: ${err.message}`);
    }
  };

  const readFiles = (files) => {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setSkills((prev) => [...prev, { name: file.name, content: ev.target.result }]);
      };
      reader.readAsText(file);
    });
  };

  const handleSkillsLoad = (e) => {
    readFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const handleSkillsDrop = (e) => {
    e.preventDefault();
    setSkillsDragOver(false);
    readFiles(Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.md')));
  };

  const handleSystemPromptLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setSystemPromptFile({ name: file.name, content: ev.target.result });
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const isFormValid = formName.trim() && formDescription.trim() && model;

  return (
    <div className="wf-detail-panel">
      <div className="wf-detail-panel-header">
        <span className="wf-detail-panel-title">Agent Details</span>
        <button className="wf-detail-panel-close" onClick={onClose}>×</button>
      </div>
      <div className="wf-detail-panel-body">
        {loading ? (
          <div className="loading-spinner">
            <div className="spinner" />
            <p>Loading agent...</p>
          </div>
        ) : (
          <AgentForm
            editingAgent={agent}
            formName={formName}
            setFormName={setFormName}
            formDescription={formDescription}
            setFormDescription={setFormDescription}
            icon={icon}
            setIcon={setIcon}
            availableTools={availableTools}
            selectedTools={selectedTools}
            setSelectedTools={setSelectedTools}
            model={model}
            setModel={setModel}
            thinkingLevel={thinkingLevel}
            setThinkingLevel={setThinkingLevel}
            sessionMode={sessionMode}
            setSessionMode={setSessionMode}
            workingDir={workingDir}
            setWorkingDir={setWorkingDir}
            systemPromptMode={systemPromptMode}
            setSystemPromptMode={setSystemPromptMode}
            systemPromptText={systemPromptText}
            setSystemPromptText={setSystemPromptText}
            systemPromptFile={systemPromptFile}
            setSystemPromptFile={setSystemPromptFile}
            skills={skills}
            setSkills={setSkills}
            skillsDragOver={skillsDragOver}
            setSkillsDragOver={setSkillsDragOver}
            apiKey={apiKey}
            setApiKey={setApiKey}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            handleSystemPromptLoad={handleSystemPromptLoad}
            handleSkillsLoad={handleSkillsLoad}
            handleSkillsDrop={handleSkillsDrop}
            onCancel={onClose}
            onSubmit={handleUpdate}
            isFormValid={isFormValid}
          />
        )}
      </div>
    </div>
  );
}

export default AgentDetailPanel;
