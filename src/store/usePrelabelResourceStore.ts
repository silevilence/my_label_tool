import { create } from "zustand";
import { loadPrelabelResourceLimits, savePrelabelResourceLimits } from "../lib/tauri-api";
import { validatePrelabelResourceLimits } from "../lib/prelabel-resource-limits";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../i18n/prelabel-resource.zh-CN";
import type { PrelabelResourceLimits } from "../types/prelabel";

interface ResourceState {
  limits: PrelabelResourceLimits | null;
  loading: boolean;
  saving: boolean;
  error: string;
  load: () => Promise<void>;
  save: (limits: PrelabelResourceLimits) => Promise<void>;
}

export const usePrelabelResourceStore = create<ResourceState>((set, get) => ({
  limits: null,
  loading: false,
  saving: false,
  error: "",
  load: async () => {
    if (get().loading || get().saving) return;
    set({ loading: true, error: "" });
    try {
      const limits = await loadPrelabelResourceLimits();
      const error = validatePrelabelResourceLimits(limits);
      if (error) throw new Error(error);
      set({ limits: { ...limits }, error: "" });
    } catch (error) {
      set({ limits: null, error: text.loadFailed(error) });
    } finally {
      set({ loading: false });
    }
  },
  save: async (limits) => {
    if (get().saving || get().loading) {
      set({ error: text.busy });
      throw new Error(text.busy);
    }
    const error = validatePrelabelResourceLimits(limits);
    if (error) throw new Error(error);
    set({ saving: true, error: "" });
    try {
      await savePrelabelResourceLimits(limits);
      set({ limits: { ...limits }, error: "" });
    } catch (error) {
      set({ error: text.saveFailed(error) });
      throw error;
    } finally {
      set({ saving: false });
    }
  },
}));
