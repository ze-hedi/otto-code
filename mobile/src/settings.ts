import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsState {
  baseUrl: string;
  hydrated: boolean;
  setBaseUrl: (url: string) => void;
}

export const DEFAULT_BASE_URL = "http://localhost:4000";

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      baseUrl: DEFAULT_BASE_URL,
      hydrated: false,
      setBaseUrl: (url) => set({ baseUrl: normalizeBaseUrl(url) }),
    }),
    {
      name: "otto-settings",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ baseUrl: s.baseUrl }),
      onRehydrateStorage: () => () => useSettings.setState({ hydrated: true }),
    },
  ),
);
