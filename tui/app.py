from textual.app import App

from components.agent_list import AgentListScreen


class TuiApp(App):
    TITLE = "Otto Code"
    CSS_PATH = None

    def on_mount(self) -> None:
        self.push_screen(AgentListScreen())


def main():
    app = TuiApp()
    app.run()


if __name__ == "__main__":
    main()
