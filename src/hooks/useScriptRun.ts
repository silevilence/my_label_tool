import { useEffect, useRef, useState } from "react";
import type { LabelConfig } from "../types/annotation";
import { beginScriptOperation } from "../lib/script-operation";
import {
  applyScriptPreview,
  createScriptSnapshot,
  formatScriptReport,
  prepareScriptResults,
  type ScriptPreview,
} from "../lib/script-execution";
import { cancelScript, runScript, scriptHostAvailable } from "../lib/tauri-api";
import { loadImageSize } from "../lib/app-utils";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOperations, type OperationHandle } from "../store/useOperations";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

export function useScriptRun(labels: LabelConfig[]) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ScriptPreview | null>(null);
  const [report, setReport] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [transactionId, setTransactionId] = useState("");
  const operation = useRef<OperationHandle | null>(null);
  const currentLabels = useRef(labels);
  currentLabels.current = labels;
  const historyTop = useAnnotationStore(
    (state) => state.undoStack[state.undoStack.length - 1]?.transactionId,
  );
  useEffect(() => {
    let mounted = true;
    void scriptHostAvailable()
      .then((value) => {
        if (mounted) setAvailable(value);
      })
      .catch(() => {
        if (mounted) setAvailable(false);
      });
    return () => {
      mounted = false;
      const active = operation.current;
      if (active) {
        void useOperations.getState().cancel(active.id);
        active.complete(text.cancelled, "warning");
      }
    };
  }, []);

  function finish(prepared: ScriptPreview) {
    const active = operation.current;
    if (!active || active.cancelRequested) return;
    applyScriptPreview(prepared, currentLabels.current, active.id);
    const summary = formatScriptReport(prepared.report);
    setReport(summary);
    setTransactionId(active.id);
    active.complete(summary);
    operation.current = null;
    setPreview(null);
    setBusy(false);
  }

  async function run(source: string, includeDimensions: boolean, previewFirst: boolean) {
    let active: OperationHandle;
    try {
      active = beginScriptOperation(cancelScript);
    } catch (error) {
      useOperations.getState().pushError(text.title, String(error));
      return;
    }
    operation.current = active;
    let awaitingPreview = false;
    setBusy(true);
    setReport("");
    setLogs([]);
    setPreview(null);
    setTransactionId("");
    try {
      const snapshot = createScriptSnapshot(currentLabels.current);
      if (!snapshot.images.length) throw new Error(text.noImages);
      if (includeDimensions) {
        for (const image of snapshot.images) {
          if (active.cancelRequested) break;
          image.size = await loadImageSize(image.path);
        }
      }
      if (active.cancelRequested) {
        active.complete(text.cancelled, "warning");
        return;
      }
      const results = await runScript(active.id, snapshot, source, (event) => {
        if (event.event === "progress")
          active.progress(
            (event.completed / event.total) * 100,
            text.progress(event.completed, event.total),
          );
        else setLogs((previous) => [...previous.slice(-199), event.message]);
      });
      if (active.cancelRequested) {
        active.complete(text.cancelled, "warning");
        return;
      }
      const prepared = prepareScriptResults(snapshot, results);
      if (previewFirst) {
        awaitingPreview = true;
        setPreview(prepared);
        active.progress(100, text.awaitingApply);
        active.setCancel(() => {
          setPreview(null);
          setBusy(false);
          operation.current = null;
          active.complete(text.cancelled, "warning");
        });
      } else finish(prepared);
    } catch (error) {
      if (active.cancelRequested) active.complete(text.cancelled, "warning");
      else active.fail(formatScriptError(error));
    } finally {
      if (!awaitingPreview) {
        operation.current = null;
        setBusy(false);
      }
    }
  }
  function apply() {
    if (!preview) return;
    try {
      finish(preview);
    } catch (error) {
      operation.current?.fail(error);
      operation.current = null;
      setBusy(false);
      setPreview(null);
    }
  }
  async function cancel() {
    if (operation.current) await useOperations.getState().cancel(operation.current.id);
  }
  return {
    available,
    busy,
    preview,
    report,
    logs,
    run,
    apply,
    cancel,
    canUndo: !!transactionId && historyTop === transactionId,
    undo: () => {
      if (historyTop === transactionId) useAnnotationStore.getState().undo();
    },
  };
}

export function formatScriptError(error: unknown): string {
  if (!Array.isArray(error)) return error instanceof Error ? error.message : String(error);
  return error
    .map(
      (entry: { code?: string; message?: string; imagePath?: string }) =>
        `${entry.imagePath ? `${entry.imagePath}: ` : ""}${text.errors[entry.code as keyof typeof text.errors] ?? entry.code}: ${entry.message ?? ""}`,
    )
    .join("\n");
}
