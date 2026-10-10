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
    """Create a new project dashboard with a name and optional description."""
    return store.create_dashboard(name, description)


@mcp.tool()
def get_dashboard(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
) -> ProjectDashboard | str:
    """Get the full project dashboard including all plans and tasks."""
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
    """Update the project name or description."""
    result = store.update_dashboard(dashboard_id, name, description)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def get_dashboard_summary(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
) -> dict | str:
    """Get a lightweight summary: project name, task counts by state, latest plan status."""
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
    """Add a new plan entry to the project's plan history."""
    result = store.add_plan(dashboard_id, content, status)
    if not result:
        return f'Dashboard with id "{dashboard_id}" not found'
    return result


@mcp.tool()
def list_plans(
    dashboard_id: Annotated[str, Field(description="UUID of the dashboard")],
    status: Annotated[PlanStatus | None, Field(description="Filter by status: draft, active, or archived")] = None,
) -> list[PlanEntry] | str:
    """List all plans for a project, optionally filtered by status."""
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
    """Update a plan's content or status."""
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
    """Add a new task to the project dashboard."""
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
    """Get tasks from the dashboard, optionally filtered by state, assignee, or priority."""
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
    """Update a task's title, description, state, assignee, or priority."""
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
