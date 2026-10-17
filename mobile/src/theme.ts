import { useColorScheme } from "react-native";

const light = {
  bg: "#ffffff",
  card: "#f3f4f6",
  text: "#111827",
  muted: "#6b7280",
  border: "#e5e7eb",
  primary: "#2563eb",
  onPrimary: "#ffffff",
  danger: "#dc2626",
  success: "#16a34a",
  userBubble: "#2563eb",
  onUserBubble: "#ffffff",
};

const dark: typeof light = {
  bg: "#0b0f19",
  card: "#161b28",
  text: "#f3f4f6",
  muted: "#9ca3af",
  border: "#262c3b",
  primary: "#3b82f6",
  onPrimary: "#ffffff",
  danger: "#f87171",
  success: "#4ade80",
  userBubble: "#2563eb",
  onUserBubble: "#ffffff",
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === "dark" ? dark : light;
}
