import { FlatList, Text } from "react-native";
import { useRouter } from "expo-router";
import { useChatStore, useRecents } from "../../src/chat/chatStore";
import { Empty, Row, Screen, StatusDot } from "../../src/components/ui";
import { useTheme } from "../../src/theme";

const LABEL = { idle: "Idle", streaming: "Streaming…", disconnected: "Disconnected" } as const;

export default function ChatsScreen() {
  const router = useRouter();
  const t = useTheme();
  const recents = useRecents((s) => s.recents);
  const chats = useChatStore((s) => s.chats);

  // Running chats first, then most recently used.
  const sorted = [...recents].sort((a, b) => {
    const sa = chats[a.agentId]?.status === "streaming" ? 1 : 0;
    const sb = chats[b.agentId]?.status === "streaming" ? 1 : 0;
    return sb - sa || b.lastUsed - a.lastUsed;
  });

  return (
    <Screen>
      <FlatList
        data={sorted}
        keyExtractor={(r) => r.agentId}
        ListEmptyComponent={<Empty text="Chats you open appear here and keep running in the background." />}
        renderItem={({ item }) => {
          const chat = chats[item.agentId];
          const status = chat?.status ?? "idle";
          const pending = chat?.messages
            .at(-1)
            ?.parts.some(
              (p) =>
                (p.type === "tool_approval" && p.status === "pending") ||
                (p.type === "clarification" && p.status === "pending"),
            );
          return (
            <Row
              title={item.name}
              subtitle={pending ? "⚠️ Waiting for your input" : LABEL[status]}
              right={<StatusDot status={status} />}
              onPress={() =>
                router.push({
                  pathname: "/chat/[agentId]",
                  params: { agentId: item.agentId, name: item.name, projectId: item.projectId },
                })
              }
            />
          );
        }}
      />
      <Text style={{ color: t.muted, textAlign: "center", padding: 12, fontSize: 12 }}>
        One stream per agent. Different agents can run at the same time.
      </Text>
    </Screen>
  );
}
