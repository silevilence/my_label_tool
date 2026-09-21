import { confirmAction } from "../../lib/prompts";
import { useEffect, useState } from "react";
import { usePrelabelResourceStore } from "../../store/usePrelabelResourceStore";
import {
  DEFAULT_PRELABEL_RESOURCE_LIMITS,
  MAX_PRELABEL_CANDIDATES,
  MAX_PRELABEL_MEMORY_MIB,
} from "../../lib/defaults/prelabel";
import {
  maxPrelabelOutputElements,
  validatePrelabelResourceLimits,
} from "../../lib/prelabel-resource-limits";
import { PRELABEL_RESOURCE_ZH_CN as text } from "../../i18n/prelabel-resource.zh-CN";

export function PrelabelResourceSettings({
  onDirtyChange,
  onSavingChange,
}: {
  onDirtyChange: (dirty: boolean) => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const { limits, loading, saving, error, load, save } = usePrelabelResourceStore();
  const [memory, setMemory] = useState("");
  const [candidates, setCandidates] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (limits) {
      setMemory(String(limits.maxMemoryMiB));
      setCandidates(String(limits.maxCandidates));
    }
  }, [limits]);
  const draft = { maxMemoryMiB: Number(memory), maxCandidates: Number(candidates) };
  const invalid = validatePrelabelResourceLimits(draft);
  const dirty = limits
    ? memory !== String(limits.maxMemoryMiB) || candidates !== String(limits.maxCandidates)
    : memory !== "" || candidates !== "";
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  useEffect(() => onSavingChange(saving), [saving, onSavingChange]);

  async function submit() {
    if (invalid) return;
    setSaved(false);
    try {
      await save(draft);
      setSaved(true);
    } catch {
      /* Store exposes the persistence error. */
    }
  }

  return (
    <section className="mt-4 rounded border border-slate-800 p-3" aria-label={text.title}>
      <h3 className="text-sm font-medium text-slate-100">{text.title}</h3>
      <p className="mt-2 text-xs text-slate-400">{text.scope}</p>
      {loading && (
        <p role="status" className="mt-2 text-xs text-slate-400">
          {text.loading}
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-slate-300">
          {text.memory}
          <input
            aria-label={text.memory}
            type="number"
            min={1}
            max={MAX_PRELABEL_MEMORY_MIB}
            step={1}
            disabled={loading || saving}
            value={memory}
            onChange={(event) => {
              setMemory(event.target.value);
              setSaved(false);
            }}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 disabled:opacity-50"
          />
        </label>
        <label className="text-xs text-slate-300">
          {text.candidates}
          <input
            aria-label={text.candidates}
            type="number"
            min={1}
            max={MAX_PRELABEL_CANDIDATES}
            step={1}
            disabled={loading || saving}
            value={candidates}
            onChange={(event) => {
              setCandidates(event.target.value);
              setSaved(false);
            }}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 disabled:opacity-50"
          />
        </label>
      </div>
      {!loading && invalid && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {invalid}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-300">
          {error}
        </p>
      )}
      <p className="mt-2 text-xs text-slate-400">{text.hint}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loading || saving || !!invalid || !dirty}
          onClick={() => void submit()}
          className="rounded bg-sky-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          {saving ? text.saving : text.save}
        </button>
        <button
          type="button"
          disabled={loading || saving}
          onClick={() => {
            setMemory(String(DEFAULT_PRELABEL_RESOURCE_LIMITS.maxMemoryMiB));
            setCandidates(String(DEFAULT_PRELABEL_RESOURCE_LIMITS.maxCandidates));
            setSaved(false);
          }}
          className="rounded border border-slate-700 px-3 py-1.5 text-xs text-slate-200 disabled:opacity-40"
        >
          {text.defaults}
        </button>
        {error && (
          <button
            type="button"
            disabled={loading || saving}
            onClick={async () => {
              if (dirty && !(await confirmAction(text.discardReload))) return;
              setSaved(false);
              await load();
            }}
            className="text-xs text-sky-300"
          >
            {text.retry}
          </button>
        )}
        {saved && (
          <p role="status" className="text-xs text-emerald-300">
            {text.saved}
          </p>
        )}
      </div>
    </section>
  );
}

export function PrelabelResourceSummary() {
  const { limits, loading, error, load } = usePrelabelResourceStore();
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="border-b border-slate-800 px-5 py-3 text-xs text-slate-400">
      {loading ? (
        <p>{text.loading}</p>
      ) : (
        limits && (
          <p>
            {text.conversion(
              limits.maxMemoryMiB,
              maxPrelabelOutputElements(limits),
              limits.maxCandidates,
            )}
          </p>
        )
      )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}{" "}
          <button type="button" onClick={() => void load()} className="text-sky-300">
            {text.retry}
          </button>
        </p>
      )}
      <p className="mt-1">{text.modelHint}</p>
    </div>
  );
}
