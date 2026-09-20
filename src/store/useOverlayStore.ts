import { create } from "zustand";

export type OverlayKind = "blocking" | "light";
interface Entry {
  id: string;
  parentId: string | null;
  kind: OverlayKind;
}
interface OverlayStore {
  stack: Entry[];
  register(entry: Entry): void;
  unregister(id: string): void;
  hasBlocking(): boolean;
  hasLight(): boolean;
  depth(): number;
}

export const useOverlayStore = create<OverlayStore>((set, get) => ({
  stack: [],
  register: (entry) =>
    set(({ stack }) => {
      if (stack.some((item) => item.id === entry.id)) return {};
      // React mounts child effects first; insert their parent beneath them.
      const child = stack.findIndex((item) => item.parentId === entry.id);
      const next = [...stack];
      next.splice(child < 0 ? next.length : child, 0, entry);
      return { stack: next };
    }),
  unregister: (id) => set(({ stack }) => ({ stack: stack.filter((item) => item.id !== id) })),
  hasBlocking: () => get().stack.some((item) => item.kind === "blocking"),
  hasLight: () => get().stack.some((item) => item.kind === "light"),
  depth: () => get().stack.length,
}));
