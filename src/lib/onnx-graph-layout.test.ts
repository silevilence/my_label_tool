import { describe, expect, it } from "vitest";
import { fitGraph, layoutOnnxGraph, zoomGraph } from "./onnx-graph-layout";
import type { OnnxGraph } from "../types/onnx-graph";

function graph(count: number): OnnxGraph {
  return {
    name: "test",
    irVersion: 8,
    producer: "",
    opsets: { "": 17 },
    metadata: {},
    inputs: [],
    outputs: [],
    tensors: [],
    initializers: [],
    nodes: Array.from({ length: count }, (_, id) => ({
      id,
      name: "",
      opType: "Relu",
      domain: "",
      inputs: [],
      outputs: [],
      attributes: {},
    })),
    edges: [],
  };
}
describe("ONNX graph layout", () => {
  it("layers shuffled nodes, duplicate inputs, roots and disconnected branches", () => {
    const value = graph(5);
    value.nodes.reverse();
    value.edges = [
      { source: null, target: 0, tensor: "x", inputIndex: 0 },
      { source: 0, target: 1, tensor: "a", inputIndex: 0 },
      { source: 0, target: 1, tensor: "a", inputIndex: 1 },
      { source: 1, target: 2, tensor: "b", inputIndex: 0 },
    ];
    const layout = layoutOnnxGraph(value);
    expect(layout.positions.size).toBe(5);
    expect(layout.positions.get(2)!.x).toBeGreaterThan(layout.positions.get(1)!.x);
    expect(layout.positions.get(1)!.x).toBeGreaterThan(layout.positions.get(0)!.x);
    expect(layout.positions.get(3)!.y).not.toBe(layout.positions.get(4)!.y);
    expect(layout.width).toBeGreaterThan(layout.positions.get(2)!.x);
  });
  it("retains every node in a large graph and positions each node without overlap", () => {
    const value = graph(1000);
    value.edges = value.nodes
      .slice(1)
      .map((n) => ({ source: n.id - 1, target: n.id, tensor: String(n.id), inputIndex: 0 }));
    const layout = layoutOnnxGraph(value);
    expect(new Set([...layout.positions.values()].map((p) => `${p.x},${p.y}`)).size).toBe(1000);
    const fit = fitGraph(layout.width, layout.height, { x: 800, y: 500 });
    expect(layout.width * fit.scale).toBeLessThanOrEqual(800);
    expect(layout.height * fit.scale).toBeLessThanOrEqual(500);
    expect(layoutOnnxGraph(graph(0)).positions.size).toBe(0);
  });
  it("keeps the pointer anchor invariant and clamps excessive zoom", () => {
    const view = { x: -20, y: 40, scale: 0.5 };
    const anchor = { x: 100, y: 120 };
    const next = zoomGraph(view, 2, anchor);
    expect((anchor.x - next.x) / next.scale).toBe((anchor.x - view.x) / view.scale);
    expect((anchor.y - next.y) / next.scale).toBe((anchor.y - view.y) / view.scale);
    expect(zoomGraph(view, 1000, anchor).scale).toBe(4);
    expect(zoomGraph(view, 0.00001, anchor).scale).toBe(0.01);
    expect(fitGraph(100, 100, { x: 800, y: 500 })).toEqual({ x: 350, y: 200, scale: 1 });
  });
});
