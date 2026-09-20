import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LabelSettings } from "./LabelSettings";
import type { LabelConfig, LabelTemplate } from "../../types/annotation";

const templates: LabelTemplate[] = [
  { id: "common-detection", name: "通用目标检测", labels: [] },
  { id: "user-tpl", name: "我的模板", labels: [] },
];

const labels: LabelConfig[] = [{ id: "l1", name: "人", color: "#111111", shapeType: "any" }];

function renderSettings(overrides: Partial<Parameters<typeof LabelSettings>[0]> = {}) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const props: Parameters<typeof LabelSettings>[0] = {
    labels,
    templates,
    pluginTemplateSources: new Map(),
    selectedTemplateId: "common-detection",
    isDirty: false,
    canSaveTemplate: false,
    canDeleteTemplate: false,
    usedLabelIds: new Set<string>(),
    onCancelChanges: vi.fn(),
    onChangeLabels: vi.fn(),
    onDeleteTemplate: vi.fn(),
    onNewTemplate: vi.fn(),
    onSaveAndUpdateTemplate: vi.fn(),
    onSaveTemplate: vi.fn(),
    onSaveTemplateAs: vi.fn(),
    onSelectTemplate: vi.fn(),
    ...overrides,
  };
  act(() => root.render(<LabelSettings {...props} />));
  const trigger = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.startsWith("管理模板和标签"),
  )!;
  act(() => trigger.click());
  return { root, host, props };
}

it("disables save on unmodified built-in templates and explains inline instead of hover", () => {
  const { root, host } = renderSettings();
  const save = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === "保存",
  )!;
  expect(save.disabled).toBe(true);
  expect(document.body.textContent).toContain("内置模板不可覆盖");
  expect(save.title).toBe("");
  act(() => root.unmount());
  host.remove();
});

it("keeps save enabled for modified built-in templates where saving saves-as-new", () => {
  const onSaveTemplate = vi.fn();
  const { root, host } = renderSettings({ isDirty: true, onSaveTemplate });
  const save = [...document.body.querySelectorAll("button")].find(
    (button) => button.textContent === "保存",
  )!;
  expect(save.disabled).toBe(false);
  expect(document.body.textContent).toContain("内置模板不可覆盖");
  act(() => save.click());
  expect(onSaveTemplate).toHaveBeenCalledTimes(1);
  act(() => root.unmount());
  host.remove();
});
