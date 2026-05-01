#!/bin/bash

echo "=========================================="
echo "Testing Runtime Server"
echo "=========================================="
echo ""

# 1. Create/Set an Agent
echo "1. Creating agent instance..."
echo ""

curl -X POST http://localhost:5000/runtime/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "_id": "test-agent-123",
      "name": "My Test Agent",
      "model": "claude-sonnet-4-5",
      "description": "A test coding assistant",
      "thinkingLevel": "high",
      "sessionMode": "memory"
    },
    "files": [
      {
        "type": "soul",
        "content": "You are a helpful coding assistant. Be concise and clear."
      }
    ]
  }'

echo ""
echo ""
echo "=========================================="
echo ""

# 2. Send Query and Get Response
echo "2. Sending chat message..."
echo ""

curl --no-buffer -X POST http://localhost:5000/runtime/chat/test-agent-123 \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Write a hello world function in Python"
  }'

echo ""
echo ""
echo "=========================================="
echo "Test completed!"
echo "=========================================="
