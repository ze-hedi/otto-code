import os
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4
from pydantic import BaseModel, Field
from pymongo import MongoClient


class PlanStatus(str, Enum):
    draft = "draft"
    active = "active"
    archived = "archived"


class TaskState(str, Enum):
    opened = "opened"
    in_work = "in_work"
    blocked = "blocked"
    closed = "closed"


class TaskPriority(str, Enum):
    low = "low"
    medium = "medium"
    high = "high"


class PlanEntry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    content: str  # markdown
    status: PlanStatus = PlanStatus.draft
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DashboardTask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str
    state: TaskState = TaskState.opened
    assignee: str = ""
    priority: TaskPriority = TaskPriority.medium
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProjectDashboard(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    description: str = ""
    plans: list[PlanEntry] = Field(default_factory=list)
    tasks: list[DashboardTask] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class DashboardStore:
    def __init__(self, mongo_uri: str | None = None, db_name: str = "project_dashboard"):
        uri = mongo_uri or os.environ.get("MONGO_URI", "mongodb://localhost:27017")
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        self.collection = self.db["dashboards"]

    # ── Project CRUD ────────────────────────────────────────────────────────

    def create_dashboard(self, name: str, description: str = "") -> ProjectDashboard:
        dashboard = ProjectDashboard(name=name, description=description)
        self.collection.insert_one(dashboard.model_dump(mode="json"))
        return dashboard

    def get_dashboard(self, dashboard_id: str) -> ProjectDashboard | None:
        doc = self.collection.find_one({"id": dashboard_id})
        if not doc:
            return None
        return ProjectDashboard.model_validate(doc)

    def update_dashboard(
        self,
        dashboard_id: str,
        name: str | None = None,
        description: str | None = None,
    ) -> ProjectDashboard | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        fields: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if name is not None:
            fields["name"] = name
        if description is not None:
            fields["description"] = description
        self.collection.update_one({"id": dashboard_id}, {"$set": fields})
        if name is not None:
            dashboard.name = name
        if description is not None:
            dashboard.description = description
        return dashboard

    def get_summary(self, dashboard_id: str) -> dict | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        task_counts = {}
        for state in TaskState:
            task_counts[state.value] = sum(1 for t in dashboard.tasks if t.state == state)
        latest_plan = None
        if dashboard.plans:
            latest_plan = {"id": dashboard.plans[-1].id, "status": dashboard.plans[-1].status.value}
        return {
            "id": dashboard.id,
            "name": dashboard.name,
            "task_counts": task_counts,
            "total_tasks": len(dashboard.tasks),
            "total_plans": len(dashboard.plans),
            "latest_plan": latest_plan,
        }

    # ── Plans ───────────────────────────────────────────────────────────────

    def add_plan(
        self, dashboard_id: str, content: str, status: PlanStatus = PlanStatus.draft
    ) -> PlanEntry | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        plan = PlanEntry(content=content, status=status)
        self.collection.update_one(
            {"id": dashboard_id},
            {
                "$push": {"plans": plan.model_dump(mode="json")},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
            },
        )
        return plan

    def list_plans(
        self, dashboard_id: str, status: PlanStatus | None = None
    ) -> list[PlanEntry] | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        plans = dashboard.plans
        if status:
            plans = [p for p in plans if p.status == status]
        return plans

    def update_plan(
        self,
        dashboard_id: str,
        plan_id: str,
        content: str | None = None,
        status: PlanStatus | None = None,
    ) -> PlanEntry | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        plan = next((p for p in dashboard.plans if p.id == plan_id), None)
        if not plan:
            return None
        fields: dict = {}
        if content is not None:
            fields["plans.$.content"] = content
        if status is not None:
            fields["plans.$.status"] = status.value
        if fields:
            fields["updated_at"] = datetime.now(timezone.utc).isoformat()
            self.collection.update_one(
                {"id": dashboard_id, "plans.id": plan_id}, {"$set": fields}
            )
        if content is not None:
            plan.content = content
        if status is not None:
            plan.status = status
        return plan

    # ── Tasks ───────────────────────────────────────────────────────────────

    def add_task(
        self,
        dashboard_id: str,
        title: str,
        description: str,
        assignee: str = "",
        priority: TaskPriority = TaskPriority.medium,
    ) -> DashboardTask | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        task = DashboardTask(
            title=title, description=description, assignee=assignee, priority=priority
        )
        self.collection.update_one(
            {"id": dashboard_id},
            {
                "$push": {"tasks": task.model_dump(mode="json")},
                "$set": {"updated_at": datetime.now(timezone.utc).isoformat()},
            },
        )
        return task

    def get_tasks(
        self,
        dashboard_id: str,
        state: TaskState | None = None,
        assignee: str | None = None,
        priority: TaskPriority | None = None,
    ) -> list[DashboardTask] | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        tasks = dashboard.tasks
        if state:
            tasks = [t for t in tasks if t.state == state]
        if assignee:
            tasks = [t for t in tasks if t.assignee == assignee]
        if priority:
            tasks = [t for t in tasks if t.priority == priority]
        return tasks

    def update_task(
        self,
        dashboard_id: str,
        task_id: str,
        title: str | None = None,
        description: str | None = None,
        state: TaskState | None = None,
        assignee: str | None = None,
        priority: TaskPriority | None = None,
    ) -> DashboardTask | None:
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return None
        task = next((t for t in dashboard.tasks if t.id == task_id), None)
        if not task:
            return None
        fields: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if title is not None:
            fields["tasks.$.title"] = title
        if description is not None:
            fields["tasks.$.description"] = description
        if state is not None:
            fields["tasks.$.state"] = state.value
        if assignee is not None:
            fields["tasks.$.assignee"] = assignee
        if priority is not None:
            fields["tasks.$.priority"] = priority.value
        fields["tasks.$.updated_at"] = datetime.now(timezone.utc).isoformat()
        self.collection.update_one(
            {"id": dashboard_id, "tasks.id": task_id}, {"$set": fields}
        )
        if title is not None:
            task.title = title
        if description is not None:
            task.description = description
        if state is not None:
            task.state = state
        if assignee is not None:
            task.assignee = assignee
        if priority is not None:
            task.priority = priority
        return task
