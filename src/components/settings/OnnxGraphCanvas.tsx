import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { OnnxGraph } from "../../types/onnx-graph";
import {
  fitGraph,
  layoutOnnxGraph,
  NODE_HEIGHT,
  NODE_WIDTH,
  zoomGraph,
  type GraphView,
} from "../../lib/onnx-graph-layout";
import { ONNX_GRAPH_ZH_CN as text } from "../../i18n/onnx-graph.zh-CN";

type Layout = ReturnType<typeof layoutOnnxGraph>;
const Scene = memo(function Scene({
  graph,
  layout,
  selected,
  onSelect,
}: {
  graph: OnnxGraph;
  layout: Layout;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <>
      {graph.edges.map((edge, index) => {
        const target = layout.positions.get(edge.target)!;
        const source = edge.source === null ? null : layout.positions.get(edge.source);
        const x1 = source ? source.x + NODE_WIDTH : target.x - 24;
        const y1 = source ? source.y + NODE_HEIGHT / 2 : target.y + 12;
        const y2 = target.y + NODE_HEIGHT / 2;
        const active = edge.source === selected || edge.target === selected;
        return (
          <g key={index} className={active ? "text-sky-400" : "text-slate-600"}>
            <path
              d={`M${x1},${y1} C${x1 + 40},${y1} ${target.x - 40},${y2} ${target.x},${y2}`}
              stroke="currentColor"
              fill="none"
              markerEnd="url(#onnx-arrow)"
            />
            <text x={x1 + 5} y={y1 - 5 - edge.inputIndex * 10} fill="currentColor" fontSize="9">
              {edge.tensor.length > 28 ? `…${edge.tensor.slice(-27)}` : edge.tensor}
            </text>
            <title>{edge.tensor}</title>
          </g>
        );
      })}
      {graph.nodes.map((node) => {
        const pos = layout.positions.get(node.id)!;
        return (
          <g
            key={node.id}
            data-node-id={node.id}
            transform={`translate(${pos.x} ${pos.y})`}
            className="cursor-pointer"
            onClick={() => onSelect(node.id)}
          >
            <rect
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
              rx="6"
              fill={selected === node.id ? "#0c4a6e" : "#1e293b"}
              stroke={selected === node.id ? "#38bdf8" : "#475569"}
              strokeWidth={selected === node.id ? 2 : 1}
            />
            <rect
              width="4"
              height={NODE_HEIGHT - 16}
              x="0"
              y="8"
              rx="2"
              fill={
                node.opType === "Conv"
                  ? "#38bdf8"
                  : node.opType === "Constant"
                    ? "#64748b"
                    : "#34d399"
              }
            />
            <text x="13" y="24" fill="#f1f5f9" fontSize="14" fontWeight="600">
              {node.opType}
            </text>
            <text x="13" y="44" fill="#94a3b8" fontSize="10">
              {(node.name || text.unnamed(node.id)).slice(-25)}
            </text>
            <title>{node.name || text.unnamed(node.id)}</title>
          </g>
        );
      })}
    </>
  );
});

export function OnnxGraphCanvas({
  graph,
  selected,
  onSelect,
}: {
  graph: OnnxGraph;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const layout = useMemo(() => layoutOnnxGraph(graph), [graph]);
  const svg = useRef<SVGSVGElement>(null);
  const layer = useRef<SVGGElement>(null);
  const view = useRef<GraphView>({ x: 0, y: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const frame = useRef<number>();
  const [percent, setPercent] = useState(100);
  function paint(next: GraphView) {
    view.current = next;
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      layer.current?.setAttribute(
        "transform",
        `translate(${next.x} ${next.y}) scale(${next.scale})`,
      );
      setPercent(Math.round(next.scale * 100));
    });
  }
  function fit() {
    const rect = svg.current?.getBoundingClientRect();
    if (rect && rect.width > 0 && rect.height > 0)
      paint(fitGraph(layout.width, layout.height, { x: rect.width, y: rect.height }));
  }
  function zoom(factor: number) {
    const rect = svg.current?.getBoundingClientRect();
    if (rect) paint(zoomGraph(view.current, factor, { x: rect.width / 2, y: rect.height / 2 }));
  }
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const resize = new ResizeObserver(fit);
    resize.observe(element);
    fit();
    function wheel(event: WheelEvent) {
      event.preventDefault();
      const bounds = element!.getBoundingClientRect();
      paint(
        zoomGraph(view.current, event.deltaY < 0 ? 1.15 : 1 / 1.15, {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        }),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      resize.disconnect();
      element.removeEventListener("wheel", wheel);
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
    // The geometry changes only with a new graph. Gestures read live refs.
  }, [layout]);
  useEffect(() => {
    if (selected === null) return;
    const position = layout.positions.get(selected);
    const rect = svg.current?.getBoundingClientRect();
    if (position && rect) {
      const scale = Math.max(view.current.scale, 0.7);
      paint({
        x: rect.width / 2 - (position.x + NODE_WIDTH / 2) * scale,
        y: rect.height / 2 - (position.y + NODE_HEIGHT / 2) * scale,
        scale,
      });
    }
  }, [selected, layout]);
  return (
    <div className="relative min-h-72 shrink-0 flex-1 overflow-hidden bg-slate-950">
      <svg
        ref={svg}
        className="h-full min-h-72 w-full touch-none select-none"
        aria-label={text.title}
        onPointerDown={(event) => {
          if (event.button !== 0 && event.button !== 1) return;
          event.preventDefault();
          suppressClick.current = false;
          drag.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const previous = drag.current;
          if (!previous) return;
          const dx = event.clientX - previous.x,
            dy = event.clientY - previous.y;
          if (!previous.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          suppressClick.current = true;
          paint({ ...view.current, x: view.current.x + dx, y: view.current.y + dy });
          drag.current = { x: event.clientX, y: event.clientY, moved: true };
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onPointerLeave={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) drag.current = null;
        }}
        onClickCapture={(event) => {
          if (suppressClick.current) event.stopPropagation();
        }}
      >
        <defs>
          <marker
            id="onnx-arrow"
            viewBox="0 0 8 8"
            refX="8"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8" fill="#64748b" />
          </marker>
        </defs>
        <g ref={layer}>
          <Scene graph={graph} layout={layout} selected={selected} onSelect={onSelect} />
        </g>
      </svg>
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded border border-slate-700 bg-slate-900/95 p-1 text-xs text-slate-200">
        <button type="button" className="rounded px-2 py-1 hover:bg-slate-700" onClick={fit}>
          {text.fit}
        </button>
        <button
          type="button"
          aria-label={text.zoomOut}
          className="px-2 py-1"
          onClick={() => zoom(1 / 1.25)}
        >
          −
        </button>
        <span className="w-10 text-center tabular-nums">{percent}%</span>
        <button
          type="button"
          aria-label={text.zoomIn}
          className="px-2 py-1"
          onClick={() => zoom(1.25)}
        >
          +
        </button>
      </div>
    </div>
  );
}
