import os
from typing import Annotated
from pydantic import Field
from fastmcp import FastMCP
from models import (
    DashboardStore,
    DashboardTask,
    PlanEntry,
    PlanStatus,
    ProjectDashboard,
    TaskPriority,
    TaskState,
)

mcp = FastMCP(name="project-dashboard")
store = DashboardStore()


# ── Project-level tools ─────────────────────────────────────────────────────


@mcp.tool()
def create_dashboard(
    name: Annotated[str, Field(description="Project name")],
    description: Annotated[str, Field(description="Long markdown description of the project")] = "",
) -> ProjectDashboard:
    """Create a new project dashboard with a name and optional description.

    ---pi-agent---
    snippet: create_dashboard: create a new project board to track plans and tasks
    guidelines:
      - call this only once per project; reuse the returned dashboard_id for all subsequent calls
      - store the dashboard_id immediately after creation — it is required by every other tool
    ---
    """
    return store.create_dashboard(name, description)


@mcp.tool()
def get_dashboard(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
) -> ProjectDashboard | str:
    """Get the full project dashboard including all plans and tasks.

    ---pi-agent---
    snippet: get_dashboard: retrieve the full dashboard with all plans and tasks
    guidelines:
      - prefer get_dashboard_summary for status checks; use this only when you need full task details
    ---
    """
    result = store.get_dashboard(dashboard_id)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def update_dashboard(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    name: Annotated[str | None, Field(description="New project name")] = None,
    description: Annotated[str | None, Field(description="New project description (markdown)")] = None,
) -> ProjectDashboard | str:
    """Update the project name or description.

    ---pi-agent---
    snippet: update_dashboard: rename a project or update its description
    ---
    """
    result = store.update_dashboard(dashboard_id, name, description)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def get_dashboard_summary(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
) -> dict | str:
    """Get a lightweight summary: project name, task counts by state, latest plan status.

    ---pi-agent---
    snippet: get_dashboard_summary: get a fast overview of task counts and plan status
    guidelines:
      - call this first before any task or plan operation to understand current project state
    ---
    """
    result = store.get_summary(dashboard_id)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


# ── Plan tools ──────────────────────────────────────────────────────────────


@mcp.tool()
def add_plan(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    content: Annotated[str, Field(description="Plan content in markdown")],
    status: Annotated[PlanStatus, Field(description="Plan status: draft, active, or archived")] = PlanStatus.draft,
) -> PlanEntry | str:
    """Add a new plan entry to the project's plan history.

    ---pi-agent---
    snippet: add_plan: append a new plan (draft/active/archived) to the project history
    guidelines:
      - set status to active when replacing the current working plan; archive the old one first
      - write plan content in markdown; include goals, steps, and open questions
    ---
    """
    result = store.add_plan(dashboard_id, content, status)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def list_plans(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    status: Annotated[PlanStatus | None, Field(description="Filter by status: draft, active, or archived")] = None,
) -> list[PlanEntry] | str:
    """List all plans for a project, optionally filtered by status.

    ---pi-agent---
    snippet: list_plans: list all plans, optionally filtered by status
    ---
    """
    result = store.list_plans(dashboard_id, status)
    if result is None:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def update_plan(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    plan_id: Annotated[str, Field(description="UUID of the plan to update")],
    content: Annotated[str | None, Field(description="New plan content (markdown)")] = None,
    status: Annotated[PlanStatus | None, Field(description="New status: draft, active, or archived")] = None,
) -> PlanEntry | str:
    """Update a plan's content or status.

    ---pi-agent---
    snippet: update_plan: edit a plan's content or change its status
    guidelines:
      - archive superseded plans rather than deleting them to preserve history
    ---
    """
    result = store.update_plan(dashboard_id, plan_id, content, status)
    if not result:
        return f'Plan "{plan_id}" not found in dashboard "{dashboard_id}"'
    return result


# ── Task tools ──────────────────────────────────────────────────────────────


@mcp.tool()
def add_dashboard_task(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    title: Annotated[str, Field(description="Short task title")],
    description: Annotated[str, Field(description="Detailed task description")],
    assignee: Annotated[str, Field(description="Agent or person assigned to this task")] = "",
    priority: Annotated[TaskPriority, Field(description="Priority: low, medium, or high")] = TaskPriority.medium,
) -> DashboardTask | str:
    """Add a new task to the project dashboard.

    ---pi-agent---
    snippet: add_dashboard_task: create a new task and assign it to an agent or person
    guidelines:
      - always set assignee; use the agent's name or role if a person is not known
      - keep title short (under 60 chars); put detail in description
    ---
    """
    result = store.add_task(dashboard_id, title, description, assignee, priority)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def get_dashboard_tasks(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    state: Annotated[TaskState | None, Field(description="Filter by state: opened, in_work, blocked, or closed")] = None,
    assignee: Annotated[str | None, Field(description="Filter by assignee name")] = None,
    priority: Annotated[TaskPriority | None, Field(description="Filter by priority: low, medium, or high")] = None,
) -> list[DashboardTask] | str:
    """Get tasks from the dashboard, optionally filtered by state, assignee, or priority.

    ---pi-agent---
    snippet: get_dashboard_tasks: list tasks with optional filters for state, assignee, or priority
    guidelines:
      - filter by state=in_work at the start of a session to resume in-progress work
    ---
    """
    result = store.get_tasks(dashboard_id, state, assignee, priority)
    if result is None:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def update_dashboard_task(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    task_id: Annotated[str, Field(description="UUID of the task to update")],
    title: Annotated[str | None, Field(description="New task title")] = None,
    description: Annotated[str | None, Field(description="New task description")] = None,
    state: Annotated[TaskState | None, Field(description="New state: opened, in_work, blocked, or closed")] = None,
    assignee: Annotated[str | None, Field(description="New assignee")] = None,
    priority: Annotated[TaskPriority | None, Field(description="New priority: low, medium, or high")] = None,
) -> DashboardTask | str:
    """Update a task's title, description, state, assignee, or priority.

    ---pi-agent---
    snippet: update_dashboard_task: change a task's state, assignee, priority, or details
    guidelines:
      - set state=in_work when you start a task, state=closed when done
      - set state=blocked and explain in description when you are waiting on something
    ---
    """
    result = store.update_task(dashboard_id, task_id, title, description, state, assignee, priority)
    if not result:
        return f'Task "{task_id}" not found in dashboard "{dashboard_id}"'
    return result


if __name__ == "__main__":
    mcp.run(
        transport="http",
        host=os.environ.get("DASHBOARD_HOST", "0.0.0.0"),
        port=int(os.environ.get("DASHBOARD_PORT", "3200")),
    )
