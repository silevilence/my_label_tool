import { EditorView } from "@codemirror/view";
import { startCompletion, completionStatus, acceptCompletion } from "@codemirror/autocomplete";
import { undo, redo } from "@codemirror/commands";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ScriptPanel } from "./ScriptPanel";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { useOperations } from "../../store/useOperations";
import { useOverlayStore } from "../../store/useOverlayStore";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";
import { ACP_ZH_CN as acpText } from "../../i18n/acp.zh-CN";
import { ACP_CONFIG_STORAGE_KEY } from "../../lib/defaults/acp";
import type { AnnotationShape, LabelConfig } from "../../types/annotation";
import type { ScriptResult } from "../../types/script";
import { BUILTIN_SCRIPTS } from "../../lib/defaults/scripts";
import { confirmAction, promptText } from "../../lib/prompts";
import type { AcpEvent, AcpResult } from "../../types/acp";
import realGeneratedSource from "../../../docs/verification/acp-generated.lua?raw";

const api = vi.hoisted(() => ({
  scriptHostAvailable: vi.fn(),
  runScript: vi.fn(),
  cancelScript: vi.fn(),
  scriptLibraryDirectory: vi.fn(),
  readTextFile: vi.fn(),
  exportTextFiles: vi.fn(),
  deleteScriptFile: vi.fn(),
  selectScriptFile: vi.fn(),
  selectScriptExportPath: vi.fn(),
  loadScriptResourceLimits: vi.fn(),
  saveScriptResourceLimits: vi.fn(),
  runAcpAgent: vi.fn(),
  cancelAcpAgent: vi.fn().mockResolvedValue(undefined),
  respondAcpPermission: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/tauri-api", () => api);
vi.mock("../../lib/prompts", () => ({
  confirmAction: vi.fn().mockResolvedValue(true),
  promptText: vi.fn().mockResolvedValue("脚本一"),
}));
const labels: LabelConfig[] = [{ id: "l", name: "车辆", shapeType: "rect", color: "#fff" }];
const shape: AnnotationShape = {
  id: "box",
  type: "rect",
  labelId: "l",
  points: [1, 2, 3, 4],
  frameIndex: 0,
};
let root: Root;
let host: HTMLDivElement;
// jsdom has no layout engine; CodeMirror measures ranges asynchronously.
beforeAll(() => {
  Range.prototype.getClientRects = () => Object.assign([], { item: () => null });
  Range.prototype.getBoundingClientRect = () => new DOMRect();
});
afterAll(() => {
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
});
function button(name: string) {
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === name);
  if (!button) throw new Error(`Missing ${name}`);
  return button;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function selectScript(id: string) {
  const select = document.querySelector<HTMLSelectElement>(`select[aria-label="${text.library}"]`)!;
  await act(async () => {
    select.value = id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(async () => {
  localStorage.setItem(
    ACP_CONFIG_STORAGE_KEY,
    JSON.stringify({ executable: "test-agent.exe", args: ["acp"], timeoutSeconds: 30 }),
  );
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  api.scriptHostAvailable.mockResolvedValue(true);
  api.cancelScript.mockResolvedValue(undefined);
  api.scriptLibraryDirectory.mockResolvedValue("/scripts");
  api.readTextFile.mockResolvedValue('{"schemaVersion":1,"scripts":[]}');
  api.exportTextFiles.mockResolvedValue(undefined);
  api.loadScriptResourceLimits.mockResolvedValue({ maxMemoryMiB: 256, timeoutSeconds: 30 });
  api.saveScriptResourceLimits.mockResolvedValue(undefined);
  useOperations.setState({ operations: [] });
  useAnnotationStore.setState({
    images: [{ path: "a", name: "a.png" }],
    scopeStack: [{ kind: "project" }],
    annotationsByImage: { a: [shape] },
    selectedPath: "a",
    undoStack: [],
    redoStack: [],
    frameIndices: {},
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(<ScriptPanel labels={labels} onClose={() => {}} />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useOverlayStore.setState({ stack: [] });
  vi.clearAllMocks();
  localStorage.clear();
});

it("offers editable Lua, scope, persisted options and default-off preview", async () => {
  expect(
    EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.doc.toString(),
  ).toContain("annotool.images()");
  expect(document.body.textContent).toContain(text.scope(1));
  const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(boxes.map((box) => box.checked)).toEqual([false, false]);
  await act(async () => boxes[0].click());
  await click(text.saveScript + text.dirtyMark);
  const files = api.exportTextFiles.mock.calls[0][1] as { path: string; content: string }[];
  expect(files.some((file) => file.path.endsWith(".lua"))).toBe(true);
  expect(
    JSON.parse(files.find((file) => file.path === "index.json")!.content).scripts[0].options
      .includeDimensions,
  ).toBe(true);
});

it("accepts host completions and preserves editor undo/redo", async () => {
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "annotool.im" },
      selection: { anchor: 11 },
    });
    startCompletion(view);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(completionStatus(view.state)).toBe("active");
  expect(document.querySelector('[role="listbox"]')?.getAttribute("aria-label")).toBe(
    text.editorPhrases.Completions,
  );
  await act(async () => {
    expect(acceptCompletion(view)).toBe(true);
  });
  expect(view.state.doc.toString()).toBe("annotool.images");
  await act(async () => {
    undo(view);
  });
  expect(view.state.doc.toString()).toBe("annotool.im");
  await act(async () => {
    redo(view);
  });
  expect(view.state.doc.toString()).toBe("annotool.images");
});

it("uses Escape to close completion before dismissing the panel", async () => {
  const close = vi.fn();
  await act(async () => root.render(<ScriptPanel labels={labels} onClose={close} />));
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  await act(async () => {
    startCompletion(view);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  await act(async () => {
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(close).not.toHaveBeenCalled();
  expect(completionStatus(view.state)).toBeNull();
  await act(async () => {
    view.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(close).toHaveBeenCalledOnce();
});
it("keeps cancellation visible and discards even a late successful result", async () => {
  let resolve!: (results: ScriptResult[]) => void;
  api.runScript.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await click(text.run);
  expect(button(text.hideRun).disabled).toBe(false);
  expect(button(text.cancel).disabled).toBe(false);
  await click(text.cancel);
  await act(async () => resolve([{ imagePath: "a", annotations: [] }]));
  expect(api.cancelScript).toHaveBeenCalledOnce();
  expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
});
it("keeps a hidden run alive and rejects results after manual edits", async () => {
  let resolve!: (results: ScriptResult[]) => void;
  api.runScript.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await click(text.run);
  expect(useOperations.getState().canEditAnnotations()).toBe(true);
  expect(useOperations.getState().canStart("project-annotations")).toBe(false);
  await act(async () =>
    root.render(<ScriptPanel open={false} labels={labels} onClose={() => {}} />),
  );
  expect(useOverlayStore.getState().hasBlocking()).toBe(false);
  expect(api.cancelScript).not.toHaveBeenCalled();
  act(() => useAnnotationStore.getState().updateAnnotation("a", "box", { points: [9, 8, 3, 4] }));
  await act(async () => resolve([{ imagePath: "a", annotations: [] }]));
  expect(useAnnotationStore.getState().annotationsByImage.a[0].points).toEqual([9, 8, 3, 4]);
  expect(useOperations.getState().operations.slice(-1)[0]?.message).toContain(text.staleSnapshot);
  expect(useOperations.getState().canStart("project-annotations")).toBe(true);
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
  expect(api.saveScriptResourceLimits).toHaveBeenCalledWith({
    maxMemoryMiB: 256,
    timeoutSeconds: 30,
  });
});

it("separates every built-in example and prevents editing or persisting it", async () => {
  expect(document.querySelector(`optgroup[label="${text.builtinScripts}"]`)?.children).toHaveLength(
    BUILTIN_SCRIPTS.length,
  );
  expect(document.querySelector(`optgroup[label="${text.userScripts}"]`)).not.toBeNull();
  for (const example of BUILTIN_SCRIPTS) {
    expect(example.name).toBeTruthy();
    expect(example.description).toBeTruthy();
    expect(example.source).toBeTruthy();
    await selectScript(example.id);
    const editor = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
    expect(editor.state.doc.toString()).toBe(example.source.replace(/\r\n?/g, "\n"));
    expect(editor.state.readOnly).toBe(true);
    expect(editor.contentDOM.getAttribute("aria-disabled")).toBe("false");
    expect(button(text.saveScript).disabled).toBe(true);
    expect(button(text.rename).disabled).toBe(true);
    expect(button(text.deleteScript).disabled).toBe(true);
    const dimensions = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(dimensions.checked).toBe(example.includeDimensions);
    expect(dimensions.disabled).toBe(true);
    expect(document.body.textContent).toContain(example.description);
  }
  expect(api.exportTextFiles).not.toHaveBeenCalled();
  expect(api.deleteScriptFile).not.toHaveBeenCalled();
});

it("copies a built-in with its options into an editable user script without changing the original", async () => {
  const example = BUILTIN_SCRIPTS.find((entry) => entry.id === "builtin:size")!;
  await selectScript(example.id);
  await click(text.copyExample);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.readOnly).toBe(false);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.doc.toString()).toBe(
    example.source.replace(/\r\n?/g, "\n"),
  );
  expect(button(text.saveScript).disabled).toBe(false);
  expect(document.querySelector(`optgroup[label="${text.userScripts}"]`)?.children).toHaveLength(1);
  const files = api.exportTextFiles.mock.calls[0][1] as { path: string; content: string }[];
  expect(files.find((file) => file.path.endsWith(".lua"))?.content).toBe(example.source);
  const index = JSON.parse(files.find((file) => file.path === "index.json")!.content);
  expect(index.scripts).toHaveLength(1);
  expect(index.scripts[0].id).not.toContain("builtin:");
  expect(index.scripts[0].options.includeDimensions).toBe(true);
  await selectScript(example.id);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.readOnly).toBe(true);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.doc.toString()).toBe(
    example.source.replace(/\r\n?/g, "\n"),
  );
});

it("keeps an unsaved user draft when switching to an example is declined", async () => {
  const dimensions = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => dimensions.click());
  vi.mocked(confirmAction).mockResolvedValueOnce(false);
  await selectScript("builtin:images");
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.readOnly).toBe(false);
  expect(dimensions.checked).toBe(true);
  expect(button(text.saveScript + text.dirtyMark).disabled).toBe(false);
});

it("runs a read-only example and returns to an editable new script", async () => {
  api.runScript.mockResolvedValue([]);
  await selectScript("builtin:images");
  await click(text.run);
  expect(api.runScript.mock.calls[0][2]).toBe(BUILTIN_SCRIPTS[0].source);
  expect(useAnnotationStore.getState().annotationsByImage.a).toEqual([shape]);
  await click(text.newScript);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)?.state.readOnly).toBe(false);
});

const generated = realGeneratedSource.replace(/\r\n?/g, "\n");
function streamDraft(emit: (event: AcpEvent) => void) {
  emit({
    event: "update",
    sessionId: "test",
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `\`\`\`lua\n${generated}\`\`\`` },
    },
  });
}
async function instruction() {
  const input = document.querySelector<HTMLTextAreaElement>(
    `textarea[aria-label="${acpText.instruction}"]`,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "记录生成结果",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function source() {
  return EditorView.findFromDOM(document.querySelector(".cm-editor")!)!.state.doc.toString();
}
it("streams an independent draft, saves only on confirmation and runs the new editable script", async () => {
  await selectScript("builtin:images");
  const original = source();
  api.runAcpAgent.mockImplementation(async (_id, _config, _prompt, emit) => {
    streamDraft(emit);
    return { sessionId: "test", stopReason: "end_turn" };
  });
  await instruction();
  await click(acpText.generate);
  expect(source()).toBe(original);
  expect(api.exportTextFiles).not.toHaveBeenCalled();
  const preview = document.querySelector(`pre[aria-label="${acpText.diff}"]`)?.textContent;
  for (const line of generated.trim().split("\n")) expect(preview).toContain(line);
  const prompt = api.runAcpAgent.mock.calls[0][2] as string;
  expect(prompt).toContain("annotool.images");
  expect(prompt).not.toContain('"points"');
  expect(prompt).not.toContain("a.png");
  vi.mocked(promptText).mockResolvedValueOnce(null);
  await click(acpText.saveDraft);
  expect(api.exportTextFiles).not.toHaveBeenCalled();
  await click(acpText.saveDraft);
  expect(source()).toBe(generated);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)!.state.readOnly).toBe(false);
  const files = api.exportTextFiles.mock.calls[0][1] as { path: string; content: string }[];
  expect(files.find((file) => file.path.endsWith(".lua"))?.content).toBe(generated);
  api.runScript.mockResolvedValue([]);
  await click(text.run);
  expect(api.runScript.mock.calls[0][2]).toBe(generated);
  await selectScript("builtin:images");
  expect(source()).toBe(original);
});

it.each(["cancel", "failure", "reject"] as const)(
  "preserves the editor and library on AI %s",
  async (mode) => {
    let finish!: (value: AcpResult) => void;
    let fail!: (reason: Error) => void;
    api.runAcpAgent.mockImplementation((_id, _config, _prompt, emit) => {
      streamDraft(emit);
      if (mode === "reject")
        emit({
          event: "permission",
          requestId: "1",
          title: "read file",
          options: [{ optionId: "yes", name: "yes", kind: "allow_once" }],
        });
      return new Promise<AcpResult>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
    });
    const original = source();
    await instruction();
    await click(acpText.generate);
    if (mode === "cancel") await click(acpText.cancel);
    if (mode === "reject") await click(acpText.deny);
    await act(async () => {
      if (mode === "failure") fail(new Error("disconnected"));
      else finish({ sessionId: "test", stopReason: "end_turn" });
    });
    expect(source()).toBe(original);
    expect(api.exportTextFiles).not.toHaveBeenCalled();
    expect(document.querySelector(`section[aria-label="${acpText.draft}"]`)).toBeNull();
  },
);

it("blocks saving a draft after its original script changes", async () => {
  api.runAcpAgent.mockImplementation(async (_id, _config, _prompt, emit) => {
    streamDraft(emit);
    return { sessionId: "test", stopReason: "end_turn" };
  });
  await instruction();
  await click(acpText.generate);
  await selectScript("builtin:images");
  expect(button(acpText.saveDraft).disabled).toBe(true);
  expect(document.body.textContent).toContain(acpText.stale);
  expect(api.exportTextFiles).not.toHaveBeenCalled();
});

it("preserves undo through the first save but resets it when opening another document", async () => {
  const view = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  const original = view.state.doc.toString();
  await act(async () =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "local edited = true" },
    }),
  );
  await click(text.saveScript + text.dirtyMark);
  expect(EditorView.findFromDOM(document.querySelector(".cm-editor")!)).toBe(view);
  await act(async () => {
    expect(undo(view)).toBe(true);
  });
  expect(source()).toBe(original);
  await selectScript("builtin:images");
  const other = EditorView.findFromDOM(document.querySelector(".cm-editor")!)!;
  expect(other).not.toBe(view);
  expect(undo(other)).toBe(false);
});

it("keeps edited AI drafts when hiding and reopening, and dismisses their completion first", async () => {
  const close = vi.fn();
  api.runAcpAgent.mockImplementation(async (_id, _config, _prompt, emit) => {
    streamDraft(emit);
    return { sessionId: "test", stopReason: "end_turn" };
  });
  await instruction();
  await click(acpText.generate);
  const candidate = EditorView.findFromDOM(
    document.querySelectorAll<HTMLElement>(".cm-editor")[1],
  )!;
  await act(async () =>
    candidate.dispatch({
      changes: { from: 0, to: candidate.state.doc.length, insert: "annotool.im" },
      selection: { anchor: 11 },
    }),
  );
  await act(async () => root.render(<ScriptPanel open={false} labels={labels} onClose={close} />));
  await act(async () => root.render(<ScriptPanel labels={labels} onClose={close} />));
  const restored = EditorView.findFromDOM(document.querySelectorAll<HTMLElement>(".cm-editor")[1])!;
  expect(restored.state.doc.toString()).toBe("annotool.im");
  await act(async () => {
    // Opening details makes this editor focusable in the real UI.
    restored.dom.closest("details")!.open = true;
    restored.focus();
    startCompletion(restored);
    await new Promise((resolve) => setTimeout(resolve, 350));
  });
  expect(completionStatus(restored.state)).toBe("active");
  await act(async () =>
    restored.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(completionStatus(restored.state)).toBeNull();
  expect(close).not.toHaveBeenCalled();
  expect(api.exportTextFiles).not.toHaveBeenCalled();
});
