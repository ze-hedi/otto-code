import json
from typing import AsyncIterator

import httpx

DB_API = "http://localhost:4000"
RUNTIME_API = "http://localhost:5000"
EXPLORER_SESSION_ID = "explorer"


async def fetch_agents() -> list[dict]:
    async with httpx.AsyncClient() as client:
        resp = await client.get(f"{DB_API}/api/agents")
        resp.raise_for_status()
        return resp.json()


async def start_session(agent: dict) -> dict:
    payload = {
        "agent": {
            "_id": agent["_id"],
            "name": agent["name"],
            "model": agent["model"],
            "description": agent.get("description", ""),
        }
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{RUNTIME_API}/runtime/run", json=payload)
        resp.raise_for_status()
        return resp.json()


async def stream_chat(session_id: str, message: str) -> AsyncIterator[dict]:
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{RUNTIME_API}/runtime/chat/{session_id}",
            json={"message": message},
            headers={"Accept": "text/event-stream"},
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                yield event


async def observe_agent(agent_id: str) -> AsyncIterator[dict]:
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "GET",
            f"{RUNTIME_API}/runtime/agents/{agent_id}/observe",
            headers={"Accept": "text/event-stream"},
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                yield event
