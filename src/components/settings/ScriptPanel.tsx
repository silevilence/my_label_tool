import { useRef, useState } from "react";
import type { LabelConfig } from "../../types/annotation";
import { useScriptRun } from "../../hooks/useScriptRun";
import { useScriptLibrary } from "../../hooks/useScriptLibrary";
import { useScriptLimits } from "../../hooks/useScriptLimits";
import { ScriptResourceLimits } from "./ScriptResourceLimits";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";
import { Overlay } from "../overlay/Overlay";
import { ScriptDiffPreview } from "./ScriptDiffPreview";
import { scopePaths, useAnnotationStore } from "../../store/useAnnotationStore";
import { BUILTIN_SCRIPTS } from "../../lib/defaults/scripts";
import { LuaEditor, closeFocusedLuaCompletion, type LuaEditorHandle } from "./LuaEditor";
import { SCRIPT_COMMAND_DOCUMENTATION } from "../../lib/script-commands";
import { ScriptAssistant } from "./ScriptAssistant";
import { useScriptAssistant } from "../../hooks/useScriptAssistant";

export function ScriptPanel({
  open = true,
  labels,
  onClose,
}: {
  open?: boolean;
  labels: LabelConfig[];
  onClose: () => void;
}) {
  const library = useScriptLibrary();
  const editor = useRef<LuaEditorHandle>(null);
  const limits = useScriptLimits();
  const { source, setSource, includeDimensions, setIncludeDimensions } = library;
  const [previewFirst, setPreviewFirst] = useState(false);
  const run = useScriptRun(labels);
  const count = useAnnotationStore((state) => scopePaths(state).length);
  // Hiding retains the editor and active run; switching scripts still confirms discard.
  const disabled = run.busy || library.pending;
  // Keep assistant drafts and its session alive when the panel is hidden.
  const assistant = useScriptAssistant({
    source,
    documentId: String(library.documentVersion),
    includeDimensions,
    disabled: disabled || !library.library,
    onSave: library.saveGenerated,
  });
  return (
    <Overlay
      open={open}
      onClose={onClose}
      canDismiss={() =>
        !closeFocusedLuaCompletion() && !editor.current?.closeCompletion() && !library.pending
      }
      label={text.title}
      size="wide"
      operationFeedback
    >
      <section className="flex flex-col gap-4 rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100">
        <header className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{text.title}</h2>
            <p className="mt-1 text-xs text-slate-400">{text.scope(count)}</p>
          </div>
          <button
            disabled={library.pending}
            onClick={onClose}
            className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40"
          >
            {run.busy ? text.hideRun : text.close}
          </button>
        </header>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label={text.library}
            disabled={disabled}
            value={library.selectedId}
            onChange={(event) => void library.select(event.target.value)}
            className="min-w-40 flex-1 rounded border border-slate-600 bg-slate-950 p-2"
          >
            <option value="" disabled>
              {text.unsavedScript}
            </option>
            <optgroup label={text.builtinScripts}>
              {BUILTIN_SCRIPTS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
            <optgroup label={text.userScripts}>
              {library.library?.scripts.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </optgroup>
          </select>
          <button
            disabled={disabled || !library.library}
            onClick={() => void library.create()}
            className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40"
          >
            {text.newScript}
          </button>
          <button
            disabled={disabled || !library.library || !!library.example}
            onClick={() => void library.save()}
            className="rounded border border-sky-600 px-3 py-2 text-sky-300 disabled:opacity-40"
          >
            {text.saveScript}
            {library.dirty ? text.dirtyMark : ""}
          </button>
          <button
            disabled={disabled || !library.selected}
            onClick={() => void library.rename()}
            className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40"
          >
            {text.rename}
          </button>
          <button
            disabled={disabled || !library.selected}
            onClick={() => void library.remove()}
            className="ml-2 rounded border border-rose-700 px-3 py-2 text-rose-300 disabled:opacity-40"
          >
            {text.deleteScript}
          </button>
          <button
            disabled={disabled}
            onClick={() => void library.open()}
            className="rounded px-2 py-2 text-slate-300 disabled:opacity-40"
          >
            {text.openFile}
          </button>
          <button
            disabled={disabled}
            onClick={() => void library.export()}
            className="rounded px-2 py-2 text-slate-300 disabled:opacity-40"
          >
            {text.exportFile}
          </button>
        </div>
        {library.example && (
          <aside className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-sm">
            <div>
              <p className="font-medium text-amber-200">{library.example.name}</p>
              <p className="mt-1 text-slate-300">{library.example.description}</p>
              <p className="mt-1 text-xs text-amber-200/70">{text.builtinHint}</p>
            </div>
            <button
              disabled={disabled || !library.library}
              onClick={() => void library.create(true)}
              className="rounded border border-amber-700 px-3 py-2 text-amber-200 disabled:opacity-40"
            >
              {text.copyExample}
            </button>
          </aside>
        )}
        <p className="text-xs text-slate-400">{text.memoryOnly}</p>
        <LuaEditor
          ref={editor}
          key={library.documentVersion}
          disabled={disabled}
          readOnly={!!library.example}
          value={source}
          onChange={setSource}
        />
        <details className="text-xs text-slate-300">
          <summary>{text.commandReference}</summary>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap">
            {SCRIPT_COMMAND_DOCUMENTATION}
          </pre>
        </details>
        <ScriptAssistant assistant={assistant} />
        <div className="flex flex-wrap gap-5 text-sm">
          <label>
            <input
              type="checkbox"
              disabled={disabled || !!library.example}
              checked={includeDimensions}
              onChange={(event) => setIncludeDimensions(event.target.checked)}
            />{" "}
            {text.includeDimensions}
          </label>
          <label>
            <input
              type="checkbox"
              disabled={disabled}
              checked={previewFirst}
              onChange={(event) => setPreviewFirst(event.target.checked)}
            />{" "}
            {text.previewFirst}
          </label>
        </div>
        {run.available === false && (
          <p role="alert" className="text-amber-300">
            {text.unavailable}
          </p>
        )}
        <ScriptResourceLimits model={limits} disabled={run.busy} />
        {run.preview && <ScriptDiffPreview preview={run.preview} apply={run.apply} />}
        {run.report && (
          <p role="status" className="rounded bg-emerald-950/40 p-3 text-sm text-emerald-200">
            {run.report}
          </p>
        )}
        {run.logs.length > 0 && (
          <pre
            aria-label={text.logs}
            className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-400"
          >
            {run.logs.join("\n")}
          </pre>
        )}
        <footer className="sticky bottom-0 flex items-center gap-3 border-t border-slate-800 bg-slate-900 py-3">
          <button
            disabled={
              disabled ||
              limits.loading ||
              !limits.saved ||
              !source.trim() ||
              !count ||
              !run.available
            }
            onClick={() => void run.run(source, includeDimensions, previewFirst)}
            className="rounded bg-sky-500 px-5 py-2 font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-40"
          >
            {text.run}
          </button>
          {run.busy && (
            <button
              onClick={() => void run.cancel()}
              className="rounded border border-rose-500 px-4 py-2 text-rose-300"
            >
              {text.cancel}
            </button>
          )}
          <button
            disabled={!run.canUndo || run.busy}
            onClick={run.undo}
            className="ml-auto rounded border border-slate-600 px-3 py-2 disabled:opacity-40"
          >
            {text.undo}
          </button>
        </footer>
      </section>
    </Overlay>
  );
}
