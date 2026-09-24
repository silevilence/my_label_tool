import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLabelSamples, type LabelSamples } from "./useLabelSamples";
import type { LabelConfig } from "../types/annotation";

const api = vi.hoisted(() => ({
  createLabelSampleCrop: vi.fn(),
  discardLabelSampleCrop: vi.fn(),
  previewProjectLabelSample: vi.fn(),
  listLabelSamples: vi.fn(),
  selectLabelSample: vi.fn(),
  previewLabelSample: vi.fn(),
  prepareLabelSamples: vi.fn(),
  finishLabelSamples: vi.fn(),
  openLabelSampleDirectory: vi.fn(),
}));
vi.mock("../lib/tauri-api", () => api);
const label: LabelConfig = { id: "a", name: "旧名", color: "#000000", shapeType: "any" };
const initialLabels = [label];
const roots: ReturnType<typeof createRoot>[] = [];
function harness(folder = "C:/project") {
  let controller!: LabelSamples;
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  function Harness({ path, labels }: { path: string; labels: LabelConfig[] }) {
    controller = useLabelSamples(path, labels, "template");
    return null;
  }
  const render = (path = folder, labels = initialLabels) =>
    act(() => root.render(<Harness path={path} labels={labels} />));
  render();
  return {
    get current() {
      return controller;
    },
    render,
  };
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  api.listLabelSamples.mockResolvedValue([{ name: "旧名", fileName: "旧名.png", preview: "old" }]);
  api.selectLabelSample.mockResolvedValue("C:/input.png");
  api.previewLabelSample.mockResolvedValue("new");
  api.prepareLabelSamples.mockResolvedValue(7);
  api.finishLabelSamples.mockResolvedValue(undefined);
  api.createLabelSampleCrop.mockResolvedValue({ path: "C:/cache/crop.png", preview: "cropped" });
  api.discardLabelSampleCrop.mockResolvedValue(undefined);
});
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
});

it("stages previews without writing and cancel leaves no filesystem transaction", async () => {
  const h = harness();
  await act(() => h.current.refresh());
  expect(h.current.preview({ ...label, name: "重命名" })).toBe("old");
  await act(() => h.current.choose("a"));
  expect(h.current.preview(label)).toBe("new");
  expect(h.current.dirty).toBe(true);
  expect(api.prepareLabelSamples).not.toHaveBeenCalled();
  act(() => h.current.reset());
  expect(h.current.preview(label)).toBe("old");
  expect(h.current.dirty).toBe(false);
  act(() => h.current.clear("a"));
  expect(h.current.preview(label)).toBeUndefined();
});

it("saves stable original names, commits only after persistence, and refreshes external replacements", async () => {
  const h = harness();
  await act(() => h.current.choose("a"));
  const persist = vi.fn(async () => {
    expect(api.finishLabelSamples).not.toHaveBeenCalled();
  });
  await act(async () => {
    expect(await h.current.save([{ ...label, name: "新名" }], persist)).toBe(true);
  });
  expect(api.prepareLabelSamples).toHaveBeenCalledWith("C:/project", [
    { name: "新名", originalName: "旧名", sourcePath: "C:/input.png", clear: false },
  ]);
  expect(api.finishLabelSamples).toHaveBeenCalledWith(7, true);
  expect(h.current.dirty).toBe(false);
  await act(() => h.current.refresh());
  api.listLabelSamples.mockResolvedValue([
    { name: "旧名", fileName: "旧名.png", preview: "external" },
  ]);
  await act(() => h.current.refresh());
  expect(h.current.preview(label)).toBe("external");
});

it("rolls images back on persistence failure and retains the draft for retry", async () => {
  const h = harness();
  await act(() => h.current.choose("a"));
  await act(async () => {
    expect(
      await h.current.save(initialLabels, async () => {
        throw new Error("disk full");
      }),
    ).toBe(false);
  });
  expect(api.finishLabelSamples).toHaveBeenCalledWith(7, false);
  expect(h.current.error).toBe("disk full");
  expect(h.current.dirty).toBe(true);
  expect(h.current.busy).toBe(false);
});

it("rejects conflicts before persisting and permits ordinary editing without a project", async () => {
  const h = harness();
  const persist = vi.fn(async () => {});
  const conflicting = [
    { ...label, name: "a/b" },
    { ...label, id: "b", name: "a:b" },
  ];
  await act(async () => {
    expect(await h.current.save(conflicting, persist)).toBe(false);
  });
  expect(h.current.error).toContain("冲突");
  expect(persist).not.toHaveBeenCalled();
  expect(api.prepareLabelSamples).not.toHaveBeenCalled();
  h.render("");
  await act(async () => {
    expect(await h.current.save(conflicting, persist)).toBe(true);
  });
  expect(persist).toHaveBeenCalledTimes(1);
  expect(api.prepareLabelSamples).not.toHaveBeenCalled();
});

it("ignores stale picker and listing results after changing project", async () => {
  const h = harness();
  let resolve!: (value: string) => void;
  api.previewLabelSample.mockReturnValue(
    new Promise<string>((r) => {
      resolve = r;
    }),
  );
  let choosing!: Promise<boolean>;
  await act(async () => {
    choosing = h.current.choose("a");
  });
  h.render("C:/other");
  await act(async () => {
    resolve("late");
    await choosing;
  });
  expect(h.current.dirty).toBe(false);
  expect(h.current.preview(label)).toBeUndefined();
});

it("keeps one save active and reports load, picker and rollback failures", async () => {
  const h = harness();
  api.listLabelSamples.mockRejectedValueOnce("load failed");
  await act(() => h.current.refresh());
  expect(h.current.error).toBe("load failed");
  api.selectLabelSample.mockRejectedValueOnce("picker failed");
  await act(() => h.current.choose("a"));
  expect(h.current.error).toBe("picker failed");
  let resolve!: () => void;
  const waiting = new Promise<void>((r) => {
    resolve = r;
  });
  let saving!: Promise<boolean>;
  await act(async () => {
    saving = h.current.save(initialLabels, () => waiting);
  });
  await act(async () => {
    expect(await h.current.save(initialLabels, vi.fn())).toBe(false);
    resolve();
    await saving;
  });
  api.finishLabelSamples
    .mockRejectedValueOnce("commit failed")
    .mockRejectedValueOnce("rollback failed");
  await act(async () => {
    expect(await h.current.save(initialLabels, async () => {})).toBe(false);
  });
  expect(h.current.error).toContain("恢复失败");
});

const candidate = {
  imagePath: "C:/project/image.png",
  imageName: "image.png",
  annotationId: "s",
  bounds: { x: 1, y: 2, width: 3, height: 4 },
};
it("materializes a crop on selection and removes it only after successful save", async () => {
  const h = harness();
  await act(async () => {
    expect(await h.current.chooseCrop("a", candidate)).toBe(true);
  });
  expect(api.createLabelSampleCrop).toHaveBeenCalledWith(
    "C:/project",
    candidate.imagePath,
    candidate.bounds,
  );
  expect(h.current.preview(label)).toBe("cropped");
  await act(async () => {
    await h.current.save(initialLabels, async () => {
      throw new Error("save failed");
    });
  });
  expect(api.discardLabelSampleCrop).not.toHaveBeenCalled();
  await act(async () => {
    await h.current.save(initialLabels, async () => {});
  });
  expect(api.prepareLabelSamples).toHaveBeenLastCalledWith("C:/project", [
    { name: "旧名", originalName: "旧名", sourcePath: "C:/cache/crop.png", clear: false },
  ]);
  expect(api.discardLabelSampleCrop).toHaveBeenCalledWith("C:/cache/crop.png");
});

it("cleans generated files when cancelled, cleared, replaced or project changes", async () => {
  const h = harness();
  await act(() => h.current.chooseCrop("a", candidate));
  await act(async () => h.current.reset());
  expect(api.discardLabelSampleCrop).toHaveBeenCalledTimes(1);
  await act(() => h.current.chooseCrop("a", candidate));
  await act(async () => h.current.clear("a"));
  expect(api.discardLabelSampleCrop).toHaveBeenCalledTimes(2);
  await act(() => h.current.chooseCrop("a", candidate));
  await act(() => h.current.choose("a"));
  expect(api.discardLabelSampleCrop).toHaveBeenCalledTimes(3);
  await act(() => h.current.chooseCrop("a", candidate));
  h.render("C:/other");
  expect(api.discardLabelSampleCrop).toHaveBeenCalledTimes(4);
});

it("discards a late crop after project change and preserves the previous draft on crop failure", async () => {
  const h = harness();
  await act(() => h.current.choose("a"));
  api.createLabelSampleCrop.mockRejectedValueOnce(new Error("image missing"));
  await act(async () => {
    expect(await h.current.chooseCrop("a", candidate)).toBe(false);
  });
  expect(h.current.preview(label)).toBe("new");
  let resolve!: (value: { path: string; preview: string }) => void;
  api.createLabelSampleCrop.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    }),
  );
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = h.current.chooseCrop("a", candidate);
  });
  h.render("C:/other");
  await act(async () => {
    resolve({ path: "late.png", preview: "late" });
    expect(await pending).toBe(false);
  });
  expect(api.discardLabelSampleCrop).toHaveBeenCalledWith("late.png");
  expect(h.current.dirty).toBe(false);
});
