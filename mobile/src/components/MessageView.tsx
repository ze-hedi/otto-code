import { memo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Markdown from "react-native-markdown-display";
import { useTheme } from "../theme";
import { Button } from "./ui";
import type { ChatMessage, MessagePart, SubAgentPart } from "../chat/types";
import { answerClarification, approveTool, rejectTool } from "../chat/ChatManager";

function Collapsible({
  title,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const t = useTheme();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
      <Pressable onPress={() => setOpen((o) => !o)} style={styles.cardHeader}>
        <Text style={{ color: t.text, fontWeight: "600", flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
        {badge ? <Text style={{ color: t.muted }}>{badge}</Text> : null}
        <Text style={{ color: t.muted }}>{open ? "▾" : "▸"}</Text>
      </Pressable>
      {open ? <View style={{ paddingTop: 8, gap: 8 }}>{children}</View> : null}
    </View>
  );
}

function Mono({ text, color }: { text: string; color?: string }) {
  const t = useTheme();
  return (
    <Text selectable style={{ fontFamily: "Courier", fontSize: 12, color: color ?? t.text }}>
      {text}
    </Text>
  );
}

function ToolCard({ part }: { part: Extract<SubAgentPart, { type: "tool" }> }) {
  const t = useTheme();
  const badge = part.status === "running" ? "running…" : part.isError ? "error" : "done";
  return (
    <Collapsible title={`🔧 ${part.name}`} badge={badge}>
      <Mono text={part.input} />
      {part.result !== undefined ? <Mono text={part.result} color={part.isError ? t.danger : t.muted} /> : null}
    </Collapsible>
  );
}

function PartView({ agentId, part }: { agentId: string; part: MessagePart | SubAgentPart }) {
  const t = useTheme();
  const [answers, setAnswers] = useState<string[] | null>(null);

  switch (part.type) {
    case "thinking":
      return (
        <Collapsible title="💭 Thinking">
          <Text style={{ color: t.muted, fontStyle: "italic" }}>{part.content}</Text>
        </Collapsible>
      );
    case "text":
      return (
        <Markdown
          style={{
            body: { color: t.text, fontSize: 15 },
            code_inline: { backgroundColor: t.card, color: t.text },
            fence: { backgroundColor: t.card, color: t.text, borderColor: t.border },
            code_block: { backgroundColor: t.card, color: t.text, borderColor: t.border },
            link: { color: t.primary },
          }}
        >
          {part.content}
        </Markdown>
      );
    case "tool":
      return <ToolCard part={part} />;
    case "subagent":
      return (
        <Collapsible
          title={`🤖 ${part.toolName}`}
          badge={part.status === "running" ? "running…" : part.isError ? "error" : "done"}
        >
          {part.parts.map((p, i) => (
            <PartView key={i} agentId={agentId} part={p} />
          ))}
          {part.result ? <Mono text={part.result} color={t.muted} /> : null}
        </Collapsible>
      );
    case "tool_approval":
      return (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.primary }]}>
          <Text style={{ color: t.text, fontWeight: "700" }}>Approval needed: {part.toolName}</Text>
          <Mono text={part.args} />
          {part.status === "pending" ? (
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Button title="Approve" onPress={() => approveTool(agentId, part.toolCallId)} />
              <Button title="Reject" kind="danger" onPress={() => rejectTool(agentId, part.toolCallId)} />
            </View>
          ) : (
            <Text style={{ color: part.status === "approved" ? t.success : t.danger, marginTop: 6 }}>
              {part.status}
            </Text>
          )}
        </View>
      );
    case "clarification": {
      const values = answers ?? part.answers;
      return (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.primary }]}>
          <Text style={{ color: t.text, fontWeight: "700", marginBottom: 6 }}>The agent has questions</Text>
          {part.questions.map((q, i) => (
            <View key={i} style={{ marginBottom: 8 }}>
              <Text style={{ color: t.text }}>{q}</Text>
              <TextInput
                editable={part.status === "pending"}
                value={values[i] ?? ""}
                onChangeText={(v) => {
                  const next = [...values];
                  next[i] = v;
                  setAnswers(next);
                }}
                placeholder="Your answer"
                placeholderTextColor={t.muted}
                style={[styles.input, { color: t.text, borderColor: t.border }]}
                multiline
              />
            </View>
          ))}
          {part.status === "pending" ? (
            <Button title="Send answers" onPress={() => answerClarification(agentId, part.toolCallId, values)} />
          ) : (
            <Text style={{ color: t.success }}>answered</Text>
          )}
        </View>
      );
    }
  }
}

export const MessageView = memo(function MessageView({
  agentId,
  message,
}: {
  agentId: string;
  message: ChatMessage;
}) {
  const t = useTheme();
  if (message.role === "user") {
    return (
      <View style={[styles.userBubble, { backgroundColor: t.userBubble }]}>
        <Text selectable style={{ color: t.onUserBubble, fontSize: 15 }}>
          {message.content}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: 8, paddingHorizontal: 12, marginVertical: 6 }}>
      {message.parts.map((p, i) => (
        <PartView key={i} agentId={agentId} part={p} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginHorizontal: 12,
    marginVertical: 6,
  },
  card: { borderWidth: 1, borderRadius: 10, padding: 10 },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4 },
});
