from textual.app import App

from components.api import EXPLORER_SESSION_ID
from components.chat import ChatScreen


class TuiApp(App):
    TITLE = "Otto Code"
    CSS_PATH = None

    def on_mount(self) -> None:
        self.push_screen(ChatScreen(session_id=EXPLORER_SESSION_ID, agent_name="Explorer"))


def main():
    app = TuiApp()
    app.run()


if __name__ == "__main__":
    main()
