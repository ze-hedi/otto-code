import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { DEFAULT_BASE_URL, normalizeBaseUrl, useSettings } from "../../src/settings";
import { Button, Screen } from "../../src/components/ui";
import { useTheme } from "../../src/theme";

export default function SettingsScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const baseUrl = useSettings((s) => s.baseUrl);
  const setBaseUrl = useSettings((s) => s.setBaseUrl);
  const [value, setValue] = useState(baseUrl);
  const [result, setResult] = useState<string | null>(null);

  async function test() {
    setResult("Testing…");
    try {
      const res = await fetch(`${normalizeBaseUrl(value)}/projects`);
      setResult(res.ok ? "✅ Connected" : `❌ HTTP ${res.status}`);
    } catch (e) {
      setResult(`❌ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function save() {
    setBaseUrl(value);
    qc.clear();
    setResult("Saved");
  }

  return (
    <Screen>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ color: t.text, fontWeight: "600" }}>Backend URL</Text>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={DEFAULT_BASE_URL}
          placeholderTextColor={t.muted}
          style={{ borderWidth: 1, borderColor: t.border, borderRadius: 8, padding: 10, color: t.text }}
        />
        <Text style={{ color: t.muted, fontSize: 12 }}>
          On a physical phone use your computer's LAN IP, e.g. http://192.168.1.20:4000 — not localhost.
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Test" kind="ghost" onPress={test} />
          <Button title="Save" onPress={save} />
        </View>
        {result ? <Text style={{ color: t.text }}>{result}</Text> : null}
      </View>
    </Screen>
  );
}
