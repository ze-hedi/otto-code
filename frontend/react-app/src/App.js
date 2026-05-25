import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AgentChatProvider } from './AgentChatContext';
import Home from './pages/Home';
import WorkflowBuilder from './WorkflowBuilder';
import ChatPage from './pages/ChatPage';
import AgentsPage from './pages/AgentsPage';
import ToolsPage from './pages/ToolsPage';
import TeamOfAgentsPage from './pages/TeamOfAgentsPage';
import OrchestratorPage from './pages/OrchestratorPage';
import DashboardPage from './pages/DashboardPage';
import AgentDashboardPage from './pages/AgentDashboardPage';
import WorkflowsPage from './pages/WorkflowsPage';

function App() {
  return (
    <BrowserRouter>
      <AgentChatProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflow" element={<WorkflowBuilder />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:agentId" element={<ChatPage />} />
        <Route path="/chat/:agentId/:sessionId" element={<ChatPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/team-of-agents" element={<TeamOfAgentsPage />} />
          <Route path="/orchestrators" element={<OrchestratorPage />} />
          <Route path="/dashboard/:agentId/:sessionId" element={<AgentDashboardPage />} />
          <Route path="/orch-dashboard/:orchestratorId/:sessionId" element={<DashboardPage />} />
          <Route path="/orch-dashboard/:orchestratorId" element={<DashboardPage />} />
        </Routes>
      </AgentChatProvider>
    </BrowserRouter>
  );
}

export default App;
