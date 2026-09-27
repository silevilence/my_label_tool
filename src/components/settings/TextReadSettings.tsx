import { useEffect, useState } from "react";
import {
  cancelTextRead,
  configureTextRead,
  getTextReadSettings,
  previewTextRead,
} from "../../lib/tauri-api";
import type {
  TextReadConfig,
  TextReadPlan,
  TextReadSettings as Settings,
} from "../../types/text-read";
import { TEXT_READ_ZH_CN as text } from "../../i18n/text-read.zh-CN";
import { tryBeginOperation } from "../../store/useOperations";
import { useTextReadStore } from "../../store/useTextReadStore";

export function TextReadSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [config, setConfig] = useState<TextReadConfig | null>(null);
  const [plan, setPlan] = useState<TextReadPlan | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getTextReadSettings()
      .then((value) => {
        if (!cancelled) {
          setSettings(value);
          setConfig(value.config);
          setMessage(value.startupError ?? "");
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMessage(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  function update(next: TextReadConfig) {
    setConfig(next);
    setPlan(null);
    setMessage("");
  }
  async function preview() {
    if (!config) return;
    setBusy(true);
    try {
      setPlan(await previewTextRead(config));
      setMessage("");
    } catch (error) {
      setPlan(null);
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function check(save: boolean) {
    if (!config || !plan) return;
    const id = crypto.randomUUID();
    const operation = tryBeginOperation({
      label: text.title,
      resource: "text-read-settings",
      cancel: async () => {
        await cancelTextRead(id);
      },
    });
    if (!operation) return;
    setRequestId(id);
    setBusy(true);
    try {
      const result = await configureTextRead(config, id, save);
      if (save) useTextReadStore.getState().changed();
      setMessage(save ? text.saved : result.message);
      setSettings(await getTextReadSettings());
      operation.complete(save ? text.saved : result.message);
    } catch (error) {
      setMessage(String(error));
      operation.fail(error);
      const latest = await getTextReadSettings().catch(() => null);
      if (latest) setSettings(latest);
    } finally {
      setBusy(false);
      setRequestId(null);
    }
  }
  const mode = settings?.modes.find((item) => item.id === config?.mode);
  return (
    <section className="space-y-3 rounded border border-slate-700 p-3" aria-label={text.title}>
      <h3 className="font-medium">{text.title}</h3>
      <p className="text-xs text-slate-400">{text.writeHint}</p>
      {config && settings ? (
        <>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-sm">
              {text.mode}
              <select
                className="ml-3 rounded bg-slate-800 p-1"
                value={config.mode}
                onChange={(event) => update({ ...config, mode: event.target.value, values: {} })}
              >
                {settings.modes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {mode?.fields.map((field) => (
              <label key={field.key} className="block text-sm">
                {field.label}
                <input
                  className="mt-1 w-full rounded border border-slate-600 bg-slate-900 p-2"
                  required={field.required}
                  value={config.values[field.key] ?? ""}
                  onChange={(event) =>
                    update({
                      ...config,
                      values: { ...config.values, [field.key]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
            <label className="block text-sm">
              {text.timeout}
              <input
                className="ml-3 rounded bg-slate-800 p-1"
                type="number"
                min={100}
                max={300000}
                value={config.timeoutMs}
                onChange={(event) => update({ ...config, timeoutMs: Number(event.target.value) })}
              />
            </label>
            <p className="text-xs text-slate-400">{text.hint}</p>
            <button
              type="button"
              onClick={() => void preview()}
              className="rounded border border-slate-600 px-3 py-1"
            >
              {text.preview}
            </button>
            {plan && (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                {plan.executable ? JSON.stringify(plan, null, 2) : text.native}
              </pre>
            )}
            <p className="text-xs">{mode?.selfCheck}</p>
            <div className="flex gap-3">
              <button
                type="button"
                disabled={!plan}
                className="rounded border px-3 py-1 disabled:opacity-40"
                onClick={() => void check(false)}
              >
                {text.check}
              </button>
              <button
                type="button"
                disabled={!plan}
                className="rounded bg-sky-600 px-3 py-1 disabled:opacity-40"
                onClick={() => void check(true)}
              >
                {text.save}
              </button>
            </div>
          </fieldset>
          {requestId && (
            <button type="button" onClick={() => void cancelTextRead(requestId)}>
              {text.cancel}
            </button>
          )}
          <p className="text-xs">
            {text.lastCheck}：
            {settings.lastCheck
              ? `${settings.modes.find((item) => item.id === settings.lastCheck?.config.mode)?.name ?? settings.lastCheck.config.mode} — ${settings.lastCheck.message}`
              : text.noCheck}
          </p>
        </>
      ) : (
        <p>{text.loading}</p>
      )}
      {message && (
        <p role="status" className="break-all text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
