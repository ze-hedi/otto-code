import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import './WorkspacesPage.css';

function WorkspacesPage() {
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const navigate = useNavigate();
  const [mainRepo, setMainRepo] = useState('');
  const [testRepos, setTestRepos] = useState([]);
  const [openTestDropdown, setOpenTestDropdown] = useState(null); // "agents-<id>" or "orch-<id>"
  const [agents, setAgents] = useState([]);
  const [pickedAgentIds, setPickedAgentIds] = useState([]);
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  const [orchestrators, setOrchestrators] = useState([]);
  const [pickedOrchIds, setPickedOrchIds] = useState([]);
  const [orchDropdownOpen, setOrchDropdownOpen] = useState(false);
  const orchDropdownRef = useRef(null);

  useEffect(() => {
    fetch('/api/agents')
      .then(res => res.json())
      .then(data => setAgents(data))
      .catch(err => console.error('Failed to fetch agents:', err));

    fetch('/api/orchestrators')
      .then(res => res.json())
      .then(data => setOrchestrators(data))
      .catch(err => console.error('Failed to fetch orchestrators:', err));
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setAgentDropdownOpen(false);
      }
      if (orchDropdownRef.current && !orchDropdownRef.current.contains(e.target)) {
        setOrchDropdownOpen(false);
      }
      // Close test repo dropdowns if clicking outside any .agent-dropdown
      if (!e.target.closest('.agent-dropdown')) {
        setOpenTestDropdown(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const availableAgents = agents.filter(a => !pickedAgentIds.includes(a._id));
  const pickedAgents = pickedAgentIds.map(id => agents.find(a => a._id === id)).filter(Boolean);

  const addAgent = (id) => {
    setPickedAgentIds(prev => [...prev, id]);
    setAgentDropdownOpen(false);
  };

  const removeAgent = (id) => {
    setPickedAgentIds(prev => prev.filter(x => x !== id));
  };

  const availableOrchs = orchestrators.filter(o => !pickedOrchIds.includes(o._id));
  const pickedOrchs = pickedOrchIds.map(id => orchestrators.find(o => o._id === id)).filter(Boolean);

  const addOrch = (id) => {
    setPickedOrchIds(prev => [...prev, id]);
    setOrchDropdownOpen(false);
  };

  const removeOrch = (id) => {
    setPickedOrchIds(prev => prev.filter(x => x !== id));
  };

  const addTestRepo = () => {
    setTestRepos(prev => [...prev, { id: Date.now(), value: '', agentIds: [], orchIds: [] }]);
  };

  const updateTestRepo = (id, patch) => {
    setTestRepos(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  };

  const removeTestRepo = (id) => {
    setTestRepos(prev => prev.filter(r => r.id !== id));
  };

  const [errors, setErrors] = useState([]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const errs = [];
    if (!projectName.trim()) errs.push('Project name is required.');
    if (!description.trim()) errs.push('Description is required.');
    if (!mainRepo.trim()) errs.push('Main repo repository is required.');
    if (pickedAgentIds.length === 0 && pickedOrchIds.length === 0) {
      errs.push('Main repo needs at least one agent or orchestrator.');
    }
    testRepos.forEach((repo, i) => {
      if (!repo.value.trim()) errs.push(`Test repo #${i + 1}: repository is required.`);
      if (repo.agentIds.length === 0 && repo.orchIds.length === 0) {
        errs.push(`Test repo #${i + 1}: needs at least one agent or orchestrator.`);
      }
    });
    setErrors(errs);
    if (errs.length > 0) return;

    setCreating(true);
    const name = projectName.trim();

    // Build flat list of { agentId, repoPath } from all sections
    const agentEntries = [];
    pickedAgentIds.forEach(id => agentEntries.push({ agentId: id, repoPath: mainRepo.trim() }));
    testRepos.forEach(repo => {
      repo.agentIds.forEach(id => agentEntries.push({ agentId: id, repoPath: repo.value.trim() }));
    });


    // Fetch agent data + files for each unique agentId (parallel)
    const uniqueAgentIds = [...new Set(agentEntries.map(e => e.agentId))];
    const agentDataMap = {};
    try {
      await Promise.all(uniqueAgentIds.map(async (id) => {
        const [agentRes, filesRes] = await Promise.all([
          fetch(`/api/agents/${id}`),
          fetch(`/api/agents/${id}/files`),
        ]);
        const agent = await agentRes.json();
        const files = await filesRes.json();
        agentDataMap[id] = { agent, files };
      }));
    } catch (err) {
      setErrors([`Failed to fetch agent data: ${err.message}`]);
      setCreating(false);
      return;
    }

    // Start each agent on the runtime (parallel)
    const results = await Promise.allSettled(
      agentEntries.map(async (entry) => {
        const { agent, files } = agentDataMap[entry.agentId];
        const sessionId = `${name}:${entry.agentId}:${entry.index}`;
        const res = await fetch('http://localhost:5000/runtime/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: { ...agent, workingDir: entry.repoPath },
            files,
            sessionId,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || data.error || 'Runtime error');
        return { sessionId, name: agent.name, data };
      })
    );

    // TODO: same pattern for orchestrators once orchestrator run endpoint is wired

    const failures = results
      .map((r, i) => r.status === 'rejected' ? `${agentDataMap[agentEntries[i].agentId].agent.name}: ${r.reason.message}` : null)
      .filter(Boolean);

    if (failures.length > 0) {
      setErrors(failures);
      setCreating(false);
      return;
    }

    // Build project object grouped by repo
    const buildRepoAgents = (agentIds, repoPath) =>
      agentIds.map(id => {
        const { agent } = agentDataMap[id];
        const idx = agentEntries.find(e => e.agentId === id && e.repoPath === repoPath)?.index ?? 0;
        return {
          ...agent,
          sessionId: `${name}:${id}:${idx}`,
          workingDir: repoPath,
        };
      });

    // Build repo list for both DB persistence and navigation state
    const reposList = [
      {
        label: 'Main repo',
        path: mainRepo.trim(),
        agents: pickedAgentIds,
        orchestrators: pickedOrchIds,
      },
      ...testRepos.map((repo, i) => ({
        label: `Test repo #${i + 1}`,
        path: repo.value.trim(),
        agents: repo.agentIds,
        orchestrators: repo.orchIds,
      })),
    ];

    // Persist project to MongoDB
    let projectId;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: description.trim(), repos: reposList }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create project');
      projectId = data._id;
    } catch (err) {
      setErrors([`Failed to save project: ${err.message}`]);
      setCreating(false);
      return;
    }

    // Build enriched project object for navigation (with full agent data)
    const project = {
      _id: projectId,
      name,
      description: description.trim(),
      repos: [
        {
          label: 'Main repo',
          path: mainRepo.trim(),
          agents: buildRepoAgents(pickedAgentIds, mainRepo.trim()),
        },
        ...testRepos.map((repo, i) => ({
          label: `Test repo #${i + 1}`,
          path: repo.value.trim(),
          agents: buildRepoAgents(repo.agentIds, repo.value.trim()),
        })),
      ],
    };

    setCreating(false);
    navigate('/workflow', { state: { project } });
  };

  return (
    <div className="hub-container">
      <div className="hub-content">
        <h1>New Project</h1>

        <div className="hub-form">
          <div className="hub-field">
            <label htmlFor="project-name">Project Name</label>
            <input
              id="project-name"
              type="text"
              placeholder="Enter project name"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
            />
          </div>

          <div className="hub-field">
            <label htmlFor="project-description">Description</label>
            <textarea
              id="project-description"
              placeholder="Enter project description"
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          <div className="hub-section">
            <h2>Main repo</h2>
            <div className="hub-field">
              <label htmlFor="main-repo">Repository</label>
              <input
                id="main-repo"
                type="text"
                placeholder="Enter repository path or URL"
                value={mainRepo}
                onChange={e => setMainRepo(e.target.value)}
              />
            </div>
            <div className="hub-field">
              <label>Agents</label>
              <div className="agent-dropdown" ref={dropdownRef}>
                <button
                  type="button"
                  className={`agent-dropdown-trigger${agentDropdownOpen ? ' open' : ''}`}
                  onClick={() => setAgentDropdownOpen(prev => !prev)}
                >
                  <span className="agent-dropdown-placeholder">
                    {availableAgents.length ? 'Add an agent...' : 'All agents added'}
                  </span>
                  <span className="agent-dropdown-chevron" />
                </button>
                {agentDropdownOpen && availableAgents.length > 0 && (
                  <ul className="agent-dropdown-menu">
                    {availableAgents.map(agent => (
                      <li
                        key={agent._id}
                        className="agent-dropdown-item"
                        onClick={() => addAgent(agent._id)}
                      >
                        <span className="agent-dropdown-icon">{agent.icon || '🤖'}</span>
                        <div className="agent-dropdown-info">
                          <span className="agent-dropdown-name">{agent.name}</span>
                          {agent.description && (
                            <span className="agent-dropdown-desc">{agent.description}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {pickedAgents.length > 0 && (
                <div className="agent-picked-list">
                  {pickedAgents.map(agent => (
                    <div key={agent._id} className="agent-picked-chip">
                      <span className="agent-picked-icon">{agent.icon || '🤖'}</span>
                      <span className="agent-picked-name">{agent.name}</span>
                      <button
                        type="button"
                        className="agent-picked-remove"
                        onClick={() => removeAgent(agent._id)}
                        aria-label={`Remove ${agent.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="hub-field">
              <label>Orchestrators</label>
              <div className="agent-dropdown" ref={orchDropdownRef}>
                <button
                  type="button"
                  className={`agent-dropdown-trigger${orchDropdownOpen ? ' open' : ''}`}
                  onClick={() => setOrchDropdownOpen(prev => !prev)}
                >
                  <span className="agent-dropdown-placeholder">
                    {availableOrchs.length ? 'Add an orchestrator...' : 'All orchestrators added'}
                  </span>
                  <span className="agent-dropdown-chevron" />
                </button>
                {orchDropdownOpen && availableOrchs.length > 0 && (
                  <ul className="agent-dropdown-menu">
                    {availableOrchs.map(orch => (
                      <li
                        key={orch._id}
                        className="agent-dropdown-item"
                        onClick={() => addOrch(orch._id)}
                      >
                        <span className="agent-dropdown-icon">{orch.icon || '🧠'}</span>
                        <div className="agent-dropdown-info">
                          <span className="agent-dropdown-name">{orch.name}</span>
                          {orch.description && (
                            <span className="agent-dropdown-desc">{orch.description}</span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {pickedOrchs.length > 0 && (
                <div className="agent-picked-list">
                  {pickedOrchs.map(orch => (
                    <div key={orch._id} className="agent-picked-chip">
                      <span className="agent-picked-icon">{orch.icon || '🧠'}</span>
                      <span className="agent-picked-name">{orch.name}</span>
                      <button
                        type="button"
                        className="agent-picked-remove"
                        onClick={() => removeOrch(orch._id)}
                        aria-label={`Remove ${orch.name}`}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {testRepos.map(repo => {
            const repoAvailAgents = agents.filter(a => !repo.agentIds.includes(a._id));
            const repoPickedAgents = repo.agentIds.map(id => agents.find(a => a._id === id)).filter(Boolean);
            const repoAvailOrchs = orchestrators.filter(o => !repo.orchIds.includes(o._id));
            const repoPickedOrchs = repo.orchIds.map(id => orchestrators.find(o => o._id === id)).filter(Boolean);
            const agentKey = `agents-${repo.id}`;
            const orchKey = `orch-${repo.id}`;

            return (
              <div key={repo.id} className="hub-section hub-section-removable">
                <div className="hub-section-header">
                  <h2>Test repo</h2>
                  <button
                    type="button"
                    className="hub-section-remove"
                    onClick={() => removeTestRepo(repo.id)}
                    aria-label="Remove test repo"
                  >
                    &times;
                  </button>
                </div>
                <div className="hub-field">
                  <label>Repository</label>
                  <input
                    type="text"
                    placeholder="Enter repository path or URL"
                    value={repo.value}
                    onChange={e => updateTestRepo(repo.id, { value: e.target.value })}
                  />
                </div>

                <div className="hub-field">
                  <label>Agents</label>
                  <div className="agent-dropdown">
                    <button
                      type="button"
                      className={`agent-dropdown-trigger${openTestDropdown === agentKey ? ' open' : ''}`}
                      onClick={() => setOpenTestDropdown(prev => prev === agentKey ? null : agentKey)}
                    >
                      <span className="agent-dropdown-placeholder">
                        {repoAvailAgents.length ? 'Add an agent...' : 'All agents added'}
                      </span>
                      <span className="agent-dropdown-chevron" />
                    </button>
                    {openTestDropdown === agentKey && repoAvailAgents.length > 0 && (
                      <ul className="agent-dropdown-menu">
                        {repoAvailAgents.map(agent => (
                          <li
                            key={agent._id}
                            className="agent-dropdown-item"
                            onClick={() => {
                              updateTestRepo(repo.id, { agentIds: [...repo.agentIds, agent._id] });
                              setOpenTestDropdown(null);
                            }}
                          >
                            <span className="agent-dropdown-icon">{agent.icon || '🤖'}</span>
                            <div className="agent-dropdown-info">
                              <span className="agent-dropdown-name">{agent.name}</span>
                              {agent.description && (
                                <span className="agent-dropdown-desc">{agent.description}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {repoPickedAgents.length > 0 && (
                    <div className="agent-picked-list">
                      {repoPickedAgents.map(agent => (
                        <div key={agent._id} className="agent-picked-chip">
                          <span className="agent-picked-icon">{agent.icon || '🤖'}</span>
                          <span className="agent-picked-name">{agent.name}</span>
                          <button
                            type="button"
                            className="agent-picked-remove"
                            onClick={() => updateTestRepo(repo.id, { agentIds: repo.agentIds.filter(x => x !== agent._id) })}
                            aria-label={`Remove ${agent.name}`}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="hub-field">
                  <label>Orchestrators</label>
                  <div className="agent-dropdown">
                    <button
                      type="button"
                      className={`agent-dropdown-trigger${openTestDropdown === orchKey ? ' open' : ''}`}
                      onClick={() => setOpenTestDropdown(prev => prev === orchKey ? null : orchKey)}
                    >
                      <span className="agent-dropdown-placeholder">
                        {repoAvailOrchs.length ? 'Add an orchestrator...' : 'All orchestrators added'}
                      </span>
                      <span className="agent-dropdown-chevron" />
                    </button>
                    {openTestDropdown === orchKey && repoAvailOrchs.length > 0 && (
                      <ul className="agent-dropdown-menu">
                        {repoAvailOrchs.map(orch => (
                          <li
                            key={orch._id}
                            className="agent-dropdown-item"
                            onClick={() => {
                              updateTestRepo(repo.id, { orchIds: [...repo.orchIds, orch._id] });
                              setOpenTestDropdown(null);
                            }}
                          >
                            <span className="agent-dropdown-icon">{orch.icon || '🧠'}</span>
                            <div className="agent-dropdown-info">
                              <span className="agent-dropdown-name">{orch.name}</span>
                              {orch.description && (
                                <span className="agent-dropdown-desc">{orch.description}</span>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {repoPickedOrchs.length > 0 && (
                    <div className="agent-picked-list">
                      {repoPickedOrchs.map(orch => (
                        <div key={orch._id} className="agent-picked-chip">
                          <span className="agent-picked-icon">{orch.icon || '🧠'}</span>
                          <span className="agent-picked-name">{orch.name}</span>
                          <button
                            type="button"
                            className="agent-picked-remove"
                            onClick={() => updateTestRepo(repo.id, { orchIds: repo.orchIds.filter(x => x !== orch._id) })}
                            aria-label={`Remove ${orch.name}`}
                          >
                            &times;
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          <button type="button" className="hub-add-btn" onClick={addTestRepo}>
            + Add test repo
          </button>

          {errors.length > 0 && (
            <div className="hub-errors">
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}

          <button type="button" className="hub-create-btn" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default WorkspacesPage;
