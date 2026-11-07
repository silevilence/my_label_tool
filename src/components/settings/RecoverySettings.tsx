import { useState } from "react";
import { useRecoveryStore } from "../../store/useRecoveryStore";
import { validAutosaveSettings } from "../../lib/recovery";
import { AUTOSAVE_MIN_SECONDS, AUTOSAVE_MAX_SECONDS } from "../../lib/defaults/autosave";
import { RECOVERY_TEXT as text } from "../../i18n/recovery.zh-CN";
import { Overlay } from "../overlay/Overlay";
import type { AutosaveMode } from "../../types/recovery";

export function RecoverySettings() {
  const { settings, status, setSettings, retry, resolveConflict, openArchives, manualPending } =
    useRecoveryStore();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(settings.mode);
  const [seconds, setSeconds] = useState(String(settings.intervalSeconds));
  const [error, setError] = useState("");
  const modeLabel =
    settings.mode === "off"
      ? text.modeOff
      : settings.mode === "switch"
        ? text.modeSwitch
        : text.modeInterval(settings.intervalSeconds);
  const conflict = status.error.includes("[RECOVERY_CONFLICT]");
  const action = conflict ? resolveConflict : retry;
  return (
    <section
      className="shrink-0 border-t border-slate-800 px-4 py-2 text-sm"
      aria-label={text.title}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-200">{modeLabel}</span>
        <button
          type="button"
          aria-label={text.title}
          onClick={() => {
            setMode(settings.mode);
            setSeconds(String(settings.intervalSeconds));
            setError("");
            setOpen(true);
          }}
          className="shrink-0 rounded border border-slate-600 px-2 py-1 text-xs text-slate-100 hover:bg-slate-800"
        >
          {text.settings}
        </button>
      </div>
      <p role="status" className="mt-1 text-xs text-slate-300">
        {manualPending
          ? text.queued
          : status.saving
            ? text.saving
            : status.dirty
              ? settings.mode === "off"
                ? text.manualRequired
                : text.pending
              : status.savedAt
                ? `${text.saved} · ${new Date(status.savedAt).toLocaleTimeString()}`
                : text.idle}
      </p>
      {status.error && (
        <div role="alert" className="mt-2 text-xs text-red-300">
          <p>{text.saveFailed}</p>
          <p className="mt-1 break-words">{status.error}</p>
          <button
            type="button"
            disabled={!action || status.saving || !!manualPending}
            onClick={() => action?.()}
            className="mt-2 rounded border border-red-400/50 px-3 py-2 disabled:opacity-50"
          >
            {conflict ? text.keepBoth : text.retry}
          </button>
        </div>
      )}
      <Overlay open={open} label={text.title} onClose={() => setOpen(false)} size="md">
        <form
          className="rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100"
          onSubmit={(event) => {
            event.preventDefault();
            const next = {
              mode,
              intervalSeconds: mode === "interval" ? Number(seconds) : settings.intervalSeconds,
            };
            if (!validAutosaveSettings(next)) {
              setError(text.invalidInterval);
              return;
            }
            setSettings(next);
            setOpen(false);
          }}
        >
          <h2 className="text-base font-semibold">{text.title}</h2>
          <label className="mt-4 block text-sm">
            {text.mode}
            <select
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as AutosaveMode);
                setError("");
              }}
              className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="off">{text.off}</option>
              <option value="interval">{text.interval}</option>
              <option value="switch">{text.switch}</option>
            </select>
          </label>
          {mode === "interval" && (
            <label className="mt-4 block text-sm">
              {text.seconds}
              <input
                type="number"
                min={AUTOSAVE_MIN_SECONDS}
                max={AUTOSAVE_MAX_SECONDS}
                step={1}
                value={seconds}
                aria-invalid={!!error}
                aria-describedby={error ? "recovery-interval-error" : undefined}
                onChange={(event) => setSeconds(event.target.value)}
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"
              />
            </label>
          )}
          {error && (
            <p id="recovery-interval-error" role="alert" className="mt-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            {mode === "off" ? text.offHint : text.description}
          </p>
          {mode === "switch" && <p className="mt-2 text-sm text-slate-300">{text.switchHint}</p>}
          <button
            type="button"
            disabled={!openArchives}
            onClick={() => openArchives?.()}
            className="mt-4 rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-50"
          >
            {text.archives}
          </button>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded border border-slate-600 px-3 py-2"
            >
              {text.cancel}
            </button>
            <button type="submit" className="rounded bg-sky-700 px-3 py-2 hover:bg-sky-600">
              {text.saveSettings}
            </button>
          </div>
        </form>
      </Overlay>
    </section>
  );
}
