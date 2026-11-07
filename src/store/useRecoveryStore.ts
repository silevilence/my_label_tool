import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_AUTOSAVE } from "../lib/defaults/autosave";
import { validAutosaveSettings, type RecoveryStatus } from "../lib/recovery";
import type { AutosaveSettings } from "../types/recovery";

interface RecoveryState {
  settings: AutosaveSettings;
  status: RecoveryStatus;
  retry: (() => void) | null;
  resolveConflict: (() => void) | null;
  openArchives: (() => void) | null;
  manualPending: number;
  setSettings: (settings: AutosaveSettings) => void;
}
export const useRecoveryStore = create<RecoveryState>()(
  persist(
    (set) => ({
      settings: DEFAULT_AUTOSAVE,
      status: { saving: false, dirty: false, savedAt: "", error: "" },
      retry: null,
      resolveConflict: null,
      openArchives: null,
      manualPending: 0,
      setSettings: (settings) => {
        if (validAutosaveSettings(settings)) set({ settings });
      },
    }),
    {
      name: "my-label-tool-autosave",
      partialize: (state) => ({ settings: state.settings }),
      merge: (persisted, current) => {
        const saved = persisted as { settings?: AutosaveSettings } | undefined;
        return {
          ...current,
          settings:
            saved?.settings && validAutosaveSettings(saved.settings)
              ? saved.settings
              : DEFAULT_AUTOSAVE,
        };
      },
    },
  ),
);
