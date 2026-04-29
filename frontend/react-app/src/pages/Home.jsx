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
            className="home-button chat-button"
            onClick={() => navigate('/chat')}
          >
            Create Chat
          </button>
        </div>
      </div>
    </div>
  );
}

export default Home;
