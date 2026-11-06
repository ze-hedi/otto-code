import { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../theme";

export function Screen({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <View style={{ flex: 1, backgroundColor: t.bg }}>{children}</View>;
}

export function Button({
  title,
  onPress,
  kind = "primary",
  disabled,
}: {
  title: string;
  onPress: () => void;
  kind?: "primary" | "danger" | "ghost";
  disabled?: boolean;
}) {
  const t = useTheme();
  const bg = kind === "primary" ? t.primary : kind === "danger" ? t.danger : "transparent";
  const color = kind === "ghost" ? t.primary : t.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        kind === "ghost" && { borderWidth: 1, borderColor: t.border },
      ]}
    >
      <Text style={{ color, fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}

export function Row({
  title,
  subtitle,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderColor: t.border, backgroundColor: pressed ? t.card : "transparent" },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: "600" }} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={{ color: t.muted, marginTop: 2 }} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

export function StatusDot({ status }: { status: "idle" | "streaming" | "disconnected" }) {
  const t = useTheme();
  if (status === "streaming") return <ActivityIndicator size="small" color={t.primary} />;
  const color = status === "disconnected" ? t.danger : t.muted;
  return <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />;
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.muted, textAlign: "center", marginTop: 48, paddingHorizontal: 24 }}>{text}</Text>;
}

export function ErrorText({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useTheme();
  const message = error instanceof Error ? error.message : String(error);
  return (
    <View style={{ padding: 24, alignItems: "center", gap: 12 }}>
      <Text style={{ color: t.danger, textAlign: "center" }}>{message}</Text>
      {onRetry ? <Button title="Retry" onPress={onRetry} kind="ghost" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
