from textual.app import ComposeResult
from textual.containers import Horizontal, VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Header, Input, Markdown, OptionList, Static
from textual.widgets.option_list import Option

from components.api import observe_agent, stream_chat

SLASH_ITEMS = [
    {"label": "explorer", "kind": "agent"},
    {"label": "planner", "kind": "agent"},
    {"label": "wiki-writer", "kind": "agent"},
    {"label": "explore-and-plan", "kind": "workflow"},
    {"label": "full-implementation", "kind": "workflow"},
]


class UserBubble(Static):
    """Plain text bubble for user messages."""

    def __init__(self, text: str) -> None:
        super().__init__(text)
        self.add_class("user")


class AssistantBubble(Markdown):
    """Markdown-rendered bubble for assistant messages."""

    def __init__(self, text: str = "") -> None:
        super().__init__(text)
        self.add_class("assistant")


class ChatScreen(Screen):
    DEFAULT_CSS = """
    #message-area {
        height: 1fr;
        width: 100%;
        padding: 1 2;
    }

    #chat-input {
        dock: bottom;
        width: 100%;
        margin: 0 2 1 2;
    }

    #slash-menu {
        height: 1fr;
        width: 100%;
        padding: 1 2;
        display: none;
    }

    #slash-menu.visible {
        display: block;
    }

    #message-area.hidden {
        display: none;
    }

    .user {
        background: $primary-darken-2;
        color: $text;
        margin: 1 0 1 10;
        padding: 1 2;
    }

    .assistant {
        background: $surface;
        color: $text;
        margin: 1 10 1 0;
        padding: 1 2;
        min-height: 3;
    }

    .tool-info {
        color: $text-muted;
        margin: 0 10 0 0;
        padding: 0 2;
        text-style: italic;
    }

    #explore-panels {
        height: 1fr;
        width: 100%;
    }

    .agent-panel {
        width: 1fr;
        height: 100%;
        border: solid $primary;
        overflow-y: auto;
        padding: 0 1;
    }

    .panel-title {
        background: $surface;
        text-style: bold;
        padding: 0 1;
        width: 100%;
        text-align: center;
    }
    """

    def __init__(self, session_id: str, agent_name: str) -> None:
        super().__init__()
        self.session_id = session_id
        self.agent_name = agent_name
        self._streaming = False
        self._current_bubble: AssistantBubble | None = None
        self._current_text = ""
        # Track per-panel state for explore_repos
        self._panel_bubbles: dict[str, AssistantBubble] = {}
        self._panel_texts: dict[str, str] = {}

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="message-area")
        yield OptionList(id="slash-menu")
        yield Input(placeholder="Type a message...", id="chat-input")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = self.agent_name
        self.query_one("#chat-input", Input).focus()

    def _show_slash_menu(self, query: str = "") -> None:
        menu = self.query_one("#slash-menu", OptionList)
        message_area = self.query_one("#message-area")

        matches = [item for item in SLASH_ITEMS if query in item["label"].lower()]

        menu.clear_options()
        for item in matches:
            kind_tag = f"[dim]{item['kind']}[/dim]"
            menu.add_option(Option(f"/{item['label']}  {kind_tag}", id=item["label"]))

        if matches:
            message_area.add_class("hidden")
            menu.add_class("visible")
            menu.highlighted = 0
        else:
            self._hide_slash_menu()

    def _hide_slash_menu(self) -> None:
        self.query_one("#slash-menu", OptionList).remove_class("visible")
        self.query_one("#message-area").remove_class("hidden")
        self.query_one("#chat-input", Input).focus()

    def on_input_changed(self, event: Input.Changed) -> None:
        text = event.value
        if text.startswith("/"):
            self._show_slash_menu(text[1:].lower())
        else:
            self._hide_slash_menu()

    def on_key(self, event) -> None:
        menu = self.query_one("#slash-menu", OptionList)
        if not menu.has_class("visible"):
            return

        if event.key in ("up", "down"):
            event.prevent_default()
            menu.focus()
        elif event.key == "escape":
            self._hide_slash_menu()
            self.query_one("#chat-input", Input).clear()

    def on_option_list_option_selected(self, event: OptionList.OptionSelected) -> None:
        self._hide_slash_menu()

        chat_input = self.query_one("#chat-input", Input)
        chat_input.value = f"/{event.option_id} "
        chat_input.focus()
        chat_input.cursor_position = len(chat_input.value)

    def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text or self._streaming:
            return

        event.input.clear()

        message_area = self.query_one("#message-area")
        message_area.mount(UserBubble(text))
        message_area.scroll_end(animate=False)

        self._streaming = True
        self.query_one("#chat-input", Input).disabled = True
        self.run_worker(self._stream_response(text), exclusive=True)

    async def _stream_response(self, text: str) -> None:
        message_area = self.query_one("#message-area")

        self._current_text = ""
        self._current_bubble = None
        needs_new_bubble = True

        try:
            async for event in stream_chat(self.session_id, text):
                event_type = event.get("type")

                if event_type == "delta":
                    if needs_new_bubble or self._current_bubble is None:
                        self._current_text = ""
                        self._current_bubble = AssistantBubble()
                        message_area.mount(self._current_bubble)
                        needs_new_bubble = False
                    self._current_text += event.get("text", "")
                    self._current_bubble.update(self._current_text)
                    self.call_after_refresh(message_area.scroll_end, animate=False)

                elif event_type == "tool_start":
                    name = event.get("name", "unknown")
                    info = Static(f"  [tool: {name}]", classes="tool-info")
                    message_area.mount(info)
                    self.call_after_refresh(message_area.scroll_end, animate=False)

                elif event_type == "sub_agents_spawned":
                    sub_agents = event.get("subAgents", [])
                    if sub_agents:
                        await self._show_parallel_panels(sub_agents)

                elif event_type == "tool_end":
                    name = event.get("name", "unknown")
                    is_error = event.get("isError", False)
                    status = "error" if is_error else "done"
                    info = Static(f"  [tool: {name} — {status}]", classes="tool-info")
                    message_area.mount(info)
                    self.call_after_refresh(message_area.scroll_end, animate=False)
                    needs_new_bubble = True

                    if name == "explore_repos":
                        self._collapse_panels()

                elif event_type == "done":
                    break

                elif event_type == "error":
                    error_msg = event.get("message", "Unknown error")
                    if self._current_bubble is None:
                        self._current_bubble = AssistantBubble()
                        message_area.mount(self._current_bubble)
                    self._current_bubble.update(
                        self._current_text + f"\n\n**Error:** {error_msg}"
                    )
                    break

        except Exception as e:
            if self._current_bubble:
                self._current_bubble.update(f"**Connection error:** {e}")
        finally:
            self._streaming = False
            self._current_bubble = None
            chat_input = self.query_one("#chat-input", Input)
            chat_input.disabled = False
            chat_input.focus()

    async def _show_parallel_panels(self, sub_agent_ids: list[str]) -> None:
        """Create side-by-side panels and stream each sub-agent into its own panel."""
        message_area = self.query_one("#message-area")

        # Build panel widgets
        panels = []
        for agent_id in sub_agent_ids:
            label = agent_id.replace("explorer-sub-", "")
            bubble = AssistantBubble()
            self._panel_bubbles[agent_id] = bubble
            self._panel_texts[agent_id] = ""
            panel = VerticalScroll(
                Static(f"[bold]{label}[/bold]", classes="panel-title"),
                bubble,
                classes="agent-panel",
                id=f"panel-{agent_id}",
            )
            panels.append(panel)

        container = Horizontal(*panels, id="explore-panels")
        message_area.mount(container)
        message_area.scroll_end(animate=False)

        # Launch a parallel worker per sub-agent
        for agent_id in sub_agent_ids:
            self.run_worker(
                self._stream_sub_agent(agent_id),
                group=f"observe-{agent_id}",
                exclusive=False,
                exit_on_error=False,
            )

    async def _stream_sub_agent(self, agent_id: str) -> None:
        """Stream events from a sub-agent's observe endpoint into its panel."""
        bubble = self._panel_bubbles.get(agent_id)
        if not bubble:
            return

        try:
            async for event in observe_agent(agent_id):
                event_type = event.get("type")

                if event_type == "delta":
                    self._panel_texts[agent_id] += event.get("text", "")
                    bubble.update(self._panel_texts[agent_id])
                    panel = bubble.parent
                    if panel:
                        self.call_after_refresh(panel.scroll_end, animate=False)

                elif event_type == "tool_start":
                    name = event.get("name", "unknown")
                    info = Static(f"  [{name}]", classes="tool-info")
                    panel = bubble.parent
                    if panel:
                        panel.mount(info)
                        self.call_after_refresh(panel.scroll_end, animate=False)

                elif event_type == "tool_end":
                    name = event.get("name", "unknown")
                    is_error = event.get("isError", False)
                    status = "err" if is_error else "ok"
                    info = Static(f"  [{name} — {status}]", classes="tool-info")
                    panel = bubble.parent
                    if panel:
                        panel.mount(info)
                        self.call_after_refresh(panel.scroll_end, animate=False)

                elif event_type == "done":
                    break

        except Exception as e:
            if bubble:
                bubble.update(f"**Observe error:** {e}")

    def _collapse_panels(self) -> None:
        """Remove the parallel panels container after explore_repos finishes."""
        try:
            container = self.query_one("#explore-panels")
            container.remove()
        except Exception:
            pass
        self._panel_bubbles.clear()
        self._panel_texts.clear()
