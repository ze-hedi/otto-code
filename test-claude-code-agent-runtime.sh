#!/bin/bash

echo "=========================================="
echo "Testing Claude Code Agent — Runtime Server"
echo "=========================================="
echo ""

# 1. Instantiate a Claude Code agent
echo "1. Creating Claude Code agent instance..."
echo ""

curl -s -X POST http://localhost:5000/runtime/run \
  -H "Content-Type: application/json" \
  -d '{
    "agent": {
      "_id": "cc-test-1",
      "name": "Test Claude Code Agent",
      "model": "claude-sonnet-4-6",
      "description": "A test Claude Code agent",
      "agentType": "claude-code",
      "systemPrompt": "You are a concise code reviewer. Answer in plain text, no markdown.",
      "permissionMode": "default"
    }
  }'

echo ""
echo ""
echo "=========================================="
echo ""

# 2. Send a query and stream the SSE response
echo "2. Sending chat message (streaming)..."
echo ""

curl -N -X POST http://localhost:5000/runtime/chat/cc-test-1 \
  -H "Content-Type: application/json" \
  -d '{"message": "What programming languages are used in this repository? Give a short list."}'

echo ""
echo ""
echo "=========================================="
echo ""

# 3. Check runtime status
echo "3. Checking runtime status..."
echo ""

curl -s http://localhost:5000/runtime/status

echo ""
echo ""
echo "=========================================="
echo ""

# 4. Tear down the agent
echo "4. Deleting Claude Code agent..."
echo ""

curl -s -X DELETE http://localhost:5000/runtime/agents/cc-test-1

echo ""
echo ""
echo "=========================================="
echo "Test completed!"
echo "=========================================="
