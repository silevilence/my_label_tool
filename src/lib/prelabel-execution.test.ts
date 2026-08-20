import { describe, expect, it } from "vitest";
import {
  chunkPrelabelImages,
  executePrelabelBatch,
  selectPrelabelBatchImages,
} from "./prelabel-execution";
import type { ImageFile } from "./tauri-api";

const images: ImageFile[] = [
  { path: "a.jpg", name: "a.jpg" },
  { path: "b.jpg", name: "b.jpg" },
  { path: "c.jpg", name: "c.jpg" },
];

describe("prelabel execution planning", () => {
  it("skips annotated images by default and includes all images when forced", () => {
    const annotations = {
      "a.jpg": [{ id: "a", type: "rect" as const, labelId: "person", points: [1, 2, 3, 4] }],
      "b.jpg": [],
    };

    expect(selectPrelabelBatchImages(images, annotations, false).map((image) => image.path)).toEqual([
      "b.jpg",
      "c.jpg",
    ]);
    expect(selectPrelabelBatchImages(images, annotations, true)).toEqual(images);
  });

  it("chunks images without dropping their order", () => {
    expect(chunkPrelabelImages(images, 2)).toEqual([[images[0], images[1]], [images[2]]]);
    expect(() => chunkPrelabelImages(images, 0)).toThrow("批量大小必须为正整数");
  });

  it("commits completed chunks before honoring cancellation", async () => {
    const committed: string[][] = [];
    const progress: number[] = [];
    let cancelled = false;

    const summary = await executePrelabelBatch({
      images,
      chunkSize: 2,
      infer: async (paths) =>
        paths.map((imagePath) => ({
          imagePath,
          detections: [{ classIndex: 0, confidence: 0.9, points: [1, 2, 3, 4] }],
        })),
      toAnnotations: (result) => [
        { id: result.imagePath, type: "rect", labelId: "person", points: [1, 2, 3, 4] },
      ],
      commit: (entries) => {
        committed.push(entries.map((entry) => entry.imagePath));
        cancelled = true;
      },
      isCancelled: () => cancelled,
      onProgress: (processed) => progress.push(processed),
    });

    expect(committed).toEqual([["a.jpg", "b.jpg"]]);
    expect(progress).toEqual([2]);
    expect(summary).toEqual({
      processed: 2,
      annotationCount: 2,
      cancelled: true,
      skippedConflictCount: 0,
    });
  });

  it("rejects stale task context before committing results", async () => {
    await expect(
      executePrelabelBatch({
        images: [images[0]],
        chunkSize: 1,
        infer: async () => [{ imagePath: "a.jpg", detections: [] }],
        toAnnotations: () => [],
        commit: () => {
          throw new Error("must not commit");
        },
        isContextCurrent: () => false,
        isCancelled: () => false,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow("项目、标签或模型已在执行期间改变");
  });

  it("keeps prior chunks when a later inference fails and skips edited-image conflicts", async () => {
    const committed: string[][] = [];
    let callCount = 0;
    await expect(
      executePrelabelBatch({
        images,
        chunkSize: 2,
        infer: async (paths) => {
          callCount += 1;
          if (callCount === 2) {
            throw new Error("inference failed");
          }
          return paths.map((imagePath) => ({ imagePath, detections: [] }));
        },
        toAnnotations: () => [],
        commit: (entries) => committed.push(entries.map((entry) => entry.imagePath)),
        shouldCommit: (entry) => entry.imagePath !== "b.jpg",
        isContextCurrent: () => true,
        isCancelled: () => false,
        onProgress: () => undefined,
      }),
    ).rejects.toThrow("inference failed");
    expect(committed).toEqual([["a.jpg"]]);
  });
});
