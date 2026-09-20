import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, beforeEach } from "vitest";
import { ProjectSettingsDialog } from "./ProjectSettingsDialog";
import type { ProjectSettingsModel } from "../../hooks/useProjectSettings";
import type { ProjectSettings } from "../../types/project-settings";

const promptsApi = vi.hoisted(() => ({
  confirmAction: vi.fn(),
}));
vi.mock("../../lib/prompts", () => promptsApi);

const settings: ProjectSettings = {
  schemaVersion: 1,
  videoExtraction: { mode: "fps", fps: 5, frameInterval: 30 },
};

function renderDialog(overrides: Partial<ComponentProps<typeof ProjectSettingsDialog>> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const model: ProjectSettingsModel = {
    settings,
    error: "",
    loading: false,
    saving: false,
    save: vi.fn(async () => true),
  };
  const props: ComponentProps<typeof ProjectSettingsDialog> = {
    folder: "C:/project",
    model,
    pendingCount: 0,
    onClose: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<ProjectSettingsDialog {...props} />));
  return { root, host, props };
}

function button(label: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

function fpsInput(): HTMLInputElement {
  const found = document.body.querySelector<HTMLInputElement>('input[aria-label="抽帧帧率（FPS）"]');
  if (!found) throw new Error("fps input not found");
  return found;
}

beforeEach(() => {
  promptsApi.confirmAction.mockReset();
});

it("closes immediately without confirm when nothing is unsaved", () => {
  const { root, host, props } = renderDialog();
  act(() => button("关闭").click());
  expect(promptsApi.confirmAction).not.toHaveBeenCalled();
  expect(props.onClose).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  host.remove();
});

it("asks for confirmation when closing discards unsaved interval edits", async () => {
  promptsApi.confirmAction.mockResolvedValue(true);
  const { root, host, props } = renderDialog();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      fpsInput(),
      "8",
    );
    fpsInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(document.body.textContent).toContain("抽帧设置有未保存的修改");
  await act(async () => button("关闭").click());
  expect(promptsApi.confirmAction).toHaveBeenCalledTimes(1);
  expect(props.onClose).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  host.remove();
});

it("keeps the dialog open when the discard confirmation is declined", async () => {
  promptsApi.confirmAction.mockResolvedValue(false);
  const { root, host, props } = renderDialog();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      fpsInput(),
      "8",
    );
    fpsInput().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("关闭").click());
  expect(promptsApi.confirmAction).toHaveBeenCalledTimes(1);
  expect(props.onClose).not.toHaveBeenCalled();
  act(() => root.unmount());
  host.remove();
});
