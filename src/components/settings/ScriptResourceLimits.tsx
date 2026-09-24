import type { useScriptLimits } from "../../hooks/useScriptLimits";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";
import { SCRIPT_LIMIT_RANGES } from "../../lib/script-limits";
export function ScriptResourceLimits({
  model,
  disabled,
}: {
  model: ReturnType<typeof useScriptLimits>;
  disabled: boolean;
}) {
  return (
    <details className="rounded border border-slate-700 px-3 py-2 text-sm">
      <summary className="cursor-pointer text-slate-300">
        {text.limitsTitle}
        {model.saved
          ? text.limitsSummary(model.saved.maxMemoryMiB, model.saved.timeoutSeconds)
          : ""}
      </summary>
      <fieldset
        disabled={disabled || model.loading}
        className="mt-3 flex flex-wrap items-end gap-3"
      >
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          {text.memoryLimit}
          <input
            aria-label={text.memoryLimit}
            aria-invalid={!!model.error}
            aria-describedby={model.error ? "script-limits-error" : undefined}
            type="number"
            min={SCRIPT_LIMIT_RANGES.memory.min}
            max={SCRIPT_LIMIT_RANGES.memory.max}
            step={1}
            value={model.value.maxMemoryMiB}
            onChange={(e) =>
              model.setValue({ ...model.value, maxMemoryMiB: Number(e.target.value) })
            }
            className="w-32 rounded border border-slate-600 bg-slate-950 p-2 text-slate-100"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          {text.timeLimit}
          <input
            aria-label={text.timeLimit}
            aria-invalid={!!model.error}
            aria-describedby={model.error ? "script-limits-error" : undefined}
            type="number"
            min={SCRIPT_LIMIT_RANGES.timeout.min}
            max={SCRIPT_LIMIT_RANGES.timeout.max}
            step={1}
            value={model.value.timeoutSeconds}
            onChange={(e) =>
              model.setValue({ ...model.value, timeoutSeconds: Number(e.target.value) })
            }
            className="w-32 rounded border border-slate-600 bg-slate-950 p-2 text-slate-100"
          />
        </label>
        <button
          onClick={() => void model.save()}
          className="rounded border border-sky-700 px-3 py-2 text-sky-300"
        >
          {text.saveLimits}
        </button>
        <button
          onClick={() => void model.restore()}
          className="rounded border border-slate-600 px-3 py-2"
        >
          {text.restoreLimits}
        </button>
      </fieldset>
      <p className="mt-2 text-xs text-slate-500">{text.limitsHint}</p>
      {model.error && (
        <p id="script-limits-error" role="alert" className="mt-2 text-rose-300">
          {model.error}
        </p>
      )}
    </details>
  );
}
