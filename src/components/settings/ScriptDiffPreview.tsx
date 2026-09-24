import { useState } from "react";
import { formatScriptReport, type ScriptPreview } from "../../lib/script-execution";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";

export function ScriptDiffPreview({
  preview,
  apply,
}: {
  preview: ScriptPreview;
  apply: () => void;
}) {
  const [selection, setSelection] = useState(0);
  const entry = preview.entries[selection];
  const before =
    preview.snapshot.images.find((image) => image.path === entry?.imagePath)?.annotations ?? [];
  return (
    <section className="rounded border border-amber-600/50 bg-amber-950/20 p-3">
      <h3 className="font-medium text-amber-200">{text.preview}</h3>
      <p className="mt-2 text-sm">{formatScriptReport(preview.report)}</p>
      {entry && (
        <>
          <label className="mt-3 block text-xs text-slate-400">
            {text.diffImage}
            <select
              className="mt-1 block w-full rounded border border-slate-600 bg-slate-950 p-2 text-slate-200"
              value={selection}
              onChange={(event) => setSelection(Number(event.target.value))}
            >
              {preview.entries.map((item, index) => (
                <option key={item.imagePath} value={index}>
                  {text.previewImage(item.imagePath, item.annotations.length)}
                </option>
              ))}
            </select>
          </label>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              { title: text.before, data: before },
              { title: text.after, data: entry.annotations },
            ].map(({ title, data }) => (
              <div key={title}>
                <h4 className="mb-1 text-xs font-semibold text-slate-400">{title}</h4>
                <pre
                  aria-label={title}
                  className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs leading-5 text-slate-300"
                >
                  {JSON.stringify(data, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </>
      )}
      <button
        className="mt-3 rounded bg-amber-400 px-4 py-2 font-medium text-slate-950 hover:bg-amber-300"
        onClick={apply}
      >
        {text.apply}
      </button>
    </section>
  );
}
