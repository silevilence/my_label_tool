import { create } from "zustand";
import { DEFAULT_SHORTCUTS, type ShortcutMap } from "../lib/defaults/shortcuts";

type Handler = (event: KeyboardEvent) => void;
interface Registration {
  token: symbol;
  handler: Handler;
}
interface ShortcutStore {
  shortcuts: ShortcutMap;
  handlers: Record<string, Registration>;
  configure(shortcuts: ShortcutMap): void;
  register(id: string, handler: Handler): () => void;
}
export const useShortcutStore = create<ShortcutStore>((set) => ({
  shortcuts: DEFAULT_SHORTCUTS,
  handlers: {},
  configure: (shortcuts) => set({ shortcuts }),
  register: (id, handler) => {
    const token = Symbol(id);
    set((state) => ({ handlers: { ...state.handlers, [id]: { token, handler } } }));
    return () =>
      set((state) => {
        if (state.handlers[id]?.token !== token) return {};
        const handlers = { ...state.handlers };
        delete handlers[id];
        return { handlers };
      });
  },
}));
