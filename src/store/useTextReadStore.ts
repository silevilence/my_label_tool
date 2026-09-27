import { create } from "zustand";

/** A configuration change retries failed startup reads without replacing drafts. */
export const useTextReadStore = create<{ revision: number; changed(): void }>((set) => ({
  revision: 0,
  changed: () => set((state) => ({ revision: state.revision + 1 })),
}));
