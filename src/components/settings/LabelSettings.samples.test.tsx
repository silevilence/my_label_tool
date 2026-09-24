import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LabelSettings } from "./LabelSettings";
import { useLabelSamples } from "../../hooks/useLabelSamples";
import type { LabelConfig } from "../../types/annotation";
import { useAnnotationStore } from "../../store/useAnnotationStore";

const api = vi.hoisted(() => ({
  createLabelSampleCrop: vi.fn(async () => ({
    path: "C:/cache/crop.png",
    preview: "data:image/png;base64,cropped",
  })),
  discardLabelSampleCrop: vi.fn(async () => {}),
  previewProjectLabelSample: vi.fn(async () => "data:image/png;base64,candidate"),
  listLabelSamples: vi.fn(async () => [
    { name: "人", fileName: "人.png", preview: "data:image/png;base64,old" },
  ]),
  selectLabelSample: vi.fn(async () => "sample.png"),
  previewLabelSample: vi.fn(async () => "data:image/png;base64,new"),
  prepareLabelSamples: vi.fn(async () => 1),
  finishLabelSamples: vi.fn(async () => {}),
  openLabelSampleDirectory: vi.fn(async () => {}),
}));
vi.mock("../../lib/tauri-api", () => api);
const initial: LabelConfig[] = [{ id: "a", name: "人", color: "#000000", shapeType: "rect" }];
const roots: ReturnType<typeof createRoot>[] = [];
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (item) => item.getAttribute("aria-label") === name || item.textContent === name,
  )!;
function render(folder: string) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  function Harness() {
    const [labels, setLabels] = useState(initial);
    const samples = useLabelSamples(folder, initial, "built-in");
    return (
      <LabelSettings
        labels={labels}
        templates={[]}
        selectedTemplateId="built-in"
        pluginTemplateSources={new Map()}
        isDirty={labels !== initial}
        canSaveTemplate={false}
        canDeleteTemplate={false}
        usedLabelIds={new Set()}
        samples={samples}
        onChangeLabels={setLabels}
        onCancelChanges={() => {
          samples.reset();
          setLabels(initial);
        }}
        onSaveTemplate={() => void samples.save(labels, async () => {})}
        onSaveAndUpdateTemplate={vi.fn()}
        onNewTemplate={vi.fn()}
        onSaveTemplateAs={vi.fn()}
        onDeleteTemplate={vi.fn()}
        onSelectTemplate={vi.fn()}
      />
    );
  }
  act(() => root.render(<Harness />));
}
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
  useAnnotationStore.setState({ images: [], annotationsByImage: {}, selectedPath: "" });
});

it("shows disabled sample controls without disabling label editing when no project is open", async () => {
  render("");
  await act(async () => button("管理模板和标签").click());
  expect(document.body.textContent).toContain("打开项目目录后");
  expect(button("设置 人 的样例图").disabled).toBe(true);
  expect(button("打开 icon 目录").disabled).toBe(true);
  expect((document.querySelector('[aria-label="标签名称"]') as HTMLInputElement).disabled).toBe(
    false,
  );
  expect(api.listLabelSamples).not.toHaveBeenCalled();
});

it("refreshes on each open, expands preview, stages replacement, and cancels without writes", async () => {
  render("C:/project");
  await act(async () => button("管理模板和标签").click());
  expect(document.querySelector("img")?.src).toBe("data:image/png;base64,old");
  await act(async () => button("人 样例图预览").click());
  expect(document.querySelectorAll('[role="dialog"]').length).toBe(2);
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  await act(async () => button("设置 人 的样例图").click());
  await act(async () => button("从文件选择").click());
  expect(document.querySelector("img")?.src).toBe("data:image/png;base64,new");
  expect(button("保存").disabled).toBe(false);
  await act(async () => button("取消修改").click());
  expect(document.querySelector("img")?.src).toBe("data:image/png;base64,old");
  expect(api.prepareLabelSamples).not.toHaveBeenCalled();
  await act(async () => button("打开 icon 目录").click());
  expect(api.openLabelSampleDirectory).toHaveBeenCalledWith("C:/project");
  await act(async () => button("关闭").click());
  await act(async () => button("管理模板和标签").click());
  expect(api.listLabelSamples).toHaveBeenCalledTimes(2);
  await act(async () => button("清除 人 的样例图").click());
  expect(document.querySelector("img")).toBeNull();
});

it("offers same-label project crops and writes a file only when a candidate is selected", async () => {
  useAnnotationStore.setState({
    images: [{ path: "C:/project/image.png", name: "image.png" }],
    selectedPath: "C:/project/image.png",
    annotationsByImage: {
      "C:/project/image.png": [
        { id: "match", labelId: "a", type: "rect", points: [10, 20, 30, 40] },
        { id: "other", labelId: "b", type: "rect", points: [50, 60, 30, 40] },
      ],
    },
  });
  render("C:/project");
  await act(async () => button("管理模板和标签").click());
  await act(async () => button("设置 人 的样例图").click());
  expect(document.body.textContent).toContain("1 个标注");
  expect(api.previewProjectLabelSample).toHaveBeenCalledWith("C:/project", "C:/project/image.png", {
    x: 10,
    y: 20,
    width: 30,
    height: 40,
  });
  expect(api.createLabelSampleCrop).not.toHaveBeenCalled();
  await act(async () => button("image.png · 标注 1").click());
  expect(api.createLabelSampleCrop).toHaveBeenCalledTimes(1);
  expect(document.querySelector("img")?.src).toBe("data:image/png;base64,cropped");
  await act(async () => button("取消修改").click());
  expect(api.discardLabelSampleCrop).toHaveBeenCalledWith("C:/cache/crop.png");
});

it("loads only one page of previews and lets failed images coexist with usable candidates", async () => {
  useAnnotationStore.setState({
    images: [{ path: "C:/project/page.png", name: "page.png" }],
    annotationsByImage: {
      "C:/project/page.png": Array.from({ length: 13 }, (_, index) => ({
        id: `shape-${index}`,
        labelId: "a",
        type: "rect" as const,
        points: [index, 0, 10, 10],
      })),
    },
  });
  api.previewProjectLabelSample.mockRejectedValueOnce(new Error("missing image"));
  render("C:/project");
  await act(async () => button("管理模板和标签").click());
  await act(async () => button("设置 人 的样例图").click());
  expect(api.previewProjectLabelSample).toHaveBeenCalledTimes(12);
  expect(button("page.png · 标注 1").disabled).toBe(true);
  expect(button("page.png · 标注 2").disabled).toBe(false);
  await act(async () => button("下一页").click());
  expect(api.previewProjectLabelSample).toHaveBeenCalledTimes(13);
  expect(button("下一页").disabled).toBe(true);
  await act(async () => button("page.png · 标注 13").click());
  expect(api.createLabelSampleCrop).toHaveBeenCalledWith("C:/project", "C:/project/page.png", {
    x: 12,
    y: 0,
    width: 10,
    height: 10,
  });
});
