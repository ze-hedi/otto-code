import { useNavigate } from 'react-router-dom'
import './HomePage.css'

export function HomePage() {
  const navigate = useNavigate()

  return (
    <div className="home-page">
      <div className="home-header">
        <h1>Otto</h1>
        <p className="home-subtitle">What would you like to work with?</p>
      </div>

      <div className="home-cards">
        <button className="home-card" onClick={() => navigate('/agents')}>
          <div className="home-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M6 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
            </svg>
          </div>
          <h2>Agents</h2>
          <p>Create and manage individual AI agents with custom tools and instructions.</p>
        </button>

        <button className="home-card" onClick={() => navigate('/workflow')}>
          <div className="home-card-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="6" height="6" rx="1" />
              <rect x="15" y="3" width="6" height="6" rx="1" />
              <rect x="9" y="15" width="6" height="6" rx="1" />
              <path d="M6 9v3a1 1 0 0 0 1 1h3" />
              <path d="M18 9v3a1 1 0 0 1-1 1h-3" />
            </svg>
          </div>
          <h2>Workflows</h2>
          <p>Design multi-step pipelines that chain agents together.</p>
        </button>
      </div>
    </div>
  )
}
