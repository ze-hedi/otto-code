import React, { useEffect } from 'react';
import './ChatPage.css';

function ChatPage() {
  useEffect(() => {
    console.log('chat');
  }, []);

  return (
    <div className="chat-container">
      <div className="chat-content">
        <h1>Chat Page</h1>
        <p>Chat functionality coming soon...</p>
        <p className="console-note">(Check console for "chat" log)</p>
      </div>
    </div>
  );
}

export default ChatPage;
