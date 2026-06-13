import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Canvas from './components/Canvas';
import AgentDetailPanel from './components/AgentDetailPanel';
import ToolDetailPanel from './components/ToolDetailPanel';
import PiAgentFormContainer from './components/agents/PiAgentFormContainer';
import ContextPanel from './components/ContextPanel';
import ScrumRoomPanel from './components/ScrumRoomPanel';
import Terminal from './components/Terminal';
import { createSession, sendMessage } from './AgentChatContext';
import { generateNodeId, NODE_DEFAULT_SIDES } from './utils';
import './WorkflowBuilder.css';

const WorkflowBuilder = () => {
  const location = useLocation();
  const [projectRepos, setProjectRepos] = useState(location.state?.project?.repos || null);
  const projectId = location.state?.project?._id || null;
  const projectName = location.state?.project?.name || null;
  const projectMainRepo = projectRepos?.[0]?.path || null;
  const [nodes, setNodes] = useState([]);
  const [connections, setConnections] = useState([]);
  const [connectionMode, setConnectionMode] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [history, setHistory] = useState([]);
  const [deleteConnBtnPos, setDeleteConnBtnPos] = useState(null);
  const [agents, setAgents] = useState([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState(null);
  const [tools, setTools] = useState([]);
  const [loadingTools, setLoadingTools] = useState(true);
  const [toolsError, setToolsError] = useState(null);
  const [selectedToolId, setSelectedToolId] = useState(null);
  const [interfaces, setInterfaces] = useState([]);
  const [loadingInterfaces, setLoadingInterfaces] = useState(true);
  const [interfacesError, setInterfacesError] = useState(null);
  const [orchestrators, setOrchestrators] = useState([]);
  const [loadingOrchestrators, setLoadingOrchestrators] = useState(true);
  const [orchestratorsError, setOrchestratorsError] = useState(null);
  const [selectedAgentId, setSelectedAgentId] = useState(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [creatingPiAgent, setCreatingPiAgent] = useState(false);
  const [createAgentRepoIndex, setCreateAgentRepoIndex] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [activeSessionAgent, setActiveSessionAgent] = useState(null);
  const [workflowSessionId, setWorkflowSessionId] = useState(null);
  const [hookPopup, setHookPopup] = useState(null);
  const [selectedScrumRoomNodeId, setSelectedScrumRoomNodeId] = useState(null);
  const [hookProgress, setHookProgress] = useState(null); // { interfaceName, received, expected }
  const [chatTabs, setChatTabs] = useState([]);
  const [activeChatTab, setActiveChatTab] = useState(null);
  const draggedType = useRef(null);
  const snapshotRef = useRef({ nodes, connections });
  const agentsRef   = useRef(agents);

  useEffect(() => {
    snapshotRef.current = { nodes, connections };
  }, [nodes, connections]);

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  // Subscribe to workflow hook events via SSE
  useEffect(() => {
    if (!workflowSessionId) return;
    const es = new EventSource('http://localhost:5000/runtime/workflow/events');
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'hook_partial') {
          setHookProgress({ interfaceName: data.interfaceName, received: data.received, expected: data.expected, latestAgent: data.latestAgent });
        } else if (data.type === 'hook_fired') {
          setHookProgress(null);
          setHookPopup(data);
        }
      } catch {}
    };
    return () => es.close();
  }, [workflowSessionId]);

  // Touch workflow to update lastInteractedAt
  const touchWorkflow = useCallback(() => {
    if (!workflowSessionId) return;
    const baseId = workflowSessionId.includes('::') ? workflowSessionId.split('::')[0] : workflowSessionId;
    fetch(`http://localhost:5000/runtime/workflows/${baseId}/touch`, { method: 'PATCH' }).catch(() => {});
  }, [workflowSessionId]);

  const handleAcceptHook = () => {
    console.log('[workflow] handleAcceptHook fired, hookPopup:', JSON.stringify(hookPopup));
    if (!hookPopup || !hookPopup.nextAgents?.length) {
      console.log('[workflow] No nextAgents found, closing popup');
      setHookPopup(null);
      return;
    }

    const { nextAgents, toolName } = hookPopup;
    const isMerged = Array.isArray(hookPopup.entries);

    // --- Build context message(s) depending on single vs merged ---

    let contextMessageBuilder;

    if (isMerged) {
      // Multi-entry: merge all entries into one context message per next agent
      const mergedSections = hookPopup.entries.map((entry) => {
        const argsText = Object.entries(entry.args || {})
          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
          .join('\n');
        return `[From agent "${entry.agentName}" via "${toolName}"]\n${argsText}`;
      }).join('\n\n---\n\n');
      const mergedMessage = `[Merged briefing from ${hookPopup.entries.length} agents]\n\n${mergedSections}`;
      contextMessageBuilder = () => mergedMessage;
    } else {
      // Single-entry: existing behavior
      const { args, agentName: sourceAgent } = hookPopup;
      const isDelegation = toolName === 'submit_delegate';
      const delegations = isDelegation ? (args?.delegations || []) : [];

      const delegationByAgent = {};
      for (const d of delegations) {
        delegationByAgent[d.agentName] = d;
      }

      const fallbackArgsText = Object.entries(args || {})
        .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
        .join('\n');
      const fallbackMessage = `[Delegation from agent "${sourceAgent}" via "${toolName}"]\n\n${fallbackArgsText}`;

      contextMessageBuilder = (nextAgentName) => {
        const delegation = delegationByAgent[nextAgentName];
        if (isDelegation && delegation) {
          const specs = delegation.referenceSpecs?.length
            ? `\nReference Specs:\n${delegation.referenceSpecs.map((s) => `  - ${s}`).join('\n')}`
            : '';
          return (
            `[Delegation from agent "${sourceAgent}"]\n\n` +
            `Goal: ${args.goal}\n` +
            `Task: ${delegation.task}\n` +
            `Context: ${delegation.context}\n` +
            `Expected Output: ${delegation.expectedOutput}\n` +
            `Priority: ${delegation.priority}` +
            specs
          );
        }
        return fallbackMessage;
      };
    }

    const newTabs = [];

    for (const next of nextAgents) {
      const { name, compositeKey } = next;
      console.log('[workflow] Accept hook → next agent:', name, 'key:', compositeKey);

      createSession(name, compositeKey, name);
      newTabs.push({ agentName: name, sessionId: compositeKey });

      const contextMessage = contextMessageBuilder(name);
      sendMessage(compositeKey, contextMessage);
    }

    // Add all new tabs at once
    setChatTabs((prev) => {
      const existing = new Set(prev.map((t) => t.sessionId));
      const toAdd = newTabs.filter((t) => !existing.has(t.sessionId));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });

    // Switch to the first new agent tab
    setActiveChatTab(newTabs[0].sessionId);
    setActiveSessionAgent(newTabs[0].agentName);

    touchWorkflow();
    setHookPopup(null);
  };

  const saveSnapshot = useCallback(() => {
    setHistory(prev => [...prev, { nodes: snapshotRef.current.nodes, connections: snapshotRef.current.connections }]);
  }, []);

  // Fetch agents: use project agents in project mode, otherwise fetch from DB
  useEffect(() => {
    if (projectRepos) {
      const projectAgents = projectRepos.flatMap(r => r.agents);
      setAgents(projectAgents);
      setLoadingAgents(false);
      return;
    }
    setLoadingAgents(true);
    fetch('http://localhost:4000/api/agents')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch agents');
        return res.json();
      })
      .then(data => {
        setAgents(data);
        setLoadingAgents(false);
      })
      .catch(err => {
        console.error('Error fetching agents:', err);
        setAgentsError(err.message);
        setLoadingAgents(false);
      });
  }, [projectRepos]);

  // Auto-load workflow from project repo on mount
  useEffect(() => {
    if (!projectMainRepo || !projectName) return;
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = `${projectMainRepo}/workflows/${safeName}.json`;
    fetch(`http://localhost:5000/runtime/workflow/load?filePath=${encodeURIComponent(filePath)}`)
      .then(res => {
        if (!res.ok) return null;
        return res.json();
      })
      .then(data => {
        if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.connections)) return;
        const importedNodes = data.nodes.map((n) => {
          const base = { id: n.id, type: n.type, x: n.x, y: n.y };
          if (n.type === 'agent') return { ...base, agentId: n.agentId, agentName: n.name, agentIcon: n.icon || '🤖', sessionId: n.sessionId, workingDir: n.workingDir };
          if (n.type === 'orchestrator') return { ...base, orchestratorId: n.orchestratorId, orchestratorName: n.name, orchestratorIcon: n.icon || '🧠' };
          if (n.type === 'tool') return { ...base, toolId: n.toolId, toolName: n.name, toolIcon: n.icon || '🔧', isMcp: n.isMcp || false };
          if (n.type === 'artefact') return { ...base, artefactType: n.artefactType, label: n.name, icon: n.icon };
          return base;
        });
        setNodes(importedNodes);
        setConnections(data.connections);
      })
      .catch(() => {}); // Silently ignore — no saved workflow yet
  }, [projectMainRepo, projectName]);

  // Fetch MCP tools from gateway on mount
  useEffect(() => {
    setLoadingTools(true);
    fetch('http://localhost:5000/runtime/mcp-tools')
      .then(res => {
        if (!res.ok) throw new Error('MCP gateway unavailable');
        return res.json();
      })
      .then(data => {
        const mapped = data.map(t => ({
          _id: `mcp_${t.name}`,
          name: t.name,
          description: t.description,
          icon: '🌐',
          isMcp: true,
          inputSchema: t.inputSchema,
        }));
        setTools(mapped);
        setLoadingTools(false);
      })
      .catch(err => {
        console.error('MCP tools unavailable:', err.message);
        setTools([]);
        setToolsError(err.message);
        setLoadingTools(false);
      });
  }, []);

  // Fetch interfaces from database on mount
  useEffect(() => {
    setLoadingInterfaces(true);
    fetch('http://localhost:4000/api/interfaces')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch interfaces');
        return res.json();
      })
      .then(data => {
        const scrumRoom = { _id: 'scrum-room', name: 'Scrum Room', icon: '🏉', description: 'A collaborative scrum room interface for team coordination' };
        setInterfaces([scrumRoom, ...data]);
        setLoadingInterfaces(false);
      })
      .catch(err => {
        setInterfacesError(err.message);
        setLoadingInterfaces(false);
      });
  }, []);

  // Fetch orchestrators from database on mount
  useEffect(() => {
    setLoadingOrchestrators(true);
    fetch('http://localhost:4000/api/orchestrators')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch orchestrators');
        return res.json();
      })
      .then(data => {
        setOrchestrators(data);
        setLoadingOrchestrators(false);
      })
      .catch(err => {
        setOrchestratorsError(err.message);
        setLoadingOrchestrators(false);
      });
  }, []);

  // Close detail panels on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        closeAllPanels();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Add an agent from DB to a project repo
  const handleAddAgentToRepo = useCallback((agent, repoIndex) => {
    if (!projectRepos) return;
    const repo = projectRepos[repoIndex];
    const existingCount = repo.agents.filter(a => a._id === agent._id).length;
    const enrichedAgent = {
      ...agent,
      sessionId: `${projectName}:${agent._id}:${existingCount}`,
      workingDir: repo.path,
      playground: repo.path,
    };
    const updatedRepos = projectRepos.map((r, i) =>
      i === repoIndex ? { ...r, agents: [...r.agents, enrichedAgent] } : r
    );
    setProjectRepos(updatedRepos);
    setAgents(prev => {
      if (prev.some(a => a._id === agent._id)) return prev;
      return [...prev, enrichedAgent];
    });

    // Persist to MongoDB
    if (projectId) {
      const dbRepos = updatedRepos.map(r => ({
        label: r.label,
        path: r.path,
        agents: r.agents.map(a => a._id),
        orchestrators: (r.orchestrators || []).map(o => o._id || o),
      }));
      fetch(`/api/projects/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repos: dbRepos }),
      }).catch(err => console.error('Failed to update project:', err));
    }
  }, [projectRepos, projectName, projectId]);

  // Sync updated agent back to sidebar list and canvas nodes
  const handleAgentUpdated = useCallback((updatedAgent) => {
    setAgents((prev) => prev.map((a) => (a._id === updatedAgent._id ? updatedAgent : a)));
    setNodes((prev) =>
      prev.map((n) =>
        n.agentId === updatedAgent._id
          ? { ...n, agentName: updatedAgent.name, agentIcon: updatedAgent.icon || '🤖' }
          : n
      )
    );
  }, []);

  // Close all right-side panels
  const closeAllPanels = useCallback(() => {
    setSelectedAgentId(null);
    setSelectedToolId(null);
    setCreatingPiAgent(false);
    setContextPanelOpen(false);
    setSelectedScrumRoomNodeId(null);
  }, []);

  // Open empty PI agent creation form in the right panel
  const handleBuildPiAgent = useCallback(() => {
    closeAllPanels();
    setCreatingPiAgent(true);
  }, [closeAllPanels]);

  // Handle newly created PI agent — append to sidebar list and close panel
  const handlePiAgentCreated = useCallback((newAgent) => {
    if (createAgentRepoIndex !== null && projectRepos) {
      handleAddAgentToRepo(newAgent, createAgentRepoIndex);
      setCreateAgentRepoIndex(null);
    } else {
      setAgents((prev) => [...prev, newAgent]);
    }
    setCreatingPiAgent(false);
  }, [createAgentRepoIndex, projectRepos, handleAddAgentToRepo]);


  // Persist a tool-link add/remove to the agent's DB record
  const syncToolLink = useCallback((agentNode, toolNode, action) => {
    const agent = agentsRef.current.find((a) => a._id === agentNode.agentId);
    if (!agent || !toolNode.toolId) return;

    const currentTools = (agent.tools || []).map((t) => (typeof t === 'object' ? t._id : t));
    const newTools =
      action === 'add'
        ? [...new Set([...currentTools, toolNode.toolId])]
        : currentTools.filter((id) => id !== toolNode.toolId);

    fetch(`http://localhost:4000/api/agents/${agent._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...agent, tools: newTools }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((updated) => {
        setAgents((prev) => prev.map((a) => (a._id === updated._id ? updated : a)));
      })
      .catch(() => console.error(`Failed to ${action} tool link in DB`));
  }, []);

  // Sidebar drag start
  const handleSidebarDragStart = useCallback((agent) => {
    draggedType.current = agent;
  }, []);

  // Canvas drop - create new node
  const handleDrop = useCallback((data, x, y) => {
    let newNode;

    if (data.nodeType === 'artefact') {
      newNode = {
        id: generateNodeId(),
        type: 'artefact',
        artefactType: data.artefactType,
        label: data.label,
        icon: data.artefactIcon,
        x: x - 55,
        y: y - 40,
      };
    } else if (data.nodeType === 'tool') {
      newNode = {
        id: generateNodeId(),
        type: 'tool',
        toolId: data.toolId,
        toolName: data.toolName,
        toolIcon: data.toolIcon,
        isMcp: data.isMcp || false,
        x: x - 55,
        y: y - 40,
      };
    } else if (data.nodeType === 'orchestrator') {
      newNode = {
        id: generateNodeId(),
        type: 'orchestrator',
        orchestratorId: data.orchestratorId,
        orchestratorName: data.orchestratorName,
        orchestratorIcon: data.orchestratorIcon || '🧠',
        x: x - 55,
        y: y - 40,
      };
    } else {
      if (!data.agentId || !data.agentName) {
        draggedType.current = null;
        return;
      }
      newNode = {
        id: generateNodeId(),
        type: 'agent',
        agentId: data.agentId,
        agentName: data.agentName,
        agentIcon: data.agentIcon || '🤖',
        ...(data.sessionId ? { sessionId: data.sessionId } : {}),
        ...(data.workingDir ? { workingDir: data.workingDir } : {}),
        x: x - 55,
        y: y - 40,
      };
    }

    saveSnapshot();
    setNodes((prev) => [...prev, newNode]);
    draggedType.current = null;
  }, [saveSnapshot]);

  // Node drag move
  const handleNodeDragMove = useCallback((nodeId, newLeft, newTop) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId
          ? { ...node, x: Math.max(0, newLeft), y: Math.max(0, newTop) }
          : node
      )
    );
  }, []);

  // Save snapshot before node drag starts (called on first mouse move)
  const handleNodeDragStart = useCallback(() => {
    saveSnapshot();
  }, [saveSnapshot]);

  // Delete node
  const handleDeleteNode = useCallback((nodeId) => {
    saveSnapshot();
    // Sync any tool-links being implicitly removed before wiping them
    const { nodes: currentNodes, connections: currentConns } = snapshotRef.current;
    currentConns.forEach((conn) => {
      if ((conn.from === nodeId || conn.to === nodeId) && conn.linkType === 'tool-link') {
        const fromNode = currentNodes.find((n) => n.id === conn.from);
        const toNode   = currentNodes.find((n) => n.id === conn.to);
        if (fromNode && toNode) {
          const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
          syncToolLink(agentNode, toolNode, 'remove');
        }
      }
    });
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setConnections((prev) => prev.filter((c) => c.from !== nodeId && c.to !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [saveSnapshot, selectedNodeId, syncToolLink]);

  // Node click — connection mode: wire nodes; normal mode: open detail panel
  const handleNodeClick = useCallback((nodeId) => {
    if (!connectionMode) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.type === 'agent') {
        closeAllPanels();
        setSelectedAgentId(node.agentId);
      } else if (node?.type === 'artefact' && node.artefactType === 'scrum-room') {
        closeAllPanels();
        setSelectedScrumRoomNodeId(node.id);
      }
      return;
    }

    if (selectedNodeId && selectedNodeId !== nodeId) {
      const fromNode = nodes.find(n => n.id === selectedNodeId);
      const toNode   = nodes.find(n => n.id === nodeId);
      const fromSide = (NODE_DEFAULT_SIDES[fromNode?.type] ?? NODE_DEFAULT_SIDES.agent).from;
      const toSide   = (NODE_DEFAULT_SIDES[toNode?.type]   ?? NODE_DEFAULT_SIDES.agent).to;

      const isToolLink =
        (fromNode?.type === 'agent' && toNode?.type === 'tool') ||
        (fromNode?.type === 'tool'  && toNode?.type === 'agent');

      const newConn = {
        from: selectedNodeId,
        fromSide,
        to: nodeId,
        toSide,
        ...(isToolLink ? { linkType: 'tool-link' } : {}),
      };

      const exists = connections.some(
        (c) =>
          c.from === newConn.from &&
          c.fromSide === newConn.fromSide &&
          c.to === newConn.to &&
          c.toSide === newConn.toSide
      );

      if (!exists) {
        saveSnapshot();
        setConnections((prev) => [...prev, newConn]);
        if (isToolLink) {
          const agentNode = fromNode?.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode?.type === 'tool'  ? fromNode : toNode;
          syncToolLink(agentNode, toolNode, 'add');
        }
      }

      setSelectedNodeId(null);
    } else {
      setSelectedNodeId(nodeId);
    }
  }, [connectionMode, selectedNodeId, connections, nodes, saveSnapshot, syncToolLink]);

  // Handle drag start (for connections via handles)
  const handleHandleDragStart = useCallback((fromNodeId, fromSide, toNodeId, toSide, linkType) => {
    const newConn = {
      from: fromNodeId,
      fromSide,
      to: toNodeId,
      toSide,
      ...(linkType ? { linkType } : {}),
    };

    // Check if connection already exists
    const exists = connections.some(
      (c) =>
        c.from === newConn.from &&
        c.fromSide === newConn.fromSide &&
        c.to === newConn.to &&
        c.toSide === newConn.toSide &&
        (c.linkType ?? undefined) === (newConn.linkType ?? undefined)
    );

    if (!exists) {
      saveSnapshot();
      setConnections((prev) => [...prev, newConn]);
      if (linkType === 'tool-link') {
        const fromNode = snapshotRef.current.nodes.find((n) => n.id === fromNodeId);
        const toNode   = snapshotRef.current.nodes.find((n) => n.id === toNodeId);
        if (fromNode && toNode) {
          const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
          const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
          syncToolLink(agentNode, toolNode, 'add');
        }
      }
    }
  }, [connections, saveSnapshot, syncToolLink]);

  // Connection click
  const handleConnectionClick = useCallback((conn, midpoint) => {
    setSelectedConnection(conn);
    setDeleteConnBtnPos(midpoint);
  }, []);

  // Delete connection
  const handleDeleteConnection = useCallback((conn) => {
    saveSnapshot();
    setConnections((prev) =>
      prev.filter(
        (c) =>
          !(
            c.from === conn.from &&
            c.fromSide === conn.fromSide &&
            c.to === conn.to &&
            c.toSide === conn.toSide
          )
      )
    );
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);

    if (conn.linkType === 'tool-link') {
      const fromNode = snapshotRef.current.nodes.find((n) => n.id === conn.from);
      const toNode   = snapshotRef.current.nodes.find((n) => n.id === conn.to);
      if (fromNode && toNode) {
        const agentNode = fromNode.type === 'agent' ? fromNode : toNode;
        const toolNode  = fromNode.type === 'tool'  ? fromNode : toNode;
        syncToolLink(agentNode, toolNode, 'remove');
      }
    }
  }, [saveSnapshot, syncToolLink]);

  // Canvas click (clear selection)
  const handleCanvasClick = useCallback(() => {
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, []);

  // Toggle connection mode
  const handleToggleConnectionMode = useCallback(() => {
    setConnectionMode((prev) => !prev);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
  }, []);

  // Undo
  const handleUndo = useCallback(() => {
    if (history.length === 0) return;
    const snapshot = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setNodes(snapshot.nodes);
    setConnections(snapshot.connections);
  }, [history]);

  // Export schema (disabled - functionality removed)
  const [showExportConfirm, setShowExportConfirm] = useState(false);

  const handleExport = useCallback(() => {
    setShowExportConfirm(true);
  }, []);

  const confirmExport = useCallback(() => {
    const data = {
      exportedAt: new Date().toISOString(),
      nodes: nodes.map((n) => {
        const base = { id: n.id, type: n.type, x: n.x, y: n.y };
        if (n.type === 'agent') return { ...base, name: n.agentName, icon: n.agentIcon, agentId: n.agentId };
        if (n.type === 'tool') return { ...base, name: n.toolName, icon: n.toolIcon, toolId: n.toolId, isMcp: n.isMcp || false };
        if (n.type === 'artefact') return { ...base, name: n.label, icon: n.icon, artefactType: n.artefactType };
        return base;
      }),
      connections: connections.map((c) => ({
        from: c.from,
        fromSide: c.fromSide,
        to: c.to,
        toSide: c.toSide,
        ...(c.linkType ? { linkType: c.linkType } : {}),
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportConfirm(false);
  }, [nodes, connections]);

  const handleImport = useCallback((data) => {
    if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.connections)) {
      alert('Invalid workflow file: missing nodes or connections.');
      return;
    }
    saveSnapshot();
    const importedNodes = data.nodes.map((n) => {
      const base = { id: n.id, type: n.type, x: n.x, y: n.y };
      if (n.type === 'agent') return { ...base, agentId: n.agentId, agentName: n.name, agentIcon: n.icon || '🤖' };
      if (n.type === 'tool') return { ...base, toolId: n.toolId, toolName: n.name, toolIcon: n.icon || '🔧', isMcp: n.isMcp || false };
      if (n.type === 'artefact') return { ...base, artefactType: n.artefactType, label: n.name, icon: n.icon };
      return base;
    });
    setNodes(importedNodes);
    setConnections(data.connections);
  }, [saveSnapshot]);

  // Clear canvas
  const addLog = useCallback((type, message) => {
    const timestamp = new Date().toLocaleTimeString();
    setTerminalLogs((prev) => [...prev, { timestamp, type, message }]);
  }, []);

  const handleRun = useCallback(async () => {
    const agentNodes = nodes.filter((n) => n.type === 'agent');
    const orchestratorNodes = nodes.filter((n) => n.type === 'orchestrator');
    if (agentNodes.length === 0 && orchestratorNodes.length === 0) {
      setTerminalOpen(true);
      addLog('error', 'Add at least one agent or orchestrator to the workflow before running.');
      return;
    }
    setTerminalOpen(true);
    addLog('info', 'Running workflow...');

    // Build nodes with full agent data for the runtime
    const builtNodes = await Promise.all(nodes.map(async (n) => {
      const base = { id: n.id, type: n.type };
      if (n.type === 'agent') {
        const agentData = agents.find((a) => a._id === n.agentId);
        // Fetch agent files (soul prompt, skills)
        let files = [];
        try {
          const filesRes = await fetch(`http://localhost:4000/api/agents/${n.agentId}/files`);
          if (filesRes.ok) files = await filesRes.json();
        } catch {}
        return {
          ...base, ...agentData, files,
          ...(n.workingDir ? { workingDir: n.workingDir, playground: n.workingDir } : {}),
          ...(n.sessionId ? { sessionId: n.sessionId } : {}),
        };
      }
      if (n.type === 'orchestrator') {
        // Fetch full orchestrator data with populated sub-agents
        let orchData = null;
        try {
          const orchRes = await fetch('http://localhost:4000/api/orchestrators');
          if (orchRes.ok) {
            const allOrch = await orchRes.json();
            orchData = allOrch.find((o) => o._id === n.orchestratorId);
          }
        } catch {}
        // Fetch files for each sub-agent
        const subAgents = [];
        if (orchData?.subAgents) {
          for (const sub of orchData.subAgents) {
            const agentData = sub.agent || sub;
            let files = [];
            try {
              const filesRes = await fetch(`http://localhost:4000/api/agents/${agentData._id}/files`);
              if (filesRes.ok) files = await filesRes.json();
            } catch {}
            subAgents.push({ ...agentData, stateful: sub.stateful ?? false, files });
          }
        }
        // Fetch orchestrator's own files (soul prompt)
        let orchFiles = [];
        try {
          const filesRes = await fetch(`http://localhost:4000/api/agents/${n.orchestratorId}/files`);
          if (filesRes.ok) orchFiles = await filesRes.json();
        } catch {}
        return { ...base, ...orchData, orchestratorId: n.orchestratorId, subAgents, files: orchFiles };
      }
      if (n.type === 'tool') return { ...base, name: n.toolName, icon: n.toolIcon, toolId: n.toolId, isMcp: n.isMcp || false };
      if (n.type === 'artefact') return { ...base, name: n.label, icon: n.icon, artefactType: n.artefactType };
      return base;
    }));

    const payload = {
      nodes: builtNodes,
      connections: connections.map((c) => ({
        from: c.from,
        fromSide: c.fromSide,
        to: c.to,
        toSide: c.toSide,
        ...(c.linkType ? { linkType: c.linkType } : {}),
      })),
      // If we already have a workflow session, request incremental compile
      ...(workflowSessionId ? { existingSessionId: workflowSessionId.split('::')[0] } : {}),
    };
    try {
      const res = await fetch('http://localhost:5000/runtime/workflow/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Unknown error');
      if (data.compilationSuccess) {
        if (data.incremental) {
          addLog('info', `Incremental compilation succeeded (${data.newAgents?.length || 0} new agent(s))`);
          // Only create sessions/tabs for newly compiled agents
          const newTabs = (data.newAgents || []).map((agent) => {
            const compositeKey = `${data.sessionId}::${agent.id}`;
            createSession(agent.name, compositeKey, agent.name);
            return { agentName: agent.name, sessionId: compositeKey };
          });
          if (newTabs.length > 0) {
            setChatTabs((prev) => {
              const existing = new Set(prev.map((t) => t.sessionId));
              const toAdd = newTabs.filter((t) => !existing.has(t.sessionId));
              return toAdd.length ? [...prev, ...toAdd] : prev;
            });
            // Switch to first new agent
            setActiveChatTab(newTabs[0].sessionId);
            setActiveSessionAgent(newTabs[0].agentName);
          }
        } else {
          addLog('info', 'Compilation succeeded');
          // Full compile: register sessions and open tabs for ALL agents
          const allTabs = (data.agents || []).map((agent) => {
            const compositeKey = `${data.sessionId}::${agent.id}`;
            createSession(agent.name, compositeKey, agent.name);
            return { agentName: agent.name, sessionId: compositeKey };
          });

          // Default active chat target is the first agent in execution queue
          const firstCompositeKey = data.activeAgent?.id
            ? `${data.sessionId}::${data.activeAgent.id}`
            : allTabs[0]?.sessionId;
          setWorkflowSessionId(firstCompositeKey);
          setActiveSessionAgent(data.activeAgent?.name || allTabs[0]?.agentName || null);
          setChatTabs(allTabs);
          setActiveChatTab(firstCompositeKey);
        }
      }
      // Auto-save workflow to project repo (silent, fire-and-forget)
      if (projectMainRepo && projectName) {
        const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const workflowFilePath = `${projectMainRepo}/workflows/${safeName}.json`;
        const workflowData = {
          exportedAt: new Date().toISOString(),
          projectName,
          nodes: nodes.map((n) => {
            const base = { id: n.id, type: n.type, x: n.x, y: n.y };
            if (n.type === 'agent') return { ...base, name: n.agentName, icon: n.agentIcon, agentId: n.agentId, sessionId: n.sessionId, workingDir: n.workingDir };
            if (n.type === 'orchestrator') return { ...base, name: n.orchestratorName, icon: n.orchestratorIcon, orchestratorId: n.orchestratorId };
            if (n.type === 'tool') return { ...base, name: n.toolName, icon: n.toolIcon, toolId: n.toolId, isMcp: n.isMcp || false };
            if (n.type === 'artefact') return { ...base, name: n.label, icon: n.icon, artefactType: n.artefactType };
            return base;
          }),
          connections: connections.map((c) => ({
            from: c.from, fromSide: c.fromSide, to: c.to, toSide: c.toSide,
            ...(c.linkType ? { linkType: c.linkType } : {}),
          })),
        };
        fetch('http://localhost:5000/runtime/workflow/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: workflowFilePath, data: workflowData }),
        }).catch((err) => addLog('error', `Workflow auto-save failed: ${err.message}`));
      }

      addLog('info', `Workflow started (${data.mode})`);
      addLog('info', `Session: ${data.sessionId}`);
      if (data.agentDetails) {
        addLog('info', '── Agents ──────────────────────────');
        data.agentDetails.forEach((a) => {
          addLog('info', `  ${a.name} | model: ${a.model} | mode: ${a.sessionMode} | thinking: ${a.thinkingLevel}`);
          if (a.tools.length > 0) {
            addLog('info', `    interfaces: ${a.tools.join(', ')}`);
          }
        });
      }
      if (data.executionQueue) {
        addLog('info', '── Execution Queue ─────────────────');
        data.executionQueue.forEach((level, i) => {
          const names = level.map((n) => `${n.name} (${n.type})`).join(', ');
          addLog('info', `  Level ${i}: ${names}`);
        });
      }
    } catch (err) {
      addLog('error', `Failed: ${err.message}`);
    }
  }, [nodes, connections, agents, addLog, workflowSessionId, projectMainRepo, projectName]);

  const handleClear = useCallback(() => {
    saveSnapshot();
    setNodes([]);
    setConnections([]);
    setSelectedNodeId(null);
    setSelectedConnection(null);
    setDeleteConnBtnPos(null);
    setWorkflowSessionId(null);
    setChatTabs([]);
    setActiveChatTab(null);
    setActiveSessionAgent(null);
  }, [saveSnapshot]);

  return (
    <div className="wf-shell">
      <Header
        connectionMode={connectionMode}
        canUndo={history.length > 0}
        terminalOpen={terminalOpen}
        onToggleConnectionMode={handleToggleConnectionMode}
        onToggleTerminal={() => setTerminalOpen((v) => !v)}
        onUndo={handleUndo}
        onExport={handleExport}
        onImport={handleImport}
        onRun={handleRun}
        onClear={handleClear}
        projectMode={!!projectMainRepo}
        contextOpen={contextPanelOpen}
        onToggleContext={() => {
          if (contextPanelOpen) {
            setContextPanelOpen(false);
          } else {
            closeAllPanels();
            setContextPanelOpen(true);
          }
        }}
      />
      <div className="wf-body">
        <Sidebar
          agents={agents}
          loadingAgents={loadingAgents}
          agentsError={agentsError}
          tools={tools}
          loadingTools={loadingTools}
          toolsError={toolsError}
          interfaces={interfaces}
          loadingInterfaces={loadingInterfaces}
          interfacesError={interfacesError}
          orchestrators={orchestrators}
          loadingOrchestrators={loadingOrchestrators}
          orchestratorsError={orchestratorsError}
          onDragStart={handleSidebarDragStart}
          onAgentClick={(agentId) => { closeAllPanels(); setSelectedAgentId(agentId); }}
          onToolClick={(toolId) => { closeAllPanels(); setSelectedToolId(toolId); }}
          placedAgentIds={nodes.filter((n) => n.type === 'agent').map((n) => n.agentId)}
          placedOrchestratorIds={nodes.filter((n) => n.type === 'orchestrator').map((n) => n.orchestratorId)}
          onBuildPiAgent={handleBuildPiAgent}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          projectRepos={projectRepos}
          onAddAgentToRepo={handleAddAgentToRepo}
          onCreateAgentForRepo={(repoIndex) => {
            closeAllPanels();
            setCreateAgentRepoIndex(repoIndex);
            setCreatingPiAgent(true);
          }}
        />
        <div className={`wf-canvas-area${terminalOpen ? ' wf-canvas-area--split' : ''}`}>
          <Canvas
            nodes={nodes}
            connections={connections}
            connectionMode={connectionMode}
            selectedNodeId={selectedNodeId}
            onDrop={handleDrop}
            onDeleteNode={handleDeleteNode}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragMove={handleNodeDragMove}
            onHandleDragStart={handleHandleDragStart}
            onNodeClick={handleNodeClick}
            onConnectionClick={handleConnectionClick}
            onDeleteConnection={handleDeleteConnection}
            onCanvasClick={handleCanvasClick}
          />
          {terminalOpen && (
            <Terminal
              logs={terminalLogs}
              onClose={() => setTerminalOpen(false)}
              chatTabs={chatTabs}
              activeChatTab={activeChatTab}
              onSwitchChatTab={(sid) => setActiveChatTab(sid)}
              onMessageSent={touchWorkflow}
            />
          )}
        </div>
        {selectedAgentId && (
          <AgentDetailPanel
            agent={agents.find((a) => a._id === selectedAgentId)}
            availableTools={tools}
            onClose={() => setSelectedAgentId(null)}
            onAgentUpdated={handleAgentUpdated}
            projectMode={!!projectRepos}
          />
        )}
        {selectedToolId && (
          <ToolDetailPanel
            tool={tools.find((t) => t._id === selectedToolId)}
            onClose={() => setSelectedToolId(null)}
          />
        )}
        {creatingPiAgent && (
          <div className="wf-detail-panel">
            <div className="wf-detail-panel-header">
              <span className="wf-detail-panel-title">Build a Pi Agent</span>
              <button className="wf-detail-panel-close" onClick={() => setCreatingPiAgent(false)}>×</button>
            </div>
            <div className="wf-detail-panel-body">
              <PiAgentFormContainer
                onCreated={handlePiAgentCreated}
                onUpdated={() => {}}
                onCancel={() => { setCreatingPiAgent(false); setCreateAgentRepoIndex(null); }}
                initialPlayground={createAgentRepoIndex !== null && projectRepos ? projectRepos[createAgentRepoIndex]?.path : undefined}
              />
            </div>
          </div>
        )}
        {selectedScrumRoomNodeId && (
          <ScrumRoomPanel
            node={nodes.find((n) => n.id === selectedScrumRoomNodeId)}
            onClose={() => setSelectedScrumRoomNodeId(null)}
          />
        )}
        {contextPanelOpen && projectMainRepo && (
          <ContextPanel
            projectMainRepo={projectMainRepo}
            onClose={() => setContextPanelOpen(false)}
          />
        )}
      </div>
      
      {/* Delete connection button */}
      {selectedConnection && deleteConnBtnPos && (
        <button
          className="wf-delete-conn"
          style={{
            left: `${deleteConnBtnPos.x - 11}px`,
            top: `${deleteConnBtnPos.y - 11}px`,
          }}
          onClick={() => handleDeleteConnection(selectedConnection)}
        >
          ×
        </button>
      )}

      {showExportConfirm && (
        <div className="wf-modal-overlay">
          <div className="wf-modal">
            <p className="wf-modal-text">Are you sure you want to export this workflow?</p>
            <div className="wf-modal-actions">
              <button className="btn btn--secondary" onClick={() => setShowExportConfirm(false)}>Cancel</button>
              <button className="btn btn--primary" onClick={confirmExport}>Yes, export</button>
            </div>
          </div>
        </div>
      )}

      {hookProgress && !hookPopup && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          background: '#1e1e2e',
          border: '1px solid #2a3350',
          borderRadius: '8px',
          padding: '12px 20px',
          color: '#cdd6f4',
          fontSize: '13px',
          zIndex: 9999,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        }}>
          <strong>{hookProgress.interfaceName}</strong>: {hookProgress.received}/{hookProgress.expected} agents submitted
          <span style={{ color: '#7c8cf8', marginLeft: 8 }}>({hookProgress.latestAgent} just submitted)</span>
        </div>
      )}

      {hookPopup && (
        <div className="wf-modal-overlay" onClick={() => setHookPopup(null)}>
          <div className="wf-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720, textAlign: 'left' }}>
            {Array.isArray(hookPopup.entries) ? (
              /* ── Merged multi-entry popup ── */
              <>
                <div className="wf-modal-text">
                  <strong>{hookPopup.entries.length} agents</strong> submitted <strong>{hookPopup.toolName}</strong>
                  {hookPopup.nextAgents?.length > 0 && (
                    <span> → {hookPopup.nextAgents.map((a) => a.name).join(', ')}</span>
                  )}
                </div>
                <div style={{
                  background: '#1e1e2e',
                  borderRadius: '6px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  margin: '12px 0',
                  padding: '4px 0',
                }}>
                  {hookPopup.entries.map((entry, idx) => (
                    <div key={idx}>
                      <div style={{
                        padding: '8px 12px',
                        background: '#252540',
                        borderBottom: '1px solid #2a3350',
                        fontWeight: 600,
                        color: '#a6adc8',
                        fontSize: '12px',
                        textTransform: 'uppercase',
                        letterSpacing: '0.5px',
                      }}>
                        {entry.agentName}
                      </div>
                      {Object.entries(entry.args || {}).map(([key, value]) => (
                        <div key={key} style={{
                          display: 'flex',
                          padding: '8px 12px',
                          borderBottom: '1px solid #2a3350',
                        }}>
                          <span style={{ color: '#7c8cf8', fontWeight: 600, minWidth: 120, flexShrink: 0, fontSize: '13px' }}>
                            {key}
                          </span>
                          <span style={{ color: '#cdd6f4', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {Array.isArray(value) ? (
                              <ul style={{ margin: 0, paddingLeft: '18px', listStyle: 'disc' }}>
                                {value.map((item, i) => (
                                  <li key={i} style={{ marginBottom: '4px' }}>
                                    {typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}
                                  </li>
                                ))}
                              </ul>
                            ) : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              /* ── Single-entry popup (existing) ── */
              <>
                <div className="wf-modal-text">
                  <strong>{hookPopup.agentName}</strong> called <strong>{hookPopup.toolName}</strong>
                  {hookPopup.nextAgents?.length > 0 && (
                    <span> → {hookPopup.nextAgents.map((a) => a.name).join(', ')}</span>
                  )}
                </div>
                <div style={{
                  background: '#1e1e2e',
                  borderRadius: '6px',
                  overflow: 'auto',
                  maxHeight: '400px',
                  margin: '12px 0',
                  padding: '4px 0',
                }}>
                  {Object.entries(hookPopup.args || {}).map(([key, value]) => (
                    <div key={key} style={{
                      display: 'flex',
                      padding: '8px 12px',
                      borderBottom: '1px solid #2a3350',
                    }}>
                      <span style={{ color: '#7c8cf8', fontWeight: 600, minWidth: 120, flexShrink: 0, fontSize: '13px' }}>
                        {key}
                      </span>
                      <span style={{ color: '#cdd6f4', fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {Array.isArray(value) ? (
                          <ul style={{ margin: 0, paddingLeft: '18px', listStyle: 'disc' }}>
                            {value.map((item, i) => (
                              <li key={i} style={{ marginBottom: '4px' }}>
                                {typeof item === 'object' ? JSON.stringify(item, null, 2) : String(item)}
                              </li>
                            ))}
                          </ul>
                        ) : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className="wf-modal-actions">
              <button className="btn btn--secondary" onClick={() => setHookPopup(null)}>Close</button>
              <button className="btn btn--primary" onClick={handleAcceptHook}>Accept</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkflowBuilder;
