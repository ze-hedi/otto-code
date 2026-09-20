from datetime import datetime, timezone
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("task-manager", host="0.0.0.0", port=3100)

tasks: list[dict] = []
next_id = 1


@mcp.tool()
def add_task(description: str, execution_agent: str, state: str = "opened") -> dict:
    """Add a new task to the task list."""
    global next_id
    task = {
        "id": str(next_id),
        "description": description,
        "state": state,
        "executionAgent": execution_agent,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    next_id += 1
    tasks.append(task)
    return task


@mcp.tool()
def get_tasks(state: str | None = None, execution_agent: str | None = None) -> list[dict]:
    """Get all tasks, optionally filtered by state or execution agent."""
    filtered = tasks
    if state:
        filtered = [t for t in filtered if t["state"] == state]
    if execution_agent:
        filtered = [t for t in filtered if t["executionAgent"] == execution_agent]
    return filtered


@mcp.tool()
def update_task(id: str, description: str | None = None, state: str | None = None) -> dict | str:
    """Update an existing task's description or state."""
    task = next((t for t in tasks if t["id"] == id), None)
    if not task:
        return f'Task with id "{id}" not found'
    if description is not None:
        task["description"] = description
    if state is not None:
        task["state"] = state
    return task


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
