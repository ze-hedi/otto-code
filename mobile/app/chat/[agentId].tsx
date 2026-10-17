import { useEffect, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useChatStore, useRecents } from "../../src/chat/chatStore";
import { openChat, resync, sendMessage, startNewSession, stopChat } from "../../src/chat/ChatManager";
import { MessageView } from "../../src/components/MessageView";
import { Button, Empty, Screen } from "../../src/components/ui";
import { useTheme } from "../../src/theme";

export default function ChatScreen() {
  const { agentId, name, projectId } = useLocalSearchParams<{
    agentId: string;
    name?: string;
    projectId?: string;
  }>();
  const t = useTheme();
  const router = useRouter();
  const chat = useChatStore((s) => s.chats[agentId]);
  const [input, setInput] = useState("");
  const listRef = useRef<FlatList>(null);

  const streaming = chat?.status === "streaming";

  useEffect(() => {
    useRecents.getState().touch({ agentId, name: name ?? agentId.slice(0, 8), projectId });
    void openChat(agentId); // no-op if a stream is already live
  }, [agentId, name, projectId]);

  useEffect(() => {
    if (!streaming) return;
    const tag = `chat-${agentId}`;
    void activateKeepAwakeAsync(tag);
    return () => {
      void deactivateKeepAwake(tag);
    };
  }, [streaming, agentId]);

  function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput("");
    void sendMessage(agentId, text);
  }

  function newSession() {
    Alert.alert("New session", "Start a fresh conversation with this agent?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Start",
        onPress: () =>
          startNewSession(agentId).catch((e) => Alert.alert("Cannot start session", String(e.message ?? e))),
      },
    ]);
  }

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: name ?? "Chat",
          headerRight: () => (
            <View style={{ flexDirection: "row", gap: 16 }}>
              <Pressable onPress={() => router.push({ pathname: "/sessions/[agentId]", params: { agentId } })}>
                <Text style={{ color: t.primary }}>Sessions</Text>
              </Pressable>
              <Pressable onPress={newSession} disabled={streaming}>
                <Text style={{ color: streaming ? t.muted : t.primary }}>New</Text>
              </Pressable>
            </View>
          ),
        }}
      />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}
      >
        {chat?.status === "disconnected" ? (
          <View style={{ backgroundColor: t.card, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: t.danger, flex: 1 }} numberOfLines={2}>
              Connection lost{chat.error ? `: ${chat.error}` : ""}
            </Text>
            <Button title="Reconnect" kind="ghost" onPress={() => resync(agentId)} />
          </View>
        ) : null}

        <FlatList
          ref={listRef}
          data={chat?.messages ?? []}
          keyExtractor={(_, i) => String(i)}
          renderItem={({ item }) => <MessageView agentId={agentId} message={item} />}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingVertical: 8, flexGrow: 1 }}
          ListEmptyComponent={
            chat?.loaded ? <Empty text="Say something to start the conversation." /> : null
          }
        />

        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 10, borderTopWidth: 1, borderColor: t.border }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={streaming ? "Agent is working…" : "Message"}
            placeholderTextColor={t.muted}
            multiline
            style={{
              flex: 1,
              maxHeight: 140,
              borderWidth: 1,
              borderColor: t.border,
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              color: t.text,
            }}
          />
          {streaming ? (
            <Button title="Stop" kind="danger" onPress={() => stopChat(agentId)} />
          ) : (
            <Button title="Send" onPress={send} disabled={!input.trim()} />
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
