import React, { useState, useEffect } from 'react';
import AgentForm from '../AgentForm';

/**
 * Self-contained container for the Pi agent form.
 * Owns all form state; delegates rendering to the existing AgentForm component.
 */
function PiAgentFormContainer({ editingAgent, onCreated, onUpdated, onCancel }) {
  const [formName, setFormName]             = useState(editingAgent?.name        || '');
  const [formDescription, setFormDescription] = useState(editingAgent?.description || '');
  const [model, setModel]                   = useState(editingAgent?.model        || '');
  const [thinkingLevel, setThinkingLevel]   = useState(editingAgent?.thinkingLevel || 'medium');
  const [sessionMode, setSessionMode]       = useState(editingAgent?.sessionMode  || 'memory');
  const [workingDir, setWorkingDir]         = useState(editingAgent?.workingDir   || '');
  const [playground, setPlayground]         = useState(editingAgent?.playground   || '');
  const [systemPromptMode, setSystemPromptMode] = useState('write');
  const [systemPromptText, setSystemPromptText] = useState('');
  const [systemPromptFile, setSystemPromptFile] = useState(null);
  const [skills, setSkills]                 = useState([]);
  const [skillsDragOver, setSkillsDragOver] = useState(false);
  const [icon, setIcon]                     = useState(editingAgent?.icon || '🤖');
  const [availableTools, setAvailableTools] = useState([]);
  const [selectedTools, setSelectedTools]   = useState(
    editingAgent?.tools
      ? editingAgent.tools.map((t) => (typeof t === 'object' ? t._id : t))
      : []
  );
  const [apiKey, setApiKey]       = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [compactionEnabled, setCompactionEnabled]           = useState(editingAgent?.compaction?.enabled ?? true);
  const [reserveTokens, setReserveTokens]                   = useState(editingAgent?.compaction?.reserveTokens ?? 16384);
  const [keepRecentTokens, setKeepRecentTokens]             = useState(editingAgent?.compaction?.keepRecentTokens ?? 20000);
  const [compactionInstructions, setCompactionInstructions] = useState(editingAgent?.compaction?.customInstructions ?? '');
  const [toolCallGuardrails, setToolCallGuardrails] = useState(editingAgent?.toolCallGuardrails ?? false);

  // Load available tools
  useEffect(() => {
    fetch('/api/tools')
      .then((res) => res.json())
      .then(setAvailableTools)
      .catch(() => {});
  }, []);

  // Load existing agent files when editing
  useEffect(() => {
    if (!editingAgent?._id) return;
    fetch(`/api/agents/${editingAgent._id}/files`)
      .then((res) => res.json())
      .then((files) => {
        const soul      = files.find((f) => f.type === 'soul');
        const skillsFile = files.find((f) => f.type === 'skills');
        if (soul) {
          setSystemPromptMode('upload');
          setSystemPromptFile({ name: 'system_prompt.md', content: soul.content });
        }
        if (skillsFile) {
          setSkills([{ name: 'skills.md', content: skillsFile.content, preloaded: true }]);
        }
      })
      .catch(() => {});
  }, [editingAgent]);

  const getSystemPrompt = () => {
    if (systemPromptMode === 'write') {
      return systemPromptText.trim()
        ? { name: 'system_prompt.md', content: systemPromptText.trim() }
        : null;
    }
    return systemPromptFile || null;
  };

  const buildPayload = () => ({
    name: formName,
    description: formDescription,
    model,
    thinkingLevel,
    sessionMode,
    ...(sessionMode === 'disk' || sessionMode === 'continue' ? { workingDir } : {}),
    playground,
    systemPrompt: getSystemPrompt(),
    skills,
    icon,
    tools: selectedTools,
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
    toolCallGuardrails,
    compaction: {
      enabled: compactionEnabled,
      ...(reserveTokens !== '' ? { reserveTokens: Number(reserveTokens) } : {}),
      ...(keepRecentTokens !== '' ? { keepRecentTokens: Number(keepRecentTokens) } : {}),
      ...(compactionInstructions.trim() ? { customInstructions: compactionInstructions.trim() } : {}),
    },
  });

  const apiCall = async (url, options) => {
    const res  = await fetch(url, options);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(data.error || 'Unknown error');
    return data;
  };

  const handleSubmit = async () => {
    if (!formName.trim() || !formDescription.trim() || !model) return;
    try {
      if (editingAgent) {
        const agent = await apiCall(`/api/agents/${editingAgent._id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        });
        onUpdated(agent);
      } else {
        const agent = await apiCall('/api/agents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload()),
        });
        onCreated(agent);
      }
    } catch (err) {
      alert(`Failed to save agent: ${err.message}`);
    }
  };

  const readFiles = (files) => {
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) =>
        setSkills((prev) => [...prev, { name: file.name, content: ev.target.result }]);
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
    const files = Array.from(e.dataTransfer.files).filter((f) => f.name.endsWith('.md'));
    readFiles(files);
  };

  const handleSystemPromptLoad = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) =>
      setSystemPromptFile({ name: file.name, content: ev.target.result });
    reader.readAsText(file);
    e.target.value = '';
  };

  const isFormValid = formName.trim() && formDescription.trim() && model && playground.trim();

  return (
    <AgentForm
      editingAgent={editingAgent}
      formName={formName}               setFormName={setFormName}
      formDescription={formDescription} setFormDescription={setFormDescription}
      icon={icon}                       setIcon={setIcon}
      availableTools={availableTools}
      selectedTools={selectedTools}     setSelectedTools={setSelectedTools}
      model={model}                     setModel={setModel}
      thinkingLevel={thinkingLevel}     setThinkingLevel={setThinkingLevel}
      sessionMode={sessionMode}         setSessionMode={setSessionMode}
      workingDir={workingDir}           setWorkingDir={setWorkingDir}
      playground={playground}           setPlayground={setPlayground}
      systemPromptMode={systemPromptMode}   setSystemPromptMode={setSystemPromptMode}
      systemPromptText={systemPromptText}   setSystemPromptText={setSystemPromptText}
      systemPromptFile={systemPromptFile}   setSystemPromptFile={setSystemPromptFile}
      skills={skills}                   setSkills={setSkills}
      skillsDragOver={skillsDragOver}   setSkillsDragOver={setSkillsDragOver}
      apiKey={apiKey}                   setApiKey={setApiKey}
      showApiKey={showApiKey}           setShowApiKey={setShowApiKey}
      compactionEnabled={compactionEnabled}         setCompactionEnabled={setCompactionEnabled}
      reserveTokens={reserveTokens}                 setReserveTokens={setReserveTokens}
      keepRecentTokens={keepRecentTokens}           setKeepRecentTokens={setKeepRecentTokens}
      compactionInstructions={compactionInstructions} setCompactionInstructions={setCompactionInstructions}
      toolCallGuardrails={toolCallGuardrails}       setToolCallGuardrails={setToolCallGuardrails}
      handleSystemPromptLoad={handleSystemPromptLoad}
      handleSkillsLoad={handleSkillsLoad}
      handleSkillsDrop={handleSkillsDrop}
      onCancel={onCancel}
      onSubmit={handleSubmit}
      isFormValid={isFormValid}
    />
  );
}

export default PiAgentFormContainer;
