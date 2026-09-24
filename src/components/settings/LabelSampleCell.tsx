import { useState } from "react";
import type { LabelConfig } from "../../types/annotation";
import type { LabelSamples } from "../../hooks/useLabelSamples";
import { LABEL_SAMPLE_ZH_CN as text } from "../../i18n/label-sample.zh-CN";
import { Overlay } from "../overlay/Overlay";
import { LabelSamplePicker } from "./LabelSamplePicker";

export function LabelSampleCell({
  label,
  samples,
  conflict,
}: {
  label: LabelConfig;
  samples?: LabelSamples;
  conflict: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [picking, setPicking] = useState(false);
  const preview = conflict ? undefined : samples?.preview(label);
  const disabled = !samples?.enabled || samples.busy || samples.loading || conflict;
  return (
    <div className={`flex items-center gap-2 ${!samples?.enabled ? "opacity-40" : ""}`}>
      <button
        type="button"
        disabled={!preview}
        aria-label={text.preview(label.name)}
        className="flex h-14 w-16 shrink-0 items-center justify-center overflow-hidden rounded border border-slate-700 bg-slate-950 text-[10px] text-slate-500 enabled:hover:border-sky-400"
        onClick={() => setExpanded(true)}
      >
        {preview ? (
          <img
            src={preview}
            alt={text.preview(label.name)}
            className="h-full w-full object-contain"
          />
        ) : (
          text.empty
        )}
      </button>
      <div className="flex flex-col gap-1 text-[11px]">
        <button
          type="button"
          disabled={disabled}
          aria-label={text.chooseFor(label.name)}
          className="text-sky-300 hover:text-sky-200 disabled:cursor-not-allowed disabled:text-slate-600"
          onClick={() => setPicking(true)}
        >
          {preview ? text.replace : text.choose}
        </button>
        <button
          type="button"
          disabled={disabled || !preview}
          aria-label={text.clearFor(label.name)}
          className="text-slate-400 hover:text-red-300 disabled:cursor-not-allowed disabled:text-slate-600"
          onClick={() => samples?.clear(label.id)}
        >
          {text.clear}
        </button>
      </div>
      {picking && samples && (
        <LabelSamplePicker label={label} samples={samples} onClose={() => setPicking(false)} />
      )}
      {expanded && preview && (
        <Overlay label={text.preview(label.name)} onClose={() => setExpanded(false)} size="wide">
          <figure className="rounded-xl border border-slate-700 bg-slate-900 p-6">
            <button
              type="button"
              aria-label={text.close}
              onClick={() => setExpanded(false)}
              className="mb-3 ml-auto block rounded border border-slate-600 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
            >
              ×
            </button>
            <img
              src={preview}
              alt={text.preview(label.name)}
              className="mx-auto max-h-[70vh] max-w-full object-contain"
            />
            <figcaption className="mt-3 text-center text-sm text-slate-200">
              {label.name}
            </figcaption>
          </figure>
        </Overlay>
      )}
    </div>
  );
}
