import { FlatList, RefreshControl } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { listProjects } from "../../src/api/projects";
import { Empty, ErrorText, Row, Screen } from "../../src/components/ui";

export default function ProjectsScreen() {
  const router = useRouter();
  const q = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  return (
    <Screen>
      {q.isError ? <ErrorText error={q.error} onRetry={() => q.refetch()} /> : null}
      <FlatList
        data={q.data ?? []}
        keyExtractor={(p) => p.project_id}
        refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={() => q.refetch()} />}
        ListEmptyComponent={
          q.isLoading || q.isError ? null : <Empty text="No projects yet. Create one in the web app." />
        }
        renderItem={({ item }) => (
          <Row
            title={item.name}
            subtitle={item.description || item.path}
            onPress={() => router.push({ pathname: "/project/[id]", params: { id: item.project_id } })}
          />
        )}
      />
    </Screen>
  );
}
