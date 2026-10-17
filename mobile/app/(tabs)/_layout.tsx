import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useTheme } from "../../src/theme";

const icon = (glyph: string) => () => <Text style={{ fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: t.bg },
        headerTintColor: t.text,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        tabBarActiveTintColor: t.primary,
        tabBarInactiveTintColor: t.muted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Projects", tabBarIcon: icon("📁") }} />
      <Tabs.Screen name="chats" options={{ title: "Chats", tabBarIcon: icon("💬") }} />
      <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("⚙️") }} />
    </Tabs>
  );
}
