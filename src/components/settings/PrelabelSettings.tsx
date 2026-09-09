// This settings workspace keeps model-library, runtime, and PT-conversion orchestration together
// because they share one guarded mutation lifecycle and active selection. The import form
// (PrelabelModelForm) and class-mapping panel (PrelabelClassMapping) live in their own modules.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  cancelOnnxRuntimeDownload,
  cancelPrelabelModelDownload,
  cancelPtConversion,
  confirmAction,
  convertPtToOnnx,
  detectPtConversionEnvironment,
  downloadOnnxRuntime,
  downloadPrelabelModel,
  findConvertedOnnx,
  getOnnxRuntimeStatus,
  inspectOnnxModel,
  installOnnxRuntimeFromFile,
  previewPtConversionCommand,
  selectOnnxRuntimeDll,
  selectPrelabelModelFile,
  validatePrelabelModel,
} from "../../lib/tauri-api";
import {
  applyModelDownloadResult,
  createPrelabelModelConfig,
  isValidModelSourceUrl,
  prelabelFormatLabel as formatLabel,
} from "../../lib/prelabel-models";
import {
  createPtConversionSession,
  isCurrentPtConversionPreview,
  isPtConversionCancelledResult,
  ptConversionErrorMessage,
  reducePtConversionSession,
  type PtConversionSession,
  validatePtConversionParameters,
} from "../../lib/prelabel-conversion";
import type { ProjectConfig } from "../../lib/importers";
import type { LabelConfig } from "../../types/annotation";
import type {
  OnnxRuntimeStatus,
  PrelabelModelConfig,
  PrelabelModelLibrary,
  PrelabelClassMapping,
  PtConversionEnvironment,
} from "../../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import { ModelImportForm } from "./PrelabelModelForm";
import { ClassMappingPanel } from "./PrelabelClassMapping";
import { PtConversionDialog } from "./PtConversionDialog";
import type { PluginPrelabelSourceDescriptor } from "../../types/plugin";

interface PrelabelSettingsProps {
  activeProjectConfig: ProjectConfig | null;
  isLabelDirty: boolean;
  isLoaded: boolean;
  labels: LabelConfig[];
  library: PrelabelModelLibrary;
  pluginSources: PluginPrelabelSourceDescriptor[];
  onAddModel: (model: PrelabelModelConfig) => Promise<void>;
  onClose: () => void;
  onDeleteModel: (modelId: string) => Promise<void>;
  onSelectModel: (modelId: string) => Promise<void>;
  onSaveMappings: (
    modelId: string,
    mappings: PrelabelClassMapping[],
    labels: LabelConfig[],
  ) => Promise<void>;
  onUpdateModel: (model: PrelabelModelConfig) => Promise<void>;
}

interface PtGuidance {
  path: string;
  suggestedOnnxPath: string | null;
  environment: PtConversionEnvironment;
}

export function PrelabelSettings({
  activeProjectConfig,
  isLabelDirty,
  isLoaded,
  labels,
  library,
  pluginSources,
  onAddModel,
  onClose,
  onDeleteModel,
  onSelectModel,
  onSaveMappings,
  onUpdateModel,
}: PrelabelSettingsProps) {
  const currentModel = useMemo(
    () => library.models.find((model) => model.id === library.currentModelId) ?? null,
    [library],
  );
  const [draft, setDraft] = useState<PrelabelModelConfig | null>(null);
  const [editingModel, setEditingModel] = useState<PrelabelModelConfig | null>(currentModel);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const selectedPlugin =
    pluginSources.find((source) => source.pluginId === selectedPluginId) ?? null;
  const [ptGuidance, setPtGuidance] = useState<PtGuidance | null>(null);
  const [ptConversionSession, setPtConversionSession] = useState<PtConversionSession | null>(null);
  const [ptConversionNotice, setPtConversionNotice] = useState("");
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<OnnxRuntimeStatus | null>(null);
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
  const [runtimeNotice, setRuntimeNotice] = useState("");
  const [modelValidation, setModelValidation] = useState("");
  const [downloadProgress, setDownloadProgress] = useState<{
    file: string;
    downloaded: number;
    total: number | null;
  } | null>(null);
  const [modelUpdateProgress, setModelUpdateProgress] = useState<{
    downloaded: number;
    total: number | null;
  } | null>(null);
  const [modelUpdateNotice, setModelUpdateNotice] = useState<{
    tone: "success" | "warning";
    message: string;
  } | null>(null);
  const [isModelUpdating, setIsModelUpdating] = useState(false);
  const mutationInFlight = useRef(false);
  const cancelledConversions = useRef(new Set<string>());
  const cancelledDownloads = useRef(new Set<string>());
  const activeDownloadId = useRef<string | null>(null);
  const cancelledModelDownloads = useRef(new Set<string>());
  const activeModelDownloadId = useRef<string | null>(null);

  useEffect(() => setEditingModel(currentModel), [currentModel]);
  useEffect(() => {
    void getOnnxRuntimeStatus()
      .then(setRuntimeStatus)
      .catch((reason: unknown) => {
        setError(String(reason));
      });
  }, []);

  async function loadOnnxDraft(path: string) {
    const summary = await inspectOnnxModel(path);
    setDraft(createPrelabelModelConfig(path, summary));
    setPtGuidance(null);
  }

  async function inspectPath(path: string) {
    await runLibraryMutation(async () => {
      try {
        await loadOnnxDraft(path);
      } catch (reason) {
        setError(text.importFailed(reason));
      }
    });
  }

  async function chooseModel() {
    await runLibraryMutation(async () => {
      const path = await selectPrelabelModelFile();
      if (!path) {
        return;
      }
      if (/\.pt$/i.test(path)) {
        setDraft(null);
        const [suggestedOnnxPath, environment] = await Promise.all([
          findConvertedOnnx(path),
          detectPtConversionEnvironment(),
        ]);
        setPtGuidance({ path, suggestedOnnxPath, environment });
        return;
      }
      try {
        await loadOnnxDraft(path);
      } catch (reason) {
        setError(text.importFailed(reason));
      }
    });
  }

  async function runLibraryMutation(action: () => Promise<void>) {
    if (mutationInFlight.current) {
      return;
    }
    mutationInFlight.current = true;
    setIsBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      mutationInFlight.current = false;
      setIsBusy(false);
    }
  }

  async function runRuntimeAction(action: () => Promise<OnnxRuntimeStatus>) {
    setIsRuntimeBusy(true);
    setError("");
    setModelValidation("");
    try {
      setRuntimeStatus(await action());
    } catch (reason) {
      setError(text.runtimeOperationFailed(reason));
    } finally {
      setIsRuntimeBusy(false);
    }
  }

  async function installRuntimeManually() {
    const path = await selectOnnxRuntimeDll();
    if (path) {
      await runRuntimeAction(() => installOnnxRuntimeFromFile(path));
    }
  }

  async function downloadRuntime() {
    if (isRuntimeBusy) {
      return;
    }
    if (!(await confirmAction(text.runtimeDownloadConfirmation))) {
      return;
    }
    const downloadId = crypto.randomUUID();
    cancelledDownloads.current.delete(downloadId);
    activeDownloadId.current = downloadId;
    setIsRuntimeBusy(true);
    setError("");
    setRuntimeNotice("");
    setDownloadProgress(null);
    try {
      const outcome = await downloadOnnxRuntime(downloadId, (event) => {
        if (event.event === "progress") {
          setDownloadProgress({
            file: event.fileName,
            downloaded: event.downloaded,
            total: event.total,
          });
        }
      });
      if (cancelledDownloads.current.has(downloadId) || outcome.cancelled) {
        setRuntimeNotice(text.runtimeDownloadCancelled);
      } else {
        setRuntimeStatus(await getOnnxRuntimeStatus());
        setRuntimeNotice(text.runtimeCompleted);
      }
    } catch (reason) {
      setError(text.runtimeOperationFailed(reason));
    } finally {
      if (activeDownloadId.current === downloadId) {
        activeDownloadId.current = null;
      }
      setIsRuntimeBusy(false);
      setDownloadProgress(null);
    }
  }

  async function cancelRuntimeDownload() {
    const downloadId = activeDownloadId.current;
    if (!downloadId) {
      return;
    }
    cancelledDownloads.current.add(downloadId);
    try {
      await cancelOnnxRuntimeDownload(downloadId);
    } catch (reason) {
      setError(text.runtimeOperationFailed(reason));
    }
  }

  /** 从模型配置的更新地址手动拉取新版本：下载、校验 ONNX、落盘到受管目录并更新配置。 */
  async function updateModelFromUrl(model: PrelabelModelConfig) {
    const sourceUrl = (model.sourceUrl ?? "").trim();
    if (!isValidModelSourceUrl(sourceUrl)) {
      setError(text.modelUpdateUnavailable);
      return;
    }
    if (isModelUpdating) {
      return;
    }
    if (!(await confirmAction(text.updateModelConfirm(sourceUrl)))) {
      return;
    }
    const downloadId = crypto.randomUUID();
    cancelledModelDownloads.current.delete(downloadId);
    activeModelDownloadId.current = downloadId;
    setIsModelUpdating(true);
    setError("");
    setModelUpdateNotice(null);
    setModelUpdateProgress(null);
    try {
      const result = await downloadPrelabelModel(sourceUrl, model.path, downloadId, (event) => {
        if (event.event === "progress") {
          setModelUpdateProgress({ downloaded: event.downloaded, total: event.total });
        }
      });
      if (cancelledModelDownloads.current.has(downloadId) || !result) {
        setModelUpdateNotice({ tone: "warning", message: text.modelUpdateCancelled });
      } else {
        await onUpdateModel(applyModelDownloadResult(model, result));
        setModelUpdateNotice({ tone: "success", message: text.modelUpdateCompleted(model.name) });
      }
    } catch (reason) {
      setError(text.modelUpdateFailed(reason));
    } finally {
      if (activeModelDownloadId.current === downloadId) {
        activeModelDownloadId.current = null;
      }
      cancelledModelDownloads.current.delete(downloadId);
      setIsModelUpdating(false);
      setModelUpdateProgress(null);
    }
  }

  async function cancelModelDownload() {
    const downloadId = activeModelDownloadId.current;
    if (!downloadId) {
      return;
    }
    cancelledModelDownloads.current.add(downloadId);
    try {
      await cancelPrelabelModelDownload(downloadId);
    } catch (reason) {
      setError(text.modelUpdateFailed(reason));
    }
  }

  async function refreshRuntime() {
    await runRuntimeAction(getOnnxRuntimeStatus);
  }

  async function validateModel(model: PrelabelModelConfig) {
    setIsRuntimeBusy(true);
    setError("");
    setModelValidation("");
    try {
      const report = await validatePrelabelModel(model.path);
      setModelValidation(
        text.modelValidationPassed(
          formatLabel(report.format),
          report.classCount,
          report.inputWidth || model.inputSizeOverride?.[0] || model.inputWidth,
          report.inputHeight || model.inputSizeOverride?.[1] || model.inputHeight,
        ),
      );
      setRuntimeStatus(await getOnnxRuntimeStatus());
    } catch (reason) {
      setError(text.modelValidationFailed(reason));
    } finally {
      setIsRuntimeBusy(false);
    }
  }

  function refreshPtConversionPreview(guidance: PtGuidance, session: PtConversionSession) {
    if (validatePtConversionParameters(session.parameters)) {
      return;
    }
    void previewPtConversionCommand(
      guidance.path,
      session.parameters,
      session.conversionId,
      guidance.environment,
    )
      .then((plan) =>
        setPtConversionSession((current) =>
          isCurrentPtConversionPreview(current, session)
            ? reducePtConversionSession(current, { type: "preview", plan })
            : current,
        ),
      )
      .catch((reason: unknown) =>
        setPtConversionSession((current) =>
          isCurrentPtConversionPreview(current, session)
            ? { ...current, plan: null, error: ptConversionErrorMessage(reason) }
            : current,
        ),
      );
  }

  function openPtConversion(guidance: PtGuidance) {
    setPtConversionNotice("");
    const session = createPtConversionSession(crypto.randomUUID());
    setPtConversionSession(session);
    refreshPtConversionPreview(guidance, session);
  }

  async function convertPt(guidance: PtGuidance, session: PtConversionSession) {
    if (mutationInFlight.current || session.status !== "confirming" || !session.plan) {
      return;
    }
    mutationInFlight.current = true;
    setIsBusy(true);
    setError("");
    setPtConversionNotice("");
    setPtConversionSession((current) =>
      current ? reducePtConversionSession(current, { type: "start" }) : current,
    );
    try {
      const result = await convertPtToOnnx(
        guidance.path,
        session.plan,
        session.conversionId,
        (event) =>
          setPtConversionSession((current) =>
            current ? reducePtConversionSession(current, { type: "event", event }) : current,
          ),
      );
      setDraft(
        createPrelabelModelConfig(result.path, {
          format: result.format,
          classCount: result.classCount,
          inputWidth: result.inputWidth,
          inputHeight: result.inputHeight,
          classNames: result.classNames,
        }),
      );
      setPtGuidance(null);
      setPtConversionSession(null);
    } catch (reason) {
      if (
        cancelledConversions.current.has(session.conversionId) &&
        isPtConversionCancelledResult(reason)
      ) {
        setPtConversionSession(null);
        setPtConversionNotice(text.ptCancelled);
      } else {
        setPtConversionSession((current) =>
          current
            ? reducePtConversionSession(current, {
                type: "fail",
                error: ptConversionErrorMessage(reason),
              })
            : current,
        );
      }
    } finally {
      cancelledConversions.current.delete(session.conversionId);
      mutationInFlight.current = false;
      setIsBusy(false);
    }
  }

  async function cancelPt(session: PtConversionSession) {
    if (session.status !== "running") {
      return;
    }
    cancelledConversions.current.add(session.conversionId);
    setPtConversionSession((current) =>
      current ? reducePtConversionSession(current, { type: "cancel" }) : current,
    );
    try {
      const result = await cancelPtConversion(session.conversionId);
      if (result.status === "already-completed") {
        cancelledConversions.current.delete(session.conversionId);
      }
    } catch (reason) {
      cancelledConversions.current.delete(session.conversionId);
      setPtConversionSession((current) =>
        current
          ? reducePtConversionSession(current, {
              type: "cancel-failed",
              error: text.ptCancelFailed(ptConversionErrorMessage(reason)),
            })
          : current,
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 px-4 py-6">
      <section className="flex max-h-full w-full max-w-5xl flex-col rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">{text.title}</h2>
            <p className="mt-1 text-xs text-slate-400">{text.description}</p>
          </div>
          <button
            className="rounded border border-slate-700 px-3 py-1 text-sm disabled:opacity-50"
            disabled={isBusy || isRuntimeBusy}
            type="button"
            onClick={onClose}
          >
            {text.close}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[18rem_1fr] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
          <aside className="overflow-y-auto border-b border-slate-800 p-4 md:border-b-0 md:border-r">
            <button
              className="w-full rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50"
              disabled={isBusy}
              type="button"
              onClick={() => void chooseModel()}
            >
              {isBusy ? text.reading : text.addModel}
            </button>
            {!isLoaded && <p className="mt-3 text-xs text-slate-500">{text.loadingLibrary}</p>}
            {isLoaded && library.models.length === 0 && (
              <p className="mt-3 rounded border border-dashed border-slate-700 p-3 text-xs text-slate-500">
                {text.emptyLibrary}
              </p>
            )}
            <div className="mt-3 space-y-2">
              {library.models.map((model) => (
                <button
                  className={`w-full rounded border p-3 text-left ${
                    model.id === library.currentModelId
                      ? "border-sky-500 bg-sky-500/10"
                      : "border-slate-800 bg-slate-950 hover:border-slate-600"
                  }`}
                  key={model.id}
                  disabled={isBusy}
                  type="button"
                  onClick={() => {
                    setSelectedPluginId(null);
                    void runLibraryMutation(() => onSelectModel(model.id));
                  }}
                >
                  <span className="block truncate text-sm font-medium text-slate-100">
                    {model.name}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {formatLabel(model.format)} ·{" "}
                    {text.modelSummary(model.classCount, model.inputWidth, model.inputHeight)}
                  </span>
                </button>
              ))}
            </div>
            {pluginSources.length > 0 && (
              <>
                <p className="mt-5 text-xs font-medium text-slate-400">{text.pluginSourcesTitle}</p>
                <div className="mt-2 space-y-2">
                  {pluginSources.map((source) => (
                    <button
                      className={`w-full rounded border p-3 text-left ${
                        source.pluginId === selectedPluginId
                          ? "border-violet-500 bg-violet-500/10"
                          : "border-slate-800 bg-slate-950 hover:border-slate-600"
                      }`}
                      key={source.pluginId}
                      type="button"
                      onClick={() => {
                        setEditingModel(null);
                        setSelectedPluginId(source.pluginId);
                      }}
                    >
                      <span className="block truncate text-sm font-medium text-slate-100">
                        {source.pluginName}
                      </span>
                      <span
                        className={`mt-1 block text-xs ${source.enabled ? "text-slate-500" : "text-amber-300"}`}
                      >
                        {source.disabledReason ?? text.pluginSourceReady}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>

          <main className="overflow-y-auto p-5">
            {error && (
              <p className="mb-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </p>
            )}
            {ptConversionNotice && (
              <p className="mb-4 rounded border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-100">
                {ptConversionNotice}
              </p>
            )}
            <RuntimeStatusPanel
              downloadProgress={downloadProgress}
              isBusy={isRuntimeBusy}
              isDownloading={activeDownloadId.current !== null}
              notice={runtimeNotice}
              status={runtimeStatus}
              onCancel={() => void cancelRuntimeDownload()}
              onDownload={() => void downloadRuntime()}
              onInstall={() => void installRuntimeManually()}
              onRefresh={() => void refreshRuntime()}
            />
            {modelValidation && (
              <p className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                {modelValidation}
              </p>
            )}
            {modelUpdateNotice && (
              <p
                className={`mb-4 rounded border p-3 text-sm ${
                  modelUpdateNotice.tone === "success"
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                    : "border-amber-500/50 bg-amber-500/10 text-amber-100"
                }`}
              >
                {modelUpdateNotice.message}
              </p>
            )}
            {ptGuidance && (
              <PtConversionGuidance
                guidance={ptGuidance}
                isBusy={isBusy}
                onConvert={() => openPtConversion(ptGuidance)}
                onInspectSuggested={(path) => void inspectPath(path)}
              />
            )}
            {draft && (
              <ModelImportForm
                mode="create"
                gpuAvailable={runtimeStatus?.gpuAvailable}
                model={draft}
                submitLabel={text.addToLibrary}
                onCancel={() => setDraft(null)}
                onChange={setDraft}
                onValidate={() => void validateModel(draft)}
                onSubmit={() =>
                  void runLibraryMutation(async () => {
                    await onAddModel(draft);
                    setDraft(null);
                  })
                }
              />
            )}
            {!draft && !ptGuidance && editingModel && (
              <>
                <ModelImportForm
                  mode="edit"
                  gpuAvailable={runtimeStatus?.gpuAvailable}
                  model={editingModel}
                  submitLabel={text.saveModel}
                  update={{
                    isUpdating: isModelUpdating,
                    progress: modelUpdateProgress,
                  }}
                  onCancel={() => setEditingModel(currentModel)}
                  onChange={setEditingModel}
                  onCancelUpdate={() => void cancelModelDownload()}
                  onUpdateFromUrl={() => void updateModelFromUrl(editingModel)}
                  onValidate={() => void validateModel(editingModel)}
                  onDelete={() => {
                    if (window.confirm(text.removeConfirmation(editingModel.name))) {
                      void runLibraryMutation(() => onDeleteModel(editingModel.id));
                    }
                  }}
                  onSubmit={() => void runLibraryMutation(() => onUpdateModel(editingModel))}
                />
                {currentModel && (
                  <ClassMappingPanel
                    activeProjectConfig={activeProjectConfig}
                    disabled={isBusy || isLabelDirty}
                    isLabelDirty={isLabelDirty}
                    labels={labels}
                    classNames={currentModel.classNames}
                    sourceId={currentModel.id}
                    onSave={(mappings, nextLabels) =>
                      runLibraryMutation(() =>
                        onSaveMappings(currentModel.id, mappings, nextLabels),
                      )
                    }
                  />
                )}
              </>
            )}
            {!draft && !ptGuidance && selectedPlugin && (
              <>
                <section className="rounded border border-violet-500/30 bg-violet-500/5 p-4">
                  <h3 className="font-medium text-slate-100">{selectedPlugin.pluginName}</h3>
                  <p className="mt-1 text-xs text-slate-400">
                    {text.pluginSourceDescription(selectedPlugin.annotationTypes.join("、"))}
                  </p>
                </section>
                <ClassMappingPanel
                  activeProjectConfig={activeProjectConfig}
                  classNames={
                    selectedPlugin.classNames.length > 0
                      ? selectedPlugin.classNames
                      : labels.map((label) => label.name)
                  }
                  disabled={isBusy || isLabelDirty || !selectedPlugin.enabled}
                  isLabelDirty={isLabelDirty}
                  labels={labels}
                  sourceId={selectedPlugin.selectionId}
                  onSave={(mappings, nextLabels) =>
                    runLibraryMutation(() =>
                      onSaveMappings(selectedPlugin.selectionId, mappings, nextLabels),
                    )
                  }
                />
              </>
            )}
            {!draft && !ptGuidance && !editingModel && !selectedPlugin && isLoaded && (
              <div className="grid min-h-64 place-items-center text-sm text-slate-500">
                {text.emptySelection}
              </div>
            )}
          </main>
        </div>
      </section>
      {ptGuidance && ptConversionSession && (
        <PtConversionDialog
          environment={ptGuidance.environment}
          path={ptGuidance.path}
          session={ptConversionSession}
          onBack={() => setPtConversionSession(null)}
          onCancel={() => void cancelPt(ptConversionSession)}
          onConfirm={() => void convertPt(ptGuidance, ptConversionSession)}
          onParametersChange={(parameters) => {
            const next = { ...ptConversionSession, parameters, plan: null, error: "" };
            setPtConversionSession(next);
            refreshPtConversionPreview(ptGuidance, next);
          }}
        />
      )}
    </div>
  );
}

function RuntimeStatusPanel({
  downloadProgress,
  isBusy,
  isDownloading,
  notice,
  status,
  onCancel,
  onDownload,
  onInstall,
  onRefresh,
}: {
  downloadProgress: { file: string; downloaded: number; total: number | null } | null;
  isBusy: boolean;
  isDownloading: boolean;
  notice: string;
  status: OnnxRuntimeStatus | null;
  onCancel: () => void;
  onDownload: () => void;
  onInstall: () => void;
  onRefresh: () => void;
}) {
  const available = status?.state === "available";
  const progressPercent =
    downloadProgress && downloadProgress.total
      ? Math.min(100, (downloadProgress.downloaded / downloadProgress.total) * 100)
      : 0;
  return (
    <div className="mb-4 rounded border border-slate-700 bg-slate-950/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-100">{text.runtimeTitle}</h3>
          <p className={`mt-1 text-xs ${available ? "text-emerald-300" : "text-amber-300"}`}>
            {status?.message ?? text.runtimeChecking}
          </p>
          {status && (
            <p className="mt-2 break-all text-xs text-slate-500">
              {text.runtimeDirectory(status.runtimeDirectory)}
            </p>
          )}
          {status?.gpuAvailable != null && (
            <p className="mt-1 text-xs text-slate-400">
              {status.gpuAvailable ? text.runtimeGpuCapable : text.runtimeGpuAbsent}
            </p>
          )}
        </div>
        <span
          className={`rounded px-2 py-1 text-xs ${
            available ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"
          }`}
        >
          {available ? text.runtimeAvailable : text.runtimeUnavailable}
        </span>
      </div>
      {notice && <p className="mt-3 text-xs text-slate-400">{notice}</p>}
      {!available && (
        <>
          <p className="mt-3 text-xs leading-5 text-slate-400">{text.runtimeDescription}</p>
          {isDownloading && (
            <div className="mt-3 rounded border border-slate-700 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>
                  {text.runtimeDownloadingFile(downloadProgress?.file)}
                  {downloadProgress?.total != null &&
                    ` · ${text.runtimeDownloadBytes(
                      downloadProgress.downloaded,
                      downloadProgress.total,
                    )}`}
                </span>
                <button
                  className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800"
                  type="button"
                  onClick={onCancel}
                >
                  {text.runtimeCancelDownload}
                </button>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className="h-full bg-sky-500 transition-all"
                  style={{
                    width: downloadProgress?.total ? `${progressPercent}%` : "12%",
                  }}
                />
              </div>
            </div>
          )}
          {!isDownloading && (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                disabled={isBusy || status?.downloadAvailable === false}
                type="button"
                onClick={onDownload}
              >
                {isBusy ? text.runtimeDownloading : text.runtimeDownload}
              </button>
              <button
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                disabled={isBusy}
                type="button"
                onClick={onInstall}
              >
                {text.runtimeManual}
              </button>
              <button
                className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                disabled={isBusy}
                type="button"
                onClick={onRefresh}
              >
                {text.runtimeRefresh}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PtConversionGuidance({
  guidance,
  isBusy,
  onConvert,
  onInspectSuggested,
}: {
  guidance: PtGuidance;
  isBusy: boolean;
  onConvert: () => void;
  onInspectSuggested: (path: string) => void;
}) {
  const suggestedOnnxPath = guidance.suggestedOnnxPath;
  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="font-medium text-amber-100">{text.ptUnsupported}</h3>
      <p className="mt-2 text-sm text-amber-50/80">{text.ptInstruction}</p>
      <p
        className={`mt-3 rounded border p-3 text-sm ${
          guidance.environment.available
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
            : "border-slate-700 bg-slate-950/60 text-slate-400"
        }`}
      >
        {guidance.environment.message}
      </p>
      {guidance.environment.available && (
        <button
          className="mt-3 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={isBusy}
          type="button"
          onClick={onConvert}
        >
          {isBusy ? text.ptConverting : text.ptConvertNow}
        </button>
      )}
      {suggestedOnnxPath && (
        <button
          className="mt-4 rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500 disabled:opacity-50"
          disabled={isBusy}
          type="button"
          onClick={() => onInspectSuggested(suggestedOnnxPath)}
        >
          {text.suggestedOnnx(suggestedOnnxPath)}
        </button>
      )}
    </div>
  );
}
