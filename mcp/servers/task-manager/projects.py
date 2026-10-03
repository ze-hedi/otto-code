import os
from datetime import datetime, timezone
from enum import Enum
from uuid import uuid4
from pydantic import BaseModel, Field
from pymongo import MongoClient


class TaskState(str, Enum):
    opened = "opened"
    in_work = "in_work"
    closed = "closed"


class Issue(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str


class Document(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    text: str  # markdown content


class Subtask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    description: str


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    description: str
    state: TaskState = TaskState.opened
    responsible_agent: str
    subtasks: list[Subtask] = Field(default_factory=list)
    issue: Issue | None = None
    documents: list[Document] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Project(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    tasks: list[Task] = Field(default_factory=list)


class ProjectStore:
    def __init__(self, mongo_uri: str | None = None, db_name: str = "task_manager"):
        uri = mongo_uri or os.environ.get("MONGO_URI", "mongodb://localhost:27017")
        self.client = MongoClient(uri)
        self.db = self.client[db_name]
        self.collection = self.db["projects"]

    def create_project(self, name: str) -> Project:
        project = Project(name=name)
        self.collection.insert_one(project.model_dump())
        return project

    def get_project(self, project_id: str) -> Project | None:
        doc = self.collection.find_one({"id": project_id})
        if not doc:
            return None
        return Project.model_validate(doc)

    def add_task(self, project_id: str, task: Task) -> Task | None:
        result = self.collection.update_one(
            {"id": project_id},
            {"$push": {"tasks": task.model_dump(mode="json")}},
        )
        if result.matched_count == 0:
            return None
        return task

    def get_tasks(
        self,
        project_id: str,
        state: TaskState | None = None,
        responsible_agent: str | None = None,
    ) -> list[Task] | None:
        project = self.get_project(project_id)
        if not project:
            return None
        filtered = project.tasks
        if state:
            filtered = [t for t in filtered if t.state == state]
        if responsible_agent:
            filtered = [t for t in filtered if t.responsible_agent == responsible_agent]
        return filtered

    def update_task(
        self,
        project_id: str,
        task_id: str,
        description: str | None = None,
        state: TaskState | None = None,
    ) -> Task | None:
        project = self.get_project(project_id)
        if not project:
            return None
        task = next((t for t in project.tasks if t.id == task_id), None)
        if not task:
            return None

        update_fields: dict = {}
        if description is not None:
            update_fields["tasks.$.description"] = description
        if state is not None:
            update_fields["tasks.$.state"] = state.value

        if update_fields:
            self.collection.update_one(
                {"id": project_id, "tasks.id": task_id},
                {"$set": update_fields},
            )

        if description is not None:
            task.description = description
        if state is not None:
            task.state = state
        return task

    def get_agent_tasks(
        self,
        project_id: str,
        responsible_agent: str,
        state: TaskState | None = None,
    ) -> list[Task] | None:
        project = self.get_project(project_id)
        if not project:
            return None
        filtered = [t for t in project.tasks if t.responsible_agent == responsible_agent]
        if state:
            filtered = [t for t in filtered if t.state == state]
        return filtered

    def update_agent_task(
        self,
        project_id: str,
        task_id: str,
        responsible_agent: str,
        description: str | None = None,
        state: TaskState | None = None,
    ) -> Task | str:
        project = self.get_project(project_id)
        if not project:
            return f'Project with id "{project_id}" not found'
        task = next((t for t in project.tasks if t.id == task_id), None)
        if not task:
            return f'Task with id "{task_id}" not found'
        if task.responsible_agent != responsible_agent:
            return f'Task "{task_id}" is not assigned to "{responsible_agent}"'

        update_fields: dict = {}
        if description is not None:
            update_fields["tasks.$.description"] = description
        if state is not None:
            update_fields["tasks.$.state"] = state.value

        if update_fields:
            self.collection.update_one(
                {"id": project_id, "tasks.id": task_id},
                {"$set": update_fields},
            )

        if description is not None:
            task.description = description
        if state is not None:
            task.state = state
        return task

    def add_subtask(
        self,
        project_id: str,
        task_id: str,
        responsible_agent: str,
        subtask: Subtask,
    ) -> Subtask | str:
        project = self.get_project(project_id)
        if not project:
            return f'Project with id "{project_id}" not found'
        task = next((t for t in project.tasks if t.id == task_id), None)
        if not task:
            return f'Task with id "{task_id}" not found'
        if task.responsible_agent != responsible_agent:
            return f'Task "{task_id}" is not assigned to "{responsible_agent}"'

        self.collection.update_one(
            {"id": project_id, "tasks.id": task_id},
            {"$push": {"tasks.$.subtasks": subtask.model_dump(mode="json")}},
        )
        return subtask
