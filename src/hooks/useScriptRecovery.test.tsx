import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useScriptLibrary } from "./useScriptLibrary";
import { useScriptLimits } from "./useScriptLimits";
import { BUILTIN_SCRIPTS } from "../lib/defaults/scripts";
import { useTextReadStore } from "../store/useTextReadStore";
import { useOperations } from "../store/useOperations";

const api = vi.hoisted(() => ({
  loadScriptResourceLimits: vi.fn(),
  saveScriptResourceLimits: vi.fn(),
  readTextFile: vi.fn(),
  selectScriptExportPath: vi.fn(),
  selectScriptFile: vi.fn(),
}));
const scripts = vi.hoisted(() => ({
  loadScriptLibrary: vi.fn(),
  readLibraryScript: vi.fn(),
  exportScriptFile: vi.fn(),
  removeLibraryScript: vi.fn(),
  saveLibraryScript: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
vi.mock("../lib/script-library", () => scripts);

const storedLibrary = {
  directory: "scripts",
  scripts: [{ id: "saved", name: "Saved", options: { includeDimensions: false } }],
};
const storedLimits = { maxMemoryMiB: 128, timeoutSeconds: 15 };
let library: ReturnType<typeof useScriptLibrary>;
let limits: ReturnType<typeof useScriptLimits>;
let root: Root;
function Harness() {
  library = useScriptLibrary();
  limits = useScriptLimits();
  return null;
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  useTextReadStore.setState({ revision: 0 });
  useOperations.setState({ operations: [] });
  scripts.loadScriptLibrary.mockRejectedValueOnce(new Error("reader unavailable"));
  scripts.loadScriptLibrary.mockResolvedValue(storedLibrary);
  scripts.readLibraryScript.mockResolvedValue("saved source");
  api.loadScriptResourceLimits.mockRejectedValueOnce(new Error("reader unavailable"));
  api.loadScriptResourceLimits.mockResolvedValue(storedLimits);
  api.saveScriptResourceLimits.mockResolvedValue(undefined);
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
});
async function recover() {
  await act(async () => useTextReadStore.getState().changed());
}

it("retries failed library and limits reads, then preserves successfully loaded state", async () => {
  expect(library.library).toBeNull();
  expect(limits.saved).toBeNull();
  expect(limits.error).toContain("reader unavailable");
  await recover();
  expect(library.source).toBe("saved source");
  expect(library.selectedId).toBe("saved");
  expect(limits.saved).toEqual(storedLimits);
  expect(limits.value).toEqual(storedLimits);
  expect(limits.error).toBe("");
  expect(limits.loading).toBe(false);
  act(() => library.setSource("edited source"));
  await recover();
  expect(library.source).toBe("edited source");
  expect(scripts.loadScriptLibrary).toHaveBeenCalledTimes(2);
  expect(api.loadScriptResourceLimits).toHaveBeenCalledTimes(2);
});

it("recovers the library without replacing an unsaved script or its options", async () => {
  act(() => {
    library.setSource("unsaved source");
    library.setIncludeDimensions(true);
  });
  await recover();
  expect(library.library).toEqual(storedLibrary);
  expect(library.source).toBe("unsaved source");
  expect(library.includeDimensions).toBe(true);
  expect(library.selectedId).toBe("");
  expect(library.dirty).toBe(true);
  expect(scripts.readLibraryScript).not.toHaveBeenCalled();
});

it("preserves edits made while recovery is awaiting the saved script", async () => {
  let resolve!: (source: string) => void;
  scripts.readLibraryScript.mockReturnValue(
    new Promise<string>((done) => {
      resolve = done;
    }),
  );
  await recover();
  act(() => library.setSource("typed during recovery"));
  await act(async () => resolve("saved source"));
  expect(library.library).toEqual(storedLibrary);
  expect(library.source).toBe("typed during recovery");
  expect(library.dirty).toBe(true);
});

it("preserves a selected built-in document during recovery", async () => {
  const example = BUILTIN_SCRIPTS[0];
  await act(async () => library.select(example.id));
  const version = library.documentVersion;
  await recover();
  expect(library.selectedId).toBe(example.id);
  expect(library.source).toBe(example.source);
  expect(library.documentVersion).toBe(version);
});

it("recovers persisted limits without overwriting an edited limits draft", async () => {
  const draft = { maxMemoryMiB: 512, timeoutSeconds: 60 };
  act(() => limits.setValue(draft));
  await recover();
  expect(limits.saved).toEqual(storedLimits);
  expect(limits.value).toEqual(draft);
  expect(limits.error).toBe("");
});

it("does not reload limits already saved after an initial read failure", async () => {
  const saved = { maxMemoryMiB: 512, timeoutSeconds: 60 };
  await act(async () => limits.save(saved));
  await recover();
  expect(limits.saved).toEqual(saved);
  expect(api.loadScriptResourceLimits).toHaveBeenCalledTimes(1);
});

it("keeps failed limits retryable and exposes loading until recovery finishes", async () => {
  api.loadScriptResourceLimits.mockRejectedValueOnce(new Error("still unavailable"));
  await recover();
  expect(limits.saved).toBeNull();
  expect(limits.error).toContain("still unavailable");
  let resolve!: (value: typeof storedLimits) => void;
  api.loadScriptResourceLimits.mockReturnValue(
    new Promise<typeof storedLimits>((done) => {
      resolve = done;
    }),
  );
  await recover();
  expect(limits.loading).toBe(true);
  await act(async () => resolve(storedLimits));
  expect(limits.saved).toEqual(storedLimits);
  expect(limits.loading).toBe(false);
  expect(limits.error).toBe("");
});
