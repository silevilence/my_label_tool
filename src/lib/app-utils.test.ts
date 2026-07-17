import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { ImageFile } from "./tauri-api";
import { useAnnotationStore } from "../store/useAnnotationStore";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(async () => true),
  open: vi.fn(),
  save: vi.fn(),
}));

import {
  baseName,
  confirmReplaceCurrentAnnotations,
  isRecord,
  isEditableTarget,
  isUserTemplate,
  joinPath,
  loadImageSize,
  matchImportedImages,
  mergeShortcuts,
  newAnnotationId,
  newTemplateId,
  normalizePath,
  parseCustomMapping,
  projectConfigPath,
  saveProjectConfig,
} from "./app-utils";

describe("app utils", () => {
  beforeEach(() => {
    useAnnotationStore.setState({
      annotationsByImage: {},
      selectedShapeId: null,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    });
  });

  it("merges saved shortcuts without accepting unknown actions", () => {
    expect(mergeShortcuts({ nextImage: "d", ignored: "x" })).toMatchObject({
      previousImage: "ArrowLeft",
      nextImage: "d",
    });
  });

  it("matches imported images by normalized path first and file name as fallback", () => {
    const currentImages: ImageFile[] = [
      { path: "C:\\Images\\A.JPG", name: "A.JPG" },
      { path: "C:/Images/b.jpg", name: "b.jpg" },
    ];
    const result = matchImportedImages(
      {
        labels: [],
        images: [
          { path: "c:/images/a.jpg", name: "wrong.jpg", annotations: [{ id: "a", type: "rect", labelId: "x", points: [1, 2, 3, 4] }] },
          { name: "B.JPG", annotations: [{ id: "b", type: "point", labelId: "x", points: [1, 2] }] },
          { name: "missing.jpg", annotations: [] },
        ],
      },
      currentImages,
    );

    expect(result.missingCount).toBe(1);
    expect(Object.keys(result.annotationsByImage)).toEqual(["C:\\Images\\A.JPG", "C:/Images/b.jpg"]);
  });

  it("builds stable paths and base names across separators", () => {
    expect(joinPath("C:\\images\\", "a.json")).toBe("C:\\images\\a.json");
    expect(joinPath("/tmp/images/", "a.json")).toBe("/tmp/images/a.json");
    expect(projectConfigPath("/tmp/images")).toBe("/tmp/images/my-label-tool.project.json");
    expect(normalizePath("C:\\Images\\A.JPG")).toBe("c:/images/a.jpg");
    expect(baseName("C:/images/a.test.jpg")).toBe("a.test");
  });

  it("parses custom mapping and rejects bad mapping JSON", () => {
    expect(parseCustomMapping(JSON.stringify({ imagePath: "path", imageName: "name", labelId: "id", labelName: "label", bbox: "box", attributes: "attrs" }))).toEqual({
      imagePath: "path",
      imageName: "name",
      labelId: "id",
      labelName: "label",
      bbox: "box",
      attributes: "attrs",
    });
    expect(() => parseCustomMapping("[]")).toThrow("必须是 JSON 对象");
    expect(() => parseCustomMapping(JSON.stringify({ imagePath: "" }))).toThrow("必须是非空字符串");
  });

  it("detects records and creates unique user template ids", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(newTemplateId([{ id: "user-demo", name: "Demo", labels: [] }], "Demo")).toBe("user-demo-2");
    expect(newTemplateId([], "中文 模板!")).toBe("user-中文-模板");
    expect(newTemplateId([], "   ")).toBe("user-template");
  });

  it("detects editable DOM targets and user templates", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    expect(isUserTemplate("common-detection")).toBe(false);
    expect(isUserTemplate("project-config")).toBe(true);
  });

  it("loads image dimensions through browser Image", async () => {
    class FakeImage {
      naturalWidth = 640;
      naturalHeight = 480;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;

      set src(value: string) {
        if (value.includes("bad")) {
          this.onerror?.();
        } else {
          this.onload?.();
        }
      }
    }

    vi.stubGlobal("Image", FakeImage);

    await expect(loadImageSize("ok.png")).resolves.toEqual({ width: 640, height: 480 });
    await expect(loadImageSize("bad.png")).rejects.toThrow("无法读取图片尺寸：bad.png");
    vi.unstubAllGlobals();
  });

  it("skips overwrite confirmation when current images have no annotations", async () => {
    await expect(confirmReplaceCurrentAnnotations([{ path: "a.jpg", name: "a.jpg" }])).resolves.toBe(true);
  });

  it("delegates project config saves and creates annotation ids", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await saveProjectConfig("project.json", {
      schemaVersion: 1,
      format: "json",
      annotationPath: "annotations.json",
      imageFolder: "C:/images",
      exportedAt: "2026-01-01T00:00:00.000Z",
      labels: [],
      template: { id: "project-config", name: "项目临时配置" },
      exportOptions: { format: "json" },
    });

    expect(invoke).toHaveBeenCalledWith("export_annotations_json", {
      outputPath: "project.json",
      data: expect.objectContaining({ schemaVersion: 1 }),
    });
    expect(newAnnotationId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
