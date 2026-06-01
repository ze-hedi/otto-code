from textual.app import ComposeResult
from textual.containers import VerticalScroll
from textual.screen import Screen
from textual.widgets import Footer, Header, Input, Static

from components.api import stream_chat


class MessageBubble(Static):
    def __init__(self, text: str, role: str = "user") -> None:
        super().__init__(text)
        self.role = role
        self.add_class(role)


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
    }

    .tool-info {
        color: $text-muted;
        margin: 0 10 0 0;
        padding: 0 2;
        text-style: italic;
    }
    """

    def __init__(self, session_id: str, agent_name: str) -> None:
        super().__init__()
        self.session_id = session_id
        self.agent_name = agent_name
        self._streaming = False
        self._current_bubble: MessageBubble | None = None
        self._current_text = ""

    def compose(self) -> ComposeResult:
        yield Header()
        yield VerticalScroll(id="message-area")
        yield Input(placeholder="Type a message...", id="chat-input")
        yield Footer()

    def on_mount(self) -> None:
        self.sub_title = self.agent_name
        self.query_one("#chat-input", Input).focus()

    def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text or self._streaming:
            return

        event.input.clear()

        message_area = self.query_one("#message-area")
        message_area.mount(MessageBubble(text, role="user"))
        message_area.scroll_end(animate=False)

        self._streaming = True
        self.query_one("#chat-input", Input).disabled = True
        self.run_worker(self._stream_response(text), exclusive=True)

    async def _stream_response(self, text: str) -> None:
        message_area = self.query_one("#message-area")

        self._current_text = ""
        self._current_bubble = MessageBubble("", role="assistant")
        message_area.mount(self._current_bubble)

        try:
            async for event in stream_chat(self.session_id, text):
                event_type = event.get("type")

                if event_type == "delta":
                    self._current_text += event.get("text", "")
                    self._current_bubble.update(self._current_text)
                    message_area.scroll_end(animate=False)

                elif event_type == "tool_start":
                    name = event.get("name", "unknown")
                    info = Static(f"  [tool: {name}]", classes="tool-info")
                    message_area.mount(info)
                    message_area.scroll_end(animate=False)

                elif event_type == "tool_end":
                    name = event.get("name", "unknown")
                    is_error = event.get("isError", False)
                    status = "error" if is_error else "done"
                    info = Static(f"  [tool: {name} — {status}]", classes="tool-info")
                    message_area.mount(info)
                    message_area.scroll_end(animate=False)

                elif event_type == "done":
                    break

                elif event_type == "error":
                    error_msg = event.get("message", "Unknown error")
                    self._current_bubble.update(
                        self._current_text + f"\n\n[red]Error: {error_msg}[/red]"
                    )
                    break

        except Exception as e:
            if self._current_bubble:
                self._current_bubble.update(f"[red]Connection error: {e}[/red]")
        finally:
            self._streaming = False
            self._current_bubble = None
            chat_input = self.query_one("#chat-input", Input)
            chat_input.disabled = False
            chat_input.focus()
