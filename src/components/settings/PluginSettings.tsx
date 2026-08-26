import { useCallback, useEffect, useState } from "react";
import { PLUGIN_ZH_CN as text } from "../../i18n/plugin.zh-CN";
import {
  authorizePlugin,
  clearPluginFailures,
  confirmAction,
  installPlugin,
  getPluginRuntimeSettings,
  getPluginRuntimeLogs,
  listPlugins,
  selectPluginPackage,
  setPluginEnabled,
  setPluginSafeMode,
  uninstallPlugin,
} from "../../lib/tauri-api";
import type {
  PluginExtensionKind,
  PluginInstallPreview,
  PluginPermissionGrant,
  PluginRegistryEntry,
  PluginState,
} from "../../types/plugin";

interface PluginSettingsProps {
  onClose: () => void;
}

const STATE_LABELS: Record<PluginState, string> = {
  enabled: text.stateEnabled,
  disabled: text.stateDisabled,
  "auto-disabled": text.stateAutoDisabled,
  "pending-migration": text.statePendingMigration,
};

const STATE_STYLES: Record<PluginState, string> = {
  enabled: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  disabled: "border-slate-600 bg-slate-800 text-slate-300",
  "auto-disabled": "border-red-500/50 bg-red-500/10 text-red-200",
  "pending-migration": "border-amber-500/50 bg-amber-500/10 text-amber-200",
};

const EXTENSION_LABELS: Record<PluginExtensionKind, string> = {
  "label-preset": text.extensionLabelPreset,
  exporter: text.extensionExporter,
  prelabel: text.extensionPrelabel,
};

export function PluginSettings({ onClose }: PluginSettingsProps) {
  const [plugins, setPlugins] = useState<PluginRegistryEntry[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [isInstalling, setIsInstalling] = useState(false);
  const [preview, setPreview] = useState<PluginInstallPreview | null>(null);
  const [confirmedPermissions, setConfirmedPermissions] = useState<Set<number>>(new Set());
  const [openDiagnostics, setOpenDiagnostics] = useState<Set<string>>(new Set());
  const [safeMode, setSafeMode] = useState(false);
  const [isChangingSafeMode, setIsChangingSafeMode] = useState(false);
  const [runtimeLogs, setRuntimeLogs] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    const [snapshot, settings] = await Promise.all([listPlugins(), getPluginRuntimeSettings()]);
    setPlugins(snapshot.plugins);
    setWarning(snapshot.warning);
    setSafeMode(settings.safeMode);
  }, []);

  useEffect(() => {
    void refresh()
      .catch((reason: unknown) => setError(formatError(reason)))
      .finally(() => setIsLoading(false));
  }, [refresh]);

  async function beginInstall() {
    setError(null);
    const path = await selectPluginPackage();
    if (!path) return;
    setIsInstalling(true);
    try {
      const nextPreview = await installPlugin(path);
      setPreview(nextPreview);
      setConfirmedPermissions(new Set());
    } catch (reason) {
      setError(formatError(reason));
      setPreview(null);
      setConfirmedPermissions(new Set());
    } finally {
      setIsInstalling(false);
    }
  }

  async function cancelInstall() {
    if (!preview) return;
    setIsInstalling(true);
    setError(null);
    try {
      await authorizePlugin(preview.installToken, null);
      setPreview(null);
      setConfirmedPermissions(new Set());
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setIsInstalling(false);
    }
  }

  async function approveInstall() {
    if (!preview || confirmedPermissions.size !== preview.permissions.length) return;
    setIsInstalling(true);
    setError(null);
    try {
      await authorizePlugin(preview.installToken, preview.permissions);
      setPreview(null);
      setConfirmedPermissions(new Set());
      await refresh();
    } catch (reason) {
      setError(formatError(reason));
      setPreview(null);
      setConfirmedPermissions(new Set());
    } finally {
      setIsInstalling(false);
    }
  }

  async function togglePlugin(plugin: PluginRegistryEntry) {
    await runPluginOperation(plugin.id, async () => {
      await setPluginEnabled(plugin.id, plugin.state !== "enabled");
    });
  }

  async function removePlugin(plugin: PluginRegistryEntry) {
    if (!(await confirmAction(text.uninstallConfirm(plugin.name)))) return;
    await runPluginOperation(plugin.id, async () => {
      await uninstallPlugin(plugin.id);
    });
  }

  async function resetFailures(plugin: PluginRegistryEntry) {
    await runPluginOperation(plugin.id, async () => {
      await clearPluginFailures(plugin.id);
    });
  }

  async function runPluginOperation(pluginId: string, operation: () => Promise<void>) {
    setBusyPluginId(pluginId);
    setError(null);
    try {
      await operation();
      await refresh();
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setBusyPluginId(null);
    }
  }

  async function toggleDiagnostic(pluginId: string) {
    const opening = !openDiagnostics.has(pluginId);
    setOpenDiagnostics((current) => {
      const next = new Set(current);
      if (next.has(pluginId)) next.delete(pluginId);
      else next.add(pluginId);
      return next;
    });
    if (opening) {
      try {
        const lines = await getPluginRuntimeLogs(pluginId);
        setRuntimeLogs((current) => ({ ...current, [pluginId]: lines }));
      } catch (reason) {
        setError(formatError(reason));
      }
    }
  }

  async function toggleSafeMode() {
    setIsChangingSafeMode(true);
    setError(null);
    try {
      const settings = await setPluginSafeMode(!safeMode);
      setSafeMode(settings.safeMode);
    } catch (reason) {
      setError(formatError(reason));
    } finally {
      setIsChangingSafeMode(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <section
        aria-label={text.settingsTitle}
        className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-700 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{text.settingsTitle}</h2>
            <p className="mt-1 text-xs text-slate-400">{text.permissionDescription}</p>
          </div>
          <button
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            disabled={preview !== null || isInstalling}
            type="button"
            onClick={onClose}
          >
            {text.close}
          </button>
        </header>

        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            {warning && <p className="text-sm text-amber-300">{warning || text.registryWarning}</p>}
            {error && <p className="break-words text-sm text-red-300">{text.operationFailed(error)}</p>}
          </div>
          <label className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">
            <input
              checked={safeMode}
              disabled={isChangingSafeMode || isInstalling || busyPluginId !== null}
              type="checkbox"
              onChange={() => void toggleSafeMode()}
            />
            <span>{text.safeMode}</span>
          </label>
          <button
            className="shrink-0 rounded bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
            disabled={isInstalling || busyPluginId !== null || isChangingSafeMode}
            type="button"
            onClick={() => void beginInstall()}
          >
            {isInstalling ? text.installing : text.install}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-5">
          {isLoading ? (
            <p className="text-sm text-slate-400">{text.loading}</p>
          ) : plugins.length === 0 ? (
            <p className="rounded border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
              {text.empty}
            </p>
          ) : (
            plugins.map((plugin) => {
              const isBusy = busyPluginId === plugin.id;
              const diagnosticOpen = openDiagnostics.has(plugin.id);
              const runtimeBlockedBySafeMode = safeMode && plugin.extensionKind !== "label-preset";
              const canToggle =
                !runtimeBlockedBySafeMode &&
                plugin.state !== "auto-disabled" &&
                plugin.state !== "pending-migration";
              return (
                <article className="rounded-lg border border-slate-700 bg-slate-950/60 p-4" key={plugin.id}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-medium text-slate-100">{plugin.name}</h3>
                        <span className={`rounded border px-2 py-0.5 text-xs ${STATE_STYLES[plugin.state]}`}>
                          {STATE_LABELS[plugin.state]}
                        </span>
                      </div>
                      <p className="mt-1 break-all text-xs text-slate-400">
                        {plugin.id} · v{plugin.version} · {EXTENSION_LABELS[plugin.extensionKind]}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{text.installedAt(plugin.installedAt)}</p>
                      {safeMode && plugin.extensionKind !== "label-preset" && (
                        <p className="mt-2 text-xs text-amber-300">{text.safeModeRuntimeBlocked}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        disabled={isBusy || !canToggle}
                        type="button"
                        onClick={() => void togglePlugin(plugin)}
                      >
                        {plugin.state === "enabled" ? text.disable : text.enable}
                      </button>
                      <button
                        className="rounded border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
                        disabled={isBusy}
                        type="button"
                        onClick={() => void toggleDiagnostic(plugin.id)}
                      >
                        {diagnosticOpen ? text.hideLog : text.viewLog}
                      </button>
                      <button
                        className="rounded border border-red-500/60 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/20 disabled:opacity-50"
                        disabled={isBusy}
                        type="button"
                        onClick={() => void removePlugin(plugin)}
                      >
                        {text.uninstall}
                      </button>
                    </div>
                  </div>
                  {(plugin.state === "auto-disabled" || plugin.failureCount > 0) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 rounded border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-200">
                      <span>{text.failureCount(plugin.failureCount)}</span>
                      {plugin.lastError && <span className="min-w-0 flex-1 break-words">{plugin.lastError}</span>}
                      <button
                        className="rounded border border-red-400/60 px-2 py-1 text-xs hover:bg-red-500/20 disabled:opacity-50"
                        disabled={isBusy}
                        type="button"
                        onClick={() => void resetFailures(plugin)}
                      >
                        {text.clearFailures}
                      </button>
                    </div>
                  )}
                  {diagnosticOpen && (
                    <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs text-slate-300">
                      {runtimeLogs[plugin.id]?.join("\n") || plugin.lastError || text.noLog}
                    </pre>
                  )}
                </article>
              );
            })
          )}
        </div>
      </section>

      {preview && (
        <PermissionDialog
          confirmed={confirmedPermissions}
          isBusy={isInstalling}
          preview={preview}
          onApprove={() => void approveInstall()}
          onCancel={() => void cancelInstall()}
          onToggle={(index) =>
            setConfirmedPermissions((current) => {
              const next = new Set(current);
              if (next.has(index)) next.delete(index);
              else next.add(index);
              return next;
            })
          }
        />
      )}
    </div>
  );
}

interface PermissionDialogProps {
  confirmed: Set<number>;
  isBusy: boolean;
  preview: PluginInstallPreview;
  onApprove: () => void;
  onCancel: () => void;
  onToggle: (index: number) => void;
}

function PermissionDialog({
  confirmed,
  isBusy,
  preview,
  onApprove,
  onCancel,
  onToggle,
}: PermissionDialogProps) {
  const allConfirmed = confirmed.size === preview.permissions.length;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
      <section className="w-full max-w-xl rounded-xl border border-slate-600 bg-slate-900 p-5 shadow-2xl">
        <h3 className="text-lg font-semibold text-slate-100">{text.permissionTitle}</h3>
        <p className="mt-1 text-sm text-slate-300">
          {preview.manifest.name} · v{preview.manifest.version}
        </p>
        <p className="mt-3 text-sm text-slate-400">{text.permissionDescription}</p>
        {preview.isUpdate && <p className="mt-2 text-sm text-amber-300">{text.updateNotice}</p>}
        {preview.warning && <p className="mt-2 text-sm text-amber-300">{preview.warning}</p>}
        <div className="mt-4 space-y-2">
          {preview.permissions.length === 0 ? (
            <p className="rounded border border-slate-700 p-3 text-sm text-slate-400">{text.noPermissions}</p>
          ) : (
            preview.permissions.map((grant, index) => (
              <label className="flex cursor-pointer gap-3 rounded border border-slate-700 p-3 text-sm text-slate-200" key={permissionKey(grant)}>
                <input
                  checked={confirmed.has(index)}
                  className="mt-0.5"
                  type="checkbox"
                  onChange={() => onToggle(index)}
                />
                <span>{permissionLabel(grant)}</span>
              </label>
            ))
          )}
        </div>
        {!allConfirmed && <p className="mt-3 text-sm text-red-300">{text.permissionRequired}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button
            className="rounded border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            disabled={isBusy}
            type="button"
            onClick={onCancel}
          >
            {text.cancel}
          </button>
          <button
            className="rounded bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
            disabled={isBusy || !allConfirmed}
            type="button"
            onClick={onApprove}
          >
            {preview.isUpdate ? text.updateAndAuthorize : text.authorizeAndInstall}
          </button>
        </div>
      </section>
    </div>
  );
}

function permissionLabel(grant: PluginPermissionGrant): string {
  if (grant.permission === "network") return text.permissionNetwork;
  const target = grant.target ?? "";
  return grant.permission === "fs.read" ? text.permissionRead(target) : text.permissionWrite(target);
}

function permissionKey(grant: PluginPermissionGrant): string {
  return `${grant.permission}:${grant.target ?? ""}`;
}

function formatError(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
