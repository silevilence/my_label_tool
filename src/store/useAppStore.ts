import { create } from "zustand";

interface AppState {
  isReady: boolean;
  setReady: (isReady: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  isReady: false,
  setReady: (isReady) => set({ isReady }),
}));
