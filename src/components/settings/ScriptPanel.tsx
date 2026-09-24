import { useState } from "react";
import type { LabelConfig } from "../../types/annotation";
import { useScriptRun } from "../../hooks/useScriptRun";
import { useScriptLibrary } from "../../hooks/useScriptLibrary";
import { useScriptLimits } from "../../hooks/useScriptLimits";
import { ScriptResourceLimits } from "./ScriptResourceLimits";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";
import { Overlay } from "../overlay/Overlay";
import { formatScriptReport } from "../../lib/script-execution";
import { scopePaths, useAnnotationStore } from "../../store/useAnnotationStore";

export function ScriptPanel({ labels, onClose }: { labels: LabelConfig[]; onClose: () => void }) {
  const library = useScriptLibrary();
  const limits = useScriptLimits();
  const { source, setSource, includeDimensions, setIncludeDimensions } = library;
  const [previewFirst, setPreviewFirst] = useState(false);
  const run = useScriptRun(labels);
  const count = useAnnotationStore((state) => scopePaths(state).length);
  async function close() { if (await library.discardChanges()) onClose(); }
  const disabled = run.busy || library.pending;
  return <Overlay onClose={close} canDismiss={!disabled} label={text.title} size="wide" operationFeedback>
    <section className="flex max-h-[90vh] flex-col gap-4 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100">
      <header className="flex items-center justify-between"><div><h2 className="text-lg font-semibold">{text.title}</h2><p className="mt-1 text-xs text-slate-400">{text.scope(count)}</p></div><button disabled={disabled} onClick={() => void close()} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">{text.close}</button></header>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select aria-label={text.library} disabled={disabled} value={library.selected?.id ?? ""} onChange={(event) => void library.select(event.target.value)} className="min-w-40 flex-1 rounded border border-slate-600 bg-slate-950 p-2"><option value="" disabled>{text.unsavedScript}</option>{library.library?.scripts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
        <button disabled={disabled || !library.library} onClick={() => void library.create()} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">{text.newScript}</button>
        <button disabled={disabled || !library.library} onClick={() => void library.save()} className="rounded border border-sky-600 px-3 py-2 text-sky-300 disabled:opacity-40">{text.saveScript}{library.dirty ? text.dirtyMark : ""}</button>
        <button disabled={disabled || !library.selected} onClick={() => void library.rename()} className="rounded border border-slate-600 px-3 py-2 disabled:opacity-40">{text.rename}</button>
        <button disabled={disabled || !library.selected} onClick={() => void library.remove()} className="ml-2 rounded border border-rose-700 px-3 py-2 text-rose-300 disabled:opacity-40">{text.deleteScript}</button>
        <button disabled={disabled} onClick={() => void library.open()} className="rounded px-2 py-2 text-slate-300 disabled:opacity-40">{text.openFile}</button>
        <button disabled={disabled} onClick={() => void library.export()} className="rounded px-2 py-2 text-slate-300 disabled:opacity-40">{text.exportFile}</button>
      </div>
      <p className="text-xs text-slate-400">{text.memoryOnly}</p>
      <textarea aria-label={text.editor} spellCheck={false} disabled={run.busy} value={source} onChange={(event) => setSource(event.target.value)} className="min-h-64 w-full resize-y rounded border border-slate-700 bg-slate-950 p-4 font-mono text-sm leading-6 text-slate-200 focus:border-sky-400 focus:outline-none" />
      <div className="flex flex-wrap gap-5 text-sm"><label><input type="checkbox" disabled={run.busy} checked={includeDimensions} onChange={(event) => setIncludeDimensions(event.target.checked)} /> {text.includeDimensions}</label><label><input type="checkbox" disabled={run.busy} checked={previewFirst} onChange={(event) => setPreviewFirst(event.target.checked)} /> {text.previewFirst}</label></div>
      {run.available === false && <p role="alert" className="text-amber-300">{text.unavailable}</p>}
      <ScriptResourceLimits model={limits} disabled={run.busy} />
      {run.preview && <section className="rounded border border-amber-600/50 bg-amber-950/20 p-3"><h3 className="font-medium">{text.preview}</h3><p className="mt-2 text-sm">{formatScriptReport(run.preview.report)}</p><div className="mt-2 max-h-32 overflow-auto text-xs">{run.preview.entries.map((entry) => <p key={entry.imagePath}>{text.previewImage(entry.imagePath, entry.annotations.length)}</p>)}</div><button className="mt-3 rounded bg-amber-400 px-4 py-2 text-slate-950" onClick={run.apply}>{text.apply}</button></section>}
      {run.report && <p role="status" className="rounded bg-emerald-950/40 p-3 text-sm text-emerald-200">{run.report}</p>}
      {run.logs.length > 0 && <pre aria-label={text.logs} className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-400">{run.logs.join("\n")}</pre>}
      <footer className="flex items-center gap-3 border-t border-slate-800 pt-4"><button disabled={disabled || limits.loading || !limits.saved || !source.trim() || !count || !run.available} onClick={() => void run.run(source, includeDimensions, previewFirst)} className="rounded bg-sky-500 px-5 py-2 font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-40">{text.run}</button>{run.busy && <button onClick={() => void run.cancel()} className="rounded border border-rose-500 px-4 py-2 text-rose-300">{text.cancel}</button>}<button disabled={!run.canUndo || run.busy} onClick={run.undo} className="ml-auto rounded border border-slate-600 px-3 py-2 disabled:opacity-40">{text.undo}</button></footer>
    </section>
  </Overlay>;
}
