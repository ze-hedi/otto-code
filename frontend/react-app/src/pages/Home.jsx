import React from 'react';
import { useNavigate } from 'react-router-dom';
import './Home.css';

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home-container">
      <div className="home-content">
        <h1>Welcome to Workflow Builder</h1>
        <div className="button-container">
          <button
            className="home-button workflow-button"
            onClick={() => navigate('/workflow')}
          >
            Create Workflow
          </button>
          <button
            className="home-button workflow-button"
            onClick={() => navigate('/workflows')}
          >
            Workflows
          </button>
          <button
            className="home-button team-button"
            onClick={() => navigate('/team-of-agents')}
          >
            Create an orchestrator
          </button>
          <button
            className="home-button chat-button"
            onClick={() => navigate('/chat')}
          >
            Create Chat
          </button>
          <button
            className="home-button agents-button"
            onClick={() => navigate('/agents')}
          >
            Agents
          </button>
          <button
            className="home-button orchestrators-button"
            onClick={() => navigate('/orchestrators')}
          >
            Orchestrators
          </button>
          <button 
            className="home-button tools-button"
            onClick={() => navigate('/tools')}
          >
            Tools
          </button>
        </div>
      </div>
    </div>
  );
}

export default Home;
