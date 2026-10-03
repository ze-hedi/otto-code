import { Routes, Route } from 'react-router-dom'
import { CreateAgentForm } from './pages/CreateAgentForm'
import { ChatPage } from './pages/ChatPage'
import './App.css'

function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<CreateAgentForm />} />
        <Route path="/chat/:agentId" element={<ChatPage />} />
      </Routes>
    </div>
  )
}

export default App
