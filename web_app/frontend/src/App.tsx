import { Routes, Route } from 'react-router-dom'
import { AgentsListPage } from './pages/AgentsListPage'
import { CreateAgentForm } from './pages/CreateAgentForm'
import { ChatPage } from './pages/ChatPage'
import { WorkflowPage } from './pages/WorkflowPage'
import './App.css'

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<AgentsListPage />} />
        <Route path="/create" element={<CreateAgentForm />} />
        <Route path="/chat/:agentId" element={<ChatPage />} />
        <Route path="/workflow" element={<WorkflowPage />} />
      </Routes>
    </div>
  )
}

export default App
