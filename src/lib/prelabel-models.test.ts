import { describe, expect, it } from "vitest";
import {
  addModelToLibrary,
  applyModelDownloadResult,
  createPrelabelModelConfig,
  deleteModelFromLibrary,
  isValidModelSourceUrl,
  modelNameFromPath,
  prelabelFormatLabel,
  selectModelInLibrary,
  updateInputSizeOverride,
  updateModelInLibrary,
} from "./prelabel-models";
import {
  EMPTY_PRELABEL_MODEL_LIBRARY,
  type ModelDownloadResult,
  type PrelabelModelConfig,
} from "../types/prelabel";

describe("prelabel model imports", () => {
  it("formats persisted YOLO variants for user-visible summaries", () => {
    expect(prelabelFormatLabel("yolov5")).toBe("YOLOv5");
    expect(prelabelFormatLabel("yolov8")).toBe("YOLOv8");
    expect(prelabelFormatLabel("yolo11")).toBe("YOLO11");
  });

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
      device: "auto",
    });
  });

  it("derives a model name from a PT conversion output path", () => {
    expect(modelNameFromPath("D:/模型/best.ONNX")).toBe("best");
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
    expect(updateInputSizeOverride({ ...config, inputSizeOverride: [640, 720] }, 1, "")).toBeNull();
  });

  it("creates a usable default override for dynamic spatial dimensions", () => {
    const config = createPrelabelModelConfig(
      "C:/models/dynamic.onnx",
      {
        format: "yolov8",
        classCount: 1,
        inputWidth: 0,
        inputHeight: 0,
        classNames: ["person"],
      },
      "dynamic-model",
      "2026-08-20T00:00:00.000Z",
    );

    expect(config.inputSizeOverride).toEqual([640, 640]);
    expect(updateInputSizeOverride(config, 0, "1280")).toEqual([1280, 640]);
  });

  it("accepts only http(s) URLs pointing at an .onnx file", () => {
    expect(isValidModelSourceUrl("https://example.com/models/yolo11n.onnx")).toBe(true);
    expect(isValidModelSourceUrl("http://example.com/yolo11n.onnx?token=abc")).toBe(true);
    expect(isValidModelSourceUrl("  https://example.com/YOLO11n.ONNX  ")).toBe(true);
    expect(isValidModelSourceUrl("ftp://example.com/yolo11n.onnx")).toBe(false);
    expect(isValidModelSourceUrl("file:///etc/passwd")).toBe(false);
    expect(isValidModelSourceUrl("https://example.com/releases/latest")).toBe(false);
    expect(isValidModelSourceUrl("https://")).toBe(false);
    expect(isValidModelSourceUrl("")).toBe(false);
    expect(isValidModelSourceUrl("not a url")).toBe(false);
  });

  it("applies a download result onto the model config and stamps the update time", () => {
    const model = baseModel();
    const result: ModelDownloadResult = {
      path: "C:/appdata/models/yolo11n-1000.onnx",
      format: "yolov8",
      classCount: 3,
      inputWidth: 640,
      inputHeight: 640,
      classNames: ["a", "b", "c"],
    };

    const next = applyModelDownloadResult(model, result, "2026-09-09T00:00:00.000Z");

    expect(next.path).toBe(result.path);
    expect(next.format).toBe("yolov8");
    expect(next.classCount).toBe(3);
    expect(next.classNames).toEqual(["a", "b", "c"]);
    expect(next.updatedAt).toBe("2026-09-09T00:00:00.000Z");
    expect(next.sourceUrl).toBe("https://example.com/yolo11n.onnx");
    expect(next.id).toBe(model.id);
    expect(next.name).toBe(model.name);
    expect(next.confidenceThreshold).toBe(model.confidenceThreshold);
  });

  it("defaults the update time to now and keeps an unset source url unset", () => {
    const model = baseModel();
    delete model.sourceUrl;
    const result: ModelDownloadResult = {
      path: "C:/appdata/models/yolo11n-1000.onnx",
      format: "yolo11",
      classCount: 1,
      inputWidth: 640,
      inputHeight: 640,
      classNames: ["person"],
    };

    const next = applyModelDownloadResult(model, result);

    expect(next.updatedAt).toEqual(expect.any(String));
    expect(Number.isNaN(Date.parse(next.updatedAt ?? ""))).toBe(false);
    expect(next.sourceUrl).toBeUndefined();
  });
});

function baseModel(): PrelabelModelConfig {
  return {
    ...model("model-1", "yolo11n"),
    sourceUrl: "https://example.com/yolo11n.onnx",
  };
}

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
