import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnnxGraphDialog } from "./OnnxGraphDialog";
import type { OnnxGraph } from "../../types/onnx-graph";
import { ONNX_GRAPH_ZH_CN as text } from "../../i18n/onnx-graph.zh-CN";
const api = vi.hoisted(() => ({ inspectOnnxGraph: vi.fn() }));
vi.mock("../../lib/tauri-api", () => api);
const data: OnnxGraph = {
  name: "test",
  producer: "test",
  irVersion: 8,
  opsets: { "": 17 },
  metadata: {},
  inputs: ["input"],
  outputs: ["output"],
  tensors: [
    { name: "input", shape: [1, 3, 640, 640], dataType: 1, origin: "disk" },
    { name: "output", shape: [1, 16, 320, 320], dataType: null, origin: "inferred" },
    { name: "unknown", shape: null, dataType: null, origin: "unknown" },
  ],
  initializers: [
    { name: "weight", shape: [16, 3, 3, 3], dataType: 1, byteSize: 1728, external: false },
  ],
  nodes: [
    {
      id: 0,
      name: "conv",
      opType: "Conv",
      domain: "",
      inputs: ["input", "weight", "unknown"],
      outputs: ["output"],
      attributes: { strides: [2, 2] },
    },
  ],
  edges: [{ source: null, target: 0, inputIndex: 0, tensor: "input" }],
};
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
const close = vi.fn();
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(SVGElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 800,
    height: 400,
    right: 800,
    bottom: 400,
    toJSON() {},
  });
  api.inspectOnnxGraph.mockReset();
  close.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(path = "model.onnx") {
  await act(async () => root.render(<OnnxGraphDialog path={path} onClose={close} />));
}
function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent === label || b.getAttribute("aria-label") === label,
  )!;
}

it("shows real graph data without requiring any runtime API and distinguishes shape sources", async () => {
  api.inspectOnnxGraph.mockResolvedValue(data);
  await render();
  expect(api.inspectOnnxGraph).toHaveBeenCalledWith("model.onnx");
  expect(document.querySelectorAll("[data-node-id]")).toHaveLength(1);
  await act(async () =>
    document
      .querySelector("[data-node-id]")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  expect(document.body.textContent).toContain("1,728 B");
  expect(document.body.textContent).toContain("[16 × 3 × 3 × 3]");
  expect(document.body.textContent).toContain('"strides"');
  expect(document.body.textContent).toContain(text.disk);
  expect(document.body.textContent).toContain(text.inferred);
  expect(document.body.textContent).toContain(text.unknown);
  await act(async () => {
    button(text.zoomIn).click();
    await new Promise((r) => requestAnimationFrame(r));
  });
  const before = document.querySelector("svg > g")!.getAttribute("transform");
  await act(async () => {
    document
      .querySelector("svg")!
      .dispatchEvent(
        new WheelEvent("wheel", { deltaY: -100, clientX: 100, clientY: 100, bubbles: true }),
      );
    await new Promise((r) => requestAnimationFrame(r));
  });
  expect(document.querySelector("svg > g")!.getAttribute("transform")).not.toBe(before);
  await act(async () => {
    button(text.fit).click();
    await new Promise((r) => requestAnimationFrame(r));
  });
  act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenCalledOnce();
});

it("keeps failures visible, supports retry, and ignores stale results after a file switch", async () => {
  api.inspectOnnxGraph.mockRejectedValueOnce("ModelProto: damaged");
  await render();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("damaged");
  let finish: (value: OnnxGraph) => void = () => undefined;
  api.inspectOnnxGraph.mockReturnValueOnce(
    new Promise<OnnxGraph>((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => button(text.retry).click());
  expect(document.querySelector('[role="status"]')?.textContent).toBe(text.loading);
  api.inspectOnnxGraph.mockResolvedValueOnce({ ...data, nodes: [], initializers: [], edges: [] });
  await render("new.onnx");
  await act(async () => finish(data));
  expect(document.querySelectorAll("[data-node-id]")).toHaveLength(0);
  act(() => button(text.close).click());
  expect(close).toHaveBeenCalledOnce();
});

it("pans without selecting a node, then allows the next click to select", async () => {
  api.inspectOnnxGraph.mockResolvedValue(data);
  await render();
  const svg = document.querySelector("svg")!;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = vi.fn(() => true);
  svg.releasePointerCapture = vi.fn();
  const node = document.querySelector("[data-node-id]")!;
  const pointer = (name: string, x: number) =>
    node.dispatchEvent(
      new MouseEvent(name, { bubbles: true, button: 0, clientX: x, clientY: 100 }),
    );
  await act(async () => {
    pointer("pointerdown", 100);
    pointer("pointermove", 160);
    pointer("pointerup", 160);
    await Promise.resolve();
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
  expect(document.querySelector("select")?.value).toBe("");
  await act(async () => {
    pointer("pointerdown", 160);
    pointer("pointerup", 160);
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(document.querySelector("select")?.value).toBe("0");
});
