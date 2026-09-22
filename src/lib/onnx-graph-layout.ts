import type { OnnxGraph } from "../types/onnx-graph";

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 60;
export interface GraphPosition {
  x: number;
  y: number;
}

/** Kahn layering, independent of protobuf node order. Each node appears exactly once. */
export function layoutOnnxGraph(graph: OnnxGraph) {
  const degree = new Map(graph.nodes.map((node) => [node.id, 0]));
  const children = new Map<number, number[]>();
  const layers = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    if (edge.source === null) continue;
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    const list = children.get(edge.source) ?? [];
    list.push(edge.target);
    children.set(edge.source, list);
  }
  const queue = graph.nodes.filter((node) => degree.get(node.id) === 0).map((node) => node.id);
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    for (const child of children.get(id) ?? []) {
      layers.set(child, Math.max(layers.get(child) ?? 0, (layers.get(id) ?? 0) + 1));
      const remaining = (degree.get(child) ?? 1) - 1;
      degree.set(child, remaining);
      if (remaining === 0) queue.push(child);
    }
  }
  const counts = new Map<number, number>();
  const positions = new Map<number, GraphPosition>();
  let width = NODE_WIDTH + 48,
    height = NODE_HEIGHT + 48;
  for (const node of graph.nodes) {
    const layer = layers.get(node.id) ?? 0;
    const row = counts.get(layer) ?? 0;
    counts.set(layer, row + 1);
    const position = { x: 32 + layer * 280, y: 32 + row * 110 };
    positions.set(node.id, position);
    width = Math.max(width, position.x + NODE_WIDTH + 32);
    height = Math.max(height, position.y + NODE_HEIGHT + 32);
  }
  return { positions, width, height };
}

export interface GraphView {
  x: number;
  y: number;
  scale: number;
}
export function fitGraph(width: number, height: number, viewport: GraphPosition): GraphView {
  const scale = Math.min(viewport.x / width, viewport.y / height, 1);
  return { x: (viewport.x - width * scale) / 2, y: (viewport.y - height * scale) / 2, scale };
}
export function zoomGraph(view: GraphView, factor: number, anchor: GraphPosition): GraphView {
  const scale = Math.max(0.01, Math.min(4, view.scale * factor));
  return {
    scale,
    x: anchor.x - ((anchor.x - view.x) * scale) / view.scale,
    y: anchor.y - ((anchor.y - view.y) * scale) / view.scale,
  };
}
