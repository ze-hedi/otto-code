import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { ProjectsPage } from './pages/ProjectsPage'
import { CreateProjectForm } from './pages/CreateProjectForm'
import { ProjectHomePage } from './pages/ProjectHomePage'
import { AgentsListPage } from './pages/AgentsListPage'
import { CreateAgentForm } from './pages/CreateAgentForm'
import { ChatPage } from './pages/ChatPage'
import { WorkflowsListPage } from './pages/WorkflowsListPage'
import { WorkflowPage } from './pages/WorkflowPage'
import { DashboardsPage } from './pages/DashboardsPage'
import { DashboardDetailPage } from './pages/DashboardDetailPage'
import { SleepingModePage } from './pages/SleepingModePage'
import './App.css'

function WorkflowRedirect() {
  const { projectId } = useParams()
  return <Navigate to={`/projects/${projectId}/workflows`} replace />
}

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
        <Route path="/projects/:projectId/sleeping" element={<SleepingModePage />} />
        <Route path="/projects/:projectId/workflow" element={<WorkflowRedirect />} />
        <Route path="/projects/:projectId/workflows" element={<WorkflowsListPage />} />
        <Route path="/projects/:projectId/workflows/:workflowId" element={<WorkflowPage />} />
        <Route path="/dashboards" element={<DashboardsPage />} />
        <Route path="/dashboards/:dashboardId" element={<DashboardDetailPage />} />
      </Routes>
    </div>
  )
}

export default App
