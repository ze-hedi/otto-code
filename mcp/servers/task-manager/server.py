from typing import Annotated
from pydantic import Field
from mcp.server.fastmcp import FastMCP
from projects import Project, ProjectStore, Subtask, Task, TaskState

mcp = FastMCP("task-manager", host="0.0.0.0", port=3100)
store = ProjectStore()


# ── Coordinator tools (full access) ──────────────────────────────────────────


@mcp.tool()
def create_project(
    name: Annotated[str, Field(description="The name of the project to create")],
) -> Project:
    """Create a new project. Returns the created project with its generated ID."""
    return store.create_project(name)


@mcp.tool()
def get_project(
    project_id: Annotated[str, Field(description="The UUID of the project to retrieve")],
) -> Project | str:
    """Get a project by ID, including all its tasks."""
    project = store.get_project(project_id)
    if not project:
        return f'Project with id "{project_id}" not found'
    return project


@mcp.tool()
def add_task(
    project_id: Annotated[str, Field(description="The UUID of the project to add the task to")],
    description: Annotated[str, Field(description="A clear description of what the task involves")],
    responsible_agent: Annotated[str, Field(description="Name of the specialist agent assigned to this task (e.g. 'frontend-dev', 'backend-dev', 'designer', 'devops')")],
    state: Annotated[TaskState, Field(description="Initial state of the task: 'opened', 'in_work', or 'closed'")] = TaskState.opened,
) -> Task | str:
    """Add a new task to a project. The task gets a generated UUID as its ID."""
    task = Task(description=description, state=state, responsible_agent=responsible_agent)
    result = store.add_task(project_id, task)
    if not result:
        return f'Project with id "{project_id}" not found'
    return result


@mcp.tool()
def get_tasks(
    project_id: Annotated[str, Field(description="The UUID of the project to fetch tasks from")],
    state: Annotated[TaskState | None, Field(description="Filter tasks by state: 'opened', 'in_work', or 'closed'")] = None,
    responsible_agent: Annotated[str | None, Field(description="Filter tasks by assigned agent name")] = None,
) -> list[Task] | str:
    """Get all tasks for a project, optionally filtered by state or responsible agent."""
    result = store.get_tasks(project_id, state, responsible_agent)
    if result is None:
        return f'Project with id "{project_id}" not found'
    return result


@mcp.tool()
def update_task(
    project_id: Annotated[str, Field(description="The UUID of the project containing the task")],
    task_id: Annotated[str, Field(description="The UUID of the task to update")],
    description: Annotated[str | None, Field(description="New description for the task")] = None,
    state: Annotated[TaskState | None, Field(description="New state for the task: 'opened', 'in_work', or 'closed'")] = None,
) -> Task | str:
    """Update an existing task's description or state within a project."""
    result = store.update_task(project_id, task_id, description, state)
    if not result:
        return f'Task with id "{task_id}" not found in project "{project_id}"'
    return result


# ── Agent-scoped tools (restricted to own tasks) ────────────────────────────


@mcp.tool()
def get_agent_tasks(
    project_id: Annotated[str, Field(description="The UUID of the project")],
    responsible_agent: Annotated[str, Field(description="The name of the agent whose tasks to fetch")],
    state: Annotated[TaskState | None, Field(description="Filter by state: 'opened', 'in_work', or 'closed'")] = None,
) -> list[Task] | str:
    """Get tasks assigned to a specific agent within a project."""
    result = store.get_agent_tasks(project_id, responsible_agent, state)
    if result is None:
        return f'Project with id "{project_id}" not found'
    return result


@mcp.tool()
def update_agent_task(
    project_id: Annotated[str, Field(description="The UUID of the project")],
    task_id: Annotated[str, Field(description="The UUID of the task to update")],
    responsible_agent: Annotated[str, Field(description="The name of the agent — must match the task's responsible_agent")],
    description: Annotated[str | None, Field(description="New description for the task")] = None,
    state: Annotated[TaskState | None, Field(description="New state: 'opened', 'in_work', or 'closed'")] = None,
) -> Task | str:
    """Update a task only if it belongs to the specified agent."""
    return store.update_agent_task(project_id, task_id, responsible_agent, description, state)


@mcp.tool()
def add_subtask(
    project_id: Annotated[str, Field(description="The UUID of the project")],
    task_id: Annotated[str, Field(description="The UUID of the parent task to add a subtask to")],
    responsible_agent: Annotated[str, Field(description="The name of the agent — must match the parent task's responsible_agent")],
    title: Annotated[str, Field(description="Title of the subtask")],
    description: Annotated[str, Field(description="Description of the subtask")],
) -> Subtask | str:
    """Add a subtask to a task, only if the task belongs to the specified agent."""
    subtask = Subtask(title=title, description=description)
    return store.add_subtask(project_id, task_id, responsible_agent, subtask)


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
