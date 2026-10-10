import { Routes, Route } from 'react-router-dom'
import { ProjectsPage } from './pages/ProjectsPage'
import { CreateProjectForm } from './pages/CreateProjectForm'
import { ProjectHomePage } from './pages/ProjectHomePage'
import { AgentsListPage } from './pages/AgentsListPage'
import { CreateAgentForm } from './pages/CreateAgentForm'
import { ChatPage } from './pages/ChatPage'
import { WorkflowPage } from './pages/WorkflowPage'
import { DashboardsPage } from './pages/DashboardsPage'
import { DashboardDetailPage } from './pages/DashboardDetailPage'
import './App.css'

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/projects/new" element={<CreateProjectForm />} />
        <Route path="/projects/:projectId" element={<ProjectHomePage />} />
        <Route path="/projects/:projectId/agents" element={<AgentsListPage />} />
        <Route path="/projects/:projectId/create" element={<CreateAgentForm />} />
        <Route path="/projects/:projectId/chat/:agentId" element={<ChatPage />} />
        <Route path="/projects/:projectId/workflow" element={<WorkflowPage />} />
        <Route path="/dashboards" element={<DashboardsPage />} />
        <Route path="/dashboards/:dashboardId" element={<DashboardDetailPage />} />
      </Routes>
    </div>
  )
}

export default App
