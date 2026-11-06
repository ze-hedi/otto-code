import { useEffect } from "react";
import { AppState } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useSettings } from "../src/settings";
import { useRecents } from "../src/chat/chatStore";
import { openChat, resyncAll } from "../src/chat/ChatManager";
import { useTheme } from "../src/theme";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout() {
  const hydrated = useSettings((s) => s.hydrated);
  const t = useTheme();

  // After a restart, find out which recent chats are still running server-side.
  useEffect(() => {
    if (!hydrated) return;
    for (const r of useRecents.getState().recents.slice(0, 10)) void openChat(r.agentId);
  }, [hydrated]);

  // Sockets die while backgrounded; the server-side run does not.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") resyncAll();
    });
    return () => sub.remove();
  }, []);

  if (!hydrated) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.bg },
          headerTintColor: t.text,
          contentStyle: { backgroundColor: t.bg },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="project/[id]" options={{ title: "Project" }} />
        <Stack.Screen name="chat/[agentId]" options={{ title: "Chat" }} />
        <Stack.Screen name="sessions/[agentId]" options={{ title: "Sessions" }} />
      </Stack>
    </QueryClientProvider>
  );
}
