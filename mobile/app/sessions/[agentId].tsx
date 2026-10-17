import { Alert, FlatList, Pressable, Text } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { deleteSession, listSessions } from "../../src/api/agents";
import { getChat } from "../../src/chat/chatStore";
import { resumeSession } from "../../src/chat/ChatManager";
import { Empty, ErrorText, Row, Screen } from "../../src/components/ui";
import { useTheme } from "../../src/theme";

export default function SessionsScreen() {
  const { agentId } = useLocalSearchParams<{ agentId: string }>();
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const key = ["sessions", agentId];

  const q = useQuery({ queryKey: key, queryFn: () => listSessions(agentId) });
  const remove = useMutation({
    mutationFn: (sessionKey: string) => deleteSession(agentId, sessionKey),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => Alert.alert("Delete failed", String(e)),
  });

  const busy = () => getChat(agentId).status === "streaming";

  async function resume(filename: string) {
    if (busy()) return Alert.alert("Agent is busy", "Wait for the current run to finish or stop it.");
    try {
      await resumeSession(agentId, filename);
      router.back();
    } catch (e) {
      Alert.alert("Cannot resume", e instanceof Error ? e.message : String(e));
    }
  }

  function confirmDelete(sessionKey: string) {
    if (busy()) return Alert.alert("Agent is busy", "Wait for the current run to finish or stop it.");
    Alert.alert("Delete session", "This permanently deletes the session file.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => remove.mutate(sessionKey) },
    ]);
  }

  const sessions = [...(q.data ?? [])].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return (
    <Screen>
      {q.isError ? <ErrorText error={q.error} onRetry={() => q.refetch()} /> : null}
      <FlatList
        data={sessions}
        keyExtractor={(s) => s.filename}
        ListEmptyComponent={q.isLoading || q.isError ? null : <Empty text="No saved sessions." />}
        renderItem={({ item }) => (
          <Row
            title={item.createdAt ? new Date(item.createdAt).toLocaleString() : item.sessionKey}
            subtitle={`${item.sessionKey} · ${(item.sizeBytes / 1024).toFixed(1)} KB`}
            onPress={() => resume(item.filename)}
            right={
              <Pressable onPress={() => confirmDelete(item.sessionKey)} hitSlop={10}>
                <Text style={{ color: t.danger }}>Delete</Text>
              </Pressable>
            }
          />
        )}
      />
    </Screen>
  );
}
