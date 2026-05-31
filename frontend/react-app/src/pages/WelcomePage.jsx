import React from 'react';
import { useNavigate } from 'react-router-dom';
import './WelcomePage.css';

function WelcomePage() {
  const navigate = useNavigate();

  return (
    <div className="welcome-container">
      <div className="welcome-content">
        <h1>Otto</h1>
        <div className="welcome-cards">
          <div className="welcome-card" onClick={() => navigate('/workspaces')}>
            <div className="welcome-card-icon">📁</div>
            <h2>Workspaces</h2>
            <p>Manage your project workspaces</p>
          </div>
          <div className="welcome-card" onClick={() => navigate('/hub')}>
            <div className="welcome-card-icon">🚀</div>
            <h2>Hub</h2>
            <p>Agents, workflows, tools & more</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WelcomePage;
