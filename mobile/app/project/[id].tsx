import { FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { listProjects } from "../../src/api/projects";
import { listAgents } from "../../src/api/agents";
import { agentLabel } from "../../src/api/types";
import { useChatStore } from "../../src/chat/chatStore";
import { Empty, ErrorText, Row, Screen, StatusDot } from "../../src/components/ui";

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const chats = useChatStore((s) => s.chats);

  const project = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    select: (all) => all.find((p) => p.project_id === id),
  });
  const path = project.data?.path;
  const agents = useQuery({
    queryKey: ["agents", path],
    queryFn: () => listAgents(path),
    enabled: !!path,
  });

  const error = project.error ?? agents.error;

  return (
    <Screen>
      <Stack.Screen options={{ title: project.data?.name ?? "Project" }} />
      {error ? <ErrorText error={error} onRetry={() => (project.isError ? project.refetch() : agents.refetch())} /> : null}
      <FlatList
        data={agents.data ?? []}
        keyExtractor={(a) => a.agent_id}
        refreshControl={<RefreshControl refreshing={agents.isFetching} onRefresh={() => agents.refetch()} />}
        ListEmptyComponent={
          agents.isLoading || error ? null : <Empty text="No agents in this project." />
        }
        renderItem={({ item }) => (
          <Row
            title={agentLabel(item)}
            subtitle={item.config.description ?? item.config.model}
            right={<StatusDot status={chats[item.agent_id]?.status ?? "idle"} />}
            onPress={() =>
              router.push({
                pathname: "/chat/[agentId]",
                params: { agentId: item.agent_id, name: agentLabel(item), projectId: id },
              })
            }
          />
        )}
      />
    </Screen>
  );
}
