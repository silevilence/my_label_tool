import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ScriptPanel } from "./ScriptPanel";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { useOperations } from "../../store/useOperations";
import { useOverlayStore } from "../../store/useOverlayStore";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import type { ScriptResult } from "../../types/script";

const api = vi.hoisted(() => ({
  scriptHostAvailable: vi.fn(), runScript: vi.fn(), cancelScript: vi.fn(),
  scriptLibraryDirectory: vi.fn(), readTextFile: vi.fn(), exportTextFiles: vi.fn(), deleteScriptFile: vi.fn(),
  selectScriptFile: vi.fn(), selectScriptExportPath: vi.fn(),
  loadScriptResourceLimits: vi.fn(), saveScriptResourceLimits: vi.fn(),
}));
vi.mock("../../lib/tauri-api", () => api);
vi.mock("../../lib/prompts", () => ({ confirmAction: vi.fn().mockResolvedValue(true), promptText: vi.fn().mockResolvedValue("脚本一") }));
const labels: LabelConfig[] = [{ id: "l", name: "车辆", shapeType: "rect", color: "#fff" }];
const shape: AnnotationShape = { id: "box", type: "rect", labelId: "l", points: [1, 2, 3, 4], frameIndex: 0 };
let root: Root;
let host: HTMLDivElement;
function button(name: string) { const button = [...document.querySelectorAll("button")].find((b) => b.textContent === name); if (!button) throw new Error(`Missing ${name}`); return button; }
async function click(name: string) { await act(async () => button(name).click()); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.scriptHostAvailable.mockResolvedValue(true);
  api.cancelScript.mockResolvedValue(undefined);
  api.scriptLibraryDirectory.mockResolvedValue("/scripts");
  api.readTextFile.mockResolvedValue('{"schemaVersion":1,"scripts":[]}');
  api.exportTextFiles.mockResolvedValue(undefined);
  api.loadScriptResourceLimits.mockResolvedValue({ maxMemoryMiB: 256, timeoutSeconds: 30 });
  api.saveScriptResourceLimits.mockResolvedValue(undefined);
  useOperations.setState({ operations: [] });
  useAnnotationStore.setState({ images: [{ path: "a", name: "a.png" }], scopeStack: [{ kind: "project" }], annotationsByImage: { a: [shape] }, selectedPath: "a", undoStack: [], redoStack: [], frameIndices: {} });
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<ScriptPanel labels={labels} onClose={() => {}} />));
});
afterEach(() => { act(() => root.unmount()); host.remove(); useOverlayStore.setState({ stack: [] }); vi.clearAllMocks(); });

it("offers editable Lua, scope, persisted options and default-off preview", async () => {
  expect(document.querySelector("textarea")?.value).toContain("annotool.call");
  expect(document.body.textContent).toContain(text.scope(1));
  const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.map((box) => box.checked)).toEqual([false, false]);
  await act(async () => boxes[0].click());
  await click(text.saveScript + text.dirtyMark);
  const files = api.exportTextFiles.mock.calls[0][1] as { path: string; content: string }[];
  expect(files.some((file) => file.path.endsWith(".lua"))).toBe(true);
  expect(JSON.parse(files.find((file) => file.path === "index.json")!.content).scripts[0].options.includeDimensions).toBe(true);
});
it("keeps cancellation visible and discards even a late successful result", async () => {
  let resolve!: (results: ScriptResult[]) => void;
  api.runScript.mockReturnValue(new Promise((done) => { resolve = done; }));
  await click(text.run);
  expect(button(text.close).disabled).toBe(true);
  expect(button(text.cancel).disabled).toBe(false);
  await click(text.cancel);
  await act(async () => resolve([{ imagePath: "a", annotations: [] }]));
  expect(api.cancelScript).toHaveBeenCalledOnce();
  expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
});
it("shows before/after differences and applies and undoes exactly one transaction", async () => {
  api.runScript.mockResolvedValue([{ imagePath: "a", annotations: [] }]);
  const preview = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')][1];
  await act(async () => preview.click());
  await click(text.run);
  expect(document.querySelector(`pre[aria-label="${text.before}"]`)?.textContent).toContain("box");
  expect(document.querySelector(`pre[aria-label="${text.after}"]`)?.textContent).toBe("[]");
  expect(useAnnotationStore.getState().annotationsByImage.a).toHaveLength(1);
  await click(text.apply);
  expect(useAnnotationStore.getState().undoStack).toHaveLength(1);
  expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([]);
  await click(text.undo);
  expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
});
it("restores and persists resource defaults", async () => {
  await click(text.restoreLimits);
  expect(api.saveScriptResourceLimits).toHaveBeenCalledWith({ maxMemoryMiB: 256, timeoutSeconds: 30 });
});
