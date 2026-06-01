from textual.app import ComposeResult
from textual.containers import Center, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Header, ListItem, ListView, Static

from components.api import fetch_agents, start_session


class AgentItem(ListItem):
    def __init__(self, agent: dict) -> None:
        super().__init__()
        self.agent = agent

    def compose(self) -> ComposeResult:
        yield Static(f"[bold]{self.agent['name']}[/bold]")
        yield Static(
            self.agent.get("description", ""),
            classes="agent-description",
        )


class AgentListScreen(Screen):
    DEFAULT_CSS = """
    #agent-list-title {
        text-align: center;
        text-style: bold;
        padding: 1 0;
        color: $text-muted;
        width: 100%;
        content-align: center middle;
    }

    #loading {
        text-align: center;
        color: $text-muted;
        width: 100%;
        content-align: center middle;
        height: 1fr;
    }

    ListView {
        height: 1fr;
        margin: 0 2;
    }

    ListItem {
        padding: 1 2;
    }

    .agent-description {
        color: $text-muted;
    }

    #error-msg {
        text-align: center;
        color: $error;
        width: 100%;
        content-align: center middle;
        height: 1fr;
    }
    """

    def compose(self) -> ComposeResult:
        yield Header()
        yield Static("Select an Agent", id="agent-list-title")
        yield Center(Static("Loading agents...", id="loading"))
        yield Footer()

    def on_mount(self) -> None:
        self.run_worker(self._load_agents(), exclusive=True)

    async def _load_agents(self) -> None:
        try:
            agents = await fetch_agents()
        except Exception as e:
            loading = self.query_one("#loading")
            loading.update(f"Failed to load agents: {e}")
            loading.id = "error-msg"
            return

        loading = self.query_one("#loading")
        loading.remove()

        items = [AgentItem(agent) for agent in agents]
        list_view = ListView(*items)
        self.mount(list_view, before=self.query_one(Footer))
        list_view.focus()

    async def on_list_view_selected(self, event: ListView.Selected) -> None:
        item = event.item
        if not isinstance(item, AgentItem):
            return

        agent = item.agent

        try:
            result = await start_session(agent)
        except Exception as e:
            self.notify(f"Failed to start session: {e}", severity="error")
            return

        session_id = result["sessionId"]

        from components.chat import ChatScreen

        self.app.push_screen(ChatScreen(session_id=session_id, agent_name=agent["name"]))
