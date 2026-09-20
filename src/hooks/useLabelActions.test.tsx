import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi, beforeEach } from "vitest";
import {
  useLabelActions,
  type LabelActions,
  type UseLabelActionsParams,
} from "./useLabelActions";
import type { AnnotationShape, LabelConfig } from "../types/annotation";

const tauriApi = vi.hoisted(() => ({
  confirmAction: vi.fn(),
  saveLabelConfigs: vi.fn(async () => {}),
  saveLabelTemplates: vi.fn(async () => {}),
  saveProjectConfig: vi.fn(async () => {}),
}));
vi.mock("../lib/tauri-api", () => tauriApi);
vi.mock("../lib/app-utils", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveProjectConfig: tauriApi.saveProjectConfig,
}));

const savedA: LabelConfig = { id: "a", name: "行人", color: "#111111", shapeType: "any" };
const savedB: LabelConfig = { id: "b", name: "车辆", color: "#222222", shapeType: "any" };
const draftC: LabelConfig = { id: "c", name: "草稿标签", color: "#333333", shapeType: "any" };
const annotation = (id: string, labelId: string): AnnotationShape => ({
  id,
  type: "rect",
  labelId,
  points: [0, 0, 10, 10],
  frameIndex: 0,
});

function renderHarness(overrides: Partial<UseLabelActionsParams> = {}): LabelActions {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let controls!: LabelActions;
  function Harness() {
    controls = useLabelActions({
      activeProjectConfig: null,
      activeProjectConfigPath: "",
      annotationsByImage: {},
      currentLabelId: savedA.id,
      isLabelDirty: true,
      labels: [savedA, savedB],
      projectTemplateId: "project-config",
      readOnlyTemplateIds: new Set(["common-detection"]),
      savedLabels: [savedA, savedB],
      selectedPath: "p1",
      selectedShapeId: null,
      selectedTemplateId: "tpl-user",
      templates: [{ id: "tpl-user", name: "用户模板", labels: [savedA, savedB] }],
      usedLabelIds: new Set<string>(),
      replaceLabel: vi.fn(),
      replaceAnnotations: vi.fn(),
      setActiveProjectConfig: vi.fn(),
      setCurrentLabelId: vi.fn(),
      setError: vi.fn(),
      setIsLabelDirty: vi.fn(),
      showMessage: vi.fn(),
      setLabels: vi.fn(),
      setSavedLabels: vi.fn(),
      setSelectedTemplateId: vi.fn(),
      setTemplates: vi.fn(),
      updateAnnotation: vi.fn(),
      ...overrides,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Harness />));
  return controls;
}

beforeEach(() => {
  for (const mock of Object.values(tauriApi)) mock.mockClear();
});

it("cancels cleanly when no annotation references draft-only labels", async () => {
  const setLabels = vi.fn();
  const setIsLabelDirty = vi.fn();
  const replaceAnnotations = vi.fn();
  const controls = renderHarness({
    labels: [savedA, draftC],
    savedLabels: [savedA],
    usedLabelIds: new Set(["a"]),
    setLabels,
    setIsLabelDirty,
    replaceAnnotations,
  });
  await act(() => controls.cancelLabelChanges());
  expect(tauriApi.confirmAction).not.toHaveBeenCalled();
  expect(replaceAnnotations).not.toHaveBeenCalled();
  expect(setLabels).toHaveBeenCalledWith([savedA]);
  expect(setIsLabelDirty).toHaveBeenCalledWith(false);
  expect(tauriApi.saveLabelConfigs).toHaveBeenCalledWith([savedA]);
});

it("removes annotations with dangling references when confirmed", async () => {
  tauriApi.confirmAction.mockResolvedValue(true);
  const replaceAnnotations = vi.fn();
  const setLabels = vi.fn();
  const setIsLabelDirty = vi.fn();
  const controls = renderHarness({
    labels: [savedA, draftC],
    savedLabels: [savedA],
    usedLabelIds: new Set(["a", "c"]),
    annotationsByImage: {
      p1: [annotation("s1", "a"), annotation("s2", "c")],
      p2: [annotation("s3", "c")],
    },
    replaceAnnotations,
    setLabels,
    setIsLabelDirty,
  });
  await act(() => controls.cancelLabelChanges());
  expect(tauriApi.confirmAction).toHaveBeenCalledTimes(1);
  expect(String(tauriApi.confirmAction.mock.calls[0][0])).toContain("草稿标签");
  expect(replaceAnnotations).toHaveBeenCalledWith({
    p1: [annotation("s1", "a")],
    p2: [],
  });
  expect(setLabels).toHaveBeenCalledWith([savedA]);
  expect(setIsLabelDirty).toHaveBeenCalledWith(false);
});

it("keeps referenced draft labels dirty when the removal is declined", async () => {
  tauriApi.confirmAction.mockResolvedValue(false);
  const replaceAnnotations = vi.fn();
  const setLabels = vi.fn();
  const setSavedLabels = vi.fn();
  const setIsLabelDirty = vi.fn();
  const setCurrentLabelId = vi.fn();
  const controls = renderHarness({
    labels: [draftC],
    savedLabels: [savedA],
    currentLabelId: draftC.id,
    usedLabelIds: new Set(["c"]),
    annotationsByImage: { p1: [annotation("s2", "c")] },
    replaceAnnotations,
    setLabels,
    setSavedLabels,
    setIsLabelDirty,
    setCurrentLabelId,
  });
  await act(() => controls.cancelLabelChanges());
  expect(replaceAnnotations).not.toHaveBeenCalled();
  expect(setLabels).toHaveBeenCalledWith([savedA, draftC]);
  expect(setSavedLabels).toHaveBeenCalledWith([savedA]);
  expect(setIsLabelDirty).toHaveBeenCalledWith(true);
  expect(setCurrentLabelId).toHaveBeenCalledWith(draftC.id);
  expect(tauriApi.saveLabelConfigs).not.toHaveBeenCalled();
});

it("hints when selecting a draft-only label as current label", () => {
  const showMessage = vi.fn();
  const setCurrentLabelId = vi.fn();
  const controls = renderHarness({
    labels: [savedA, draftC],
    savedLabels: [savedA, savedB],
    showMessage,
    setCurrentLabelId,
  });
  act(() => controls.selectCurrentLabel(draftC.id));
  expect(setCurrentLabelId).toHaveBeenCalledWith(draftC.id);
  expect(showMessage).toHaveBeenCalledTimes(1);
  expect(String(showMessage.mock.calls[0][0])).toContain("尚未保存");
  showMessage.mockClear();
  act(() => controls.selectCurrentLabel(savedA.id));
  expect(showMessage).not.toHaveBeenCalled();
});
