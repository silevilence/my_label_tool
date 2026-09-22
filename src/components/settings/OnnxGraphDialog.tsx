import { useEffect, useMemo, useState } from "react";
import { inspectOnnxGraph } from "../../lib/tauri-api";
import type { OnnxGraph, OnnxTensor } from "../../types/onnx-graph";
import { ONNX_GRAPH_ZH_CN as text } from "../../i18n/onnx-graph.zh-CN";
import { Overlay } from "../overlay/Overlay";
import { OnnxGraphCanvas } from "./OnnxGraphCanvas";
import { tryBeginOperation, useOperations } from "../../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../../i18n/operations.zh-CN";

function TensorInfo({ tensor, name }: { tensor?: OnnxTensor; name: string }) {
  const origin = tensor?.origin ?? "unknown";
  return (
    <li className="space-y-1 border-b border-slate-800 py-2 last:border-0">
      <p className="break-all font-mono text-xs text-slate-300">{name}</p>
      <p
        className={
          origin === "inferred"
            ? "text-amber-300"
            : origin === "disk"
              ? "text-sky-300"
              : "text-slate-500"
        }
      >
        {tensor?.shape ? `[${tensor.shape.map((dim) => dim ?? "?").join(" × ")}]` : text.unknown}
        <span className="ml-2 text-[10px]">{text[origin]}</span>
      </p>
    </li>
  );
}

export function OnnxGraphDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [graph, setGraph] = useState<OnnxGraph | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    let active = true;
    setGraph(null);
    setError("");
    setSelected(null);
    void (async () => {
      // Let StrictMode's setup/cleanup probe finish before acquiring a real host resource.
      await Promise.resolve();
      if (!active) return;
      const operation = tryBeginOperation({ label: text.title, resource: "model-download" });
      if (!operation) {
        setError(operationText.busy);
        return;
      }
      try {
        const value = await inspectOnnxGraph(path);
        if (active) setGraph(value);
      } catch (reason: unknown) {
        if (active) setError(String(reason));
      } finally {
        // Closing the view does not cancel the host read; retain its resource until it settles.
        operation.complete();
        useOperations.getState().dismiss(operation.id);
      }
    })();
    return () => {
      active = false;
    };
  }, [path, attempt]);
  return (
    <Overlay onClose={onClose} label={text.title} size="wide">
      <section className="flex h-[85vh] max-h-full w-full flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-700 px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-semibold">{text.title}</h2>
            <p className="truncate text-xs text-slate-400" title={path}>
              {path}
            </p>
          </div>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1 text-sm"
            onClick={onClose}
          >
            {text.close}
          </button>
        </header>
        {!graph && !error && (
          <p role="status" className="m-auto animate-pulse text-sm text-slate-400">
            {text.loading}
          </p>
        )}
        {error && (
          <div className="m-5 rounded border border-red-500/40 p-4">
            <p role="alert" className="break-all text-sm text-red-300">
              {error}
            </p>
            <button
              type="button"
              className="mt-3 rounded bg-slate-700 px-3 py-2 text-sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              {text.retry}
            </button>
          </div>
        )}
        {graph && <GraphContent graph={graph} selected={selected} onSelect={setSelected} />}
        <footer className="flex shrink-0 flex-wrap justify-between gap-1 border-t border-slate-800 px-4 py-2 text-[11px] text-slate-400">
          <span>{text.help}</span>
          <span>{text.offline}</span>
        </footer>
      </section>
    </Overlay>
  );
}

function GraphContent({
  graph,
  selected,
  onSelect,
}: {
  graph: OnnxGraph;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const tensors = useMemo(
    () => new Map(graph.tensors.map((tensor) => [tensor.name, tensor])),
    [graph],
  );
  const operators = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of graph.nodes) counts.set(node.opType, (counts.get(node.opType) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [graph]);
  const node = graph.nodes.find((value) => value.id === selected);
  const weights = node
    ? graph.initializers.filter((weight) => node.inputs.includes(weight.name))
    : [];
  const total = graph.initializers.every((w) => w.byteSize !== null)
    ? graph.initializers.reduce((sum, w) => sum + w.byteSize!, 0)
    : null;
  return (
    <>
      <div className="max-h-[30vh] shrink-0 overflow-y-auto border-b border-slate-800 px-4 py-3 text-xs">
        <p className="font-mono text-sky-200">
          {text.summary(graph.nodes.length, graph.edges.length, text.bytes(total))}
        </p>
        {!graph.shapeInference.supported && (
          <p role="status" className="mt-2 text-amber-300">
            {text.inferenceUnavailable(graph.shapeInference)}
          </p>
        )}
        <div className="mt-2 grid max-h-28 grid-cols-2 gap-5 overflow-y-auto">
          <div>
            <h3 className="text-slate-500">{text.inputs}</h3>
            <ul>
              {graph.inputs.map((name) => (
                <TensorInfo key={name} name={name} tensor={tensors.get(name)} />
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-slate-500">{text.outputs}</h3>
            <ul>
              {graph.outputs.map((name) => (
                <TensorInfo key={name} name={name} tensor={tensors.get(name)} />
              ))}
            </ul>
          </div>
        </div>
        <details open className="mt-2 text-slate-400">
          <summary className="cursor-pointer">{text.operators}</summary>
          <p className="mt-2 leading-5">
            {operators.map(([op, count]) => `${op} ${count}`).join(" · ")}
          </p>
        </details>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto sm:flex-row sm:overflow-hidden">
        <OnnxGraphCanvas graph={graph} selected={selected} onSelect={onSelect} />
        <aside className="max-h-64 w-full shrink-0 overflow-y-auto border-l border-slate-800 p-4 text-xs sm:max-h-none sm:w-64">
          <label className="block text-slate-400">
            {text.nodePicker}
            <select
              aria-label={text.nodePicker}
              className="mt-2 w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-200"
              value={selected ?? ""}
              onChange={(event) => {
                if (event.target.value !== "") onSelect(Number(event.target.value));
              }}
            >
              <option value="" disabled>
                {text.selectNode}
              </option>
              {graph.nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id + 1} · {n.opType} · {n.name || text.unnamed(n.id)}
                </option>
              ))}
            </select>
          </label>
          <p className="my-3 leading-5 text-slate-500">{text.shapeNotice}</p>
          {node && (
            <>
              <h3 className="break-all text-sm font-semibold">
                {node.opType} · {node.name || text.unnamed(node.id)}
              </h3>
              <p className="my-2 break-all text-slate-400">
                {text.domain}: {node.domain || "ai.onnx"}
              </p>
              <h4 className="mt-4 text-slate-400">{text.nodeInputs}</h4>
              <ul>
                {node.inputs.filter(Boolean).map((name, i) => (
                  <TensorInfo key={i} name={name} tensor={tensors.get(name)} />
                ))}
              </ul>
              <h4 className="mt-4 text-slate-400">{text.nodeOutputs}</h4>
              <ul>
                {node.outputs.filter(Boolean).map((name, i) => (
                  <TensorInfo key={i} name={name} tensor={tensors.get(name)} />
                ))}
              </ul>
              <h4 className="mt-4 text-slate-400">{text.weights}</h4>
              {weights.length === 0 && <p className="mt-2 text-slate-500">{text.none}</p>}
              {weights.map((w) => (
                <div
                  key={w.name}
                  className="my-2 break-all rounded border border-slate-700 p-2 font-mono"
                >
                  <p>{w.name}</p>
                  <p className="mt-1 text-sky-300">[{w.shape.join(" × ")}]</p>
                  <p className="mt-1 text-slate-400">
                    {text.type(w.dataType)} · {text.bytes(w.byteSize)} {w.external && text.external}
                  </p>
                </div>
              ))}
              <h4 className="mt-4 text-slate-400">{text.attributes}</h4>
              <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-[11px] text-slate-300">
                {JSON.stringify(node.attributes, null, 2)}
              </pre>
            </>
          )}
          <details className="mt-5 text-slate-400">
            <summary className="cursor-pointer">{text.metadata}</summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-[11px]">
              {JSON.stringify(
                {
                  irVersion: graph.irVersion,
                  producer: graph.producer,
                  opsets: graph.opsets,
                  ...graph.metadata,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </aside>
      </div>
    </>
  );
}
