import { describe, expect, it } from "vitest";
import {
  addModelToLibrary,
  createPrelabelModelConfig,
  deleteModelFromLibrary,
  modelNameFromPath,
  ptConversionCommand,
  selectModelInLibrary,
  updateInputSizeOverride,
  updateModelInLibrary,
} from "./prelabel-models";
import { EMPTY_PRELABEL_MODEL_LIBRARY, type PrelabelModelConfig } from "../types/prelabel";

describe("prelabel model imports", () => {
  it("creates an editable persisted config from inspected metadata", () => {
    const config = createPrelabelModelConfig(
      String.raw`C:\models\yolo11n.onnx`,
      {
        format: "yolo11",
        classCount: 2,
        inputWidth: 640,
        inputHeight: 640,
        classNames: ["person", "car"],
      },
      "model-1",
      "2026-08-20T00:00:00.000Z",
    );

    expect(config).toEqual({
      id: "model-1",
      name: "yolo11n",
      path: String.raw`C:\models\yolo11n.onnx`,
      format: "yolo11",
      classCount: 2,
      inputWidth: 640,
      inputHeight: 640,
      inputSizeOverride: null,
      classNames: ["person", "car"],
      confidenceThreshold: 0.25,
      iouThreshold: 0.45,
      addedAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("builds copyable PT conversion guidance", () => {
    expect(modelNameFromPath("D:/模型/best.ONNX")).toBe("best");
    expect(ptConversionCommand("D:/models/best.pt")).toBe(
      'yolo export model="D:/models/best.pt" format=onnx imgsz=640',
    );
  });

  it("adds, updates, selects, and deletes models without loading model files", () => {
    const first = model("model-1", "first");
    const second = model("model-2", "second");
    const withFirst = addModelToLibrary(EMPTY_PRELABEL_MODEL_LIBRARY, first);
    const withSecond = addModelToLibrary(withFirst, second);

    expect(withSecond.currentModelId).toBe("model-1");
    expect(withSecond.models).toHaveLength(2);

    const selected = selectModelInLibrary(withSecond, "model-2");
    const updated = updateModelInLibrary(selected, { ...second, name: "renamed" });
    const deleted = deleteModelFromLibrary(updated, "model-2");

    expect(updated.models[1].name).toBe("renamed");
    expect(deleted.models).toEqual([first]);
    expect(deleted.currentModelId).toBe("model-1");
    expect(() => selectModelInLibrary(deleted, "missing")).toThrow("不存在");
  });

  it("builds and clears an input-size override from the model dimensions", () => {
    const config = model("model-1", "first");

    expect(updateInputSizeOverride(config, 0, "1280")).toEqual([1280, 640]);
    expect(updateInputSizeOverride(config, 1, "")).toBeNull();
    expect(updateInputSizeOverride({ ...config, inputSizeOverride: [1280, 720] }, 0, "")).toEqual([
      640, 720,
    ]);
  });
});

function model(id: string, name: string): PrelabelModelConfig {
  return createPrelabelModelConfig(
    `C:/models/${name}.onnx`,
    {
      format: "yolo11",
      classCount: 1,
      inputWidth: 640,
      inputHeight: 640,
      classNames: ["person"],
    },
    id,
    "2026-08-20T00:00:00.000Z",
  );
}
