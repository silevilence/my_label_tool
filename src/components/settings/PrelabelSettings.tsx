import { useEffect, useMemo, useState } from "react";
import {
  confirmAction,
  downloadOnnxRuntime,
  findConvertedOnnx,
  getOnnxRuntimeStatus,
  inspectOnnxModel,
  installOnnxRuntimeFromFile,
  selectOnnxRuntimeDll,
  selectPrelabelModelFile,
  validatePrelabelModel,
} from "../../lib/tauri-api";
import {
  createPrelabelModelConfig,
  ptConversionCommand,
  updateInputSizeOverride,
} from "../../lib/prelabel-models";
import type {
  OnnxRuntimeStatus,
  PrelabelModelConfig,
  PrelabelModelLibrary,
} from "../../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";

interface PrelabelSettingsProps {
  isLoaded: boolean;
  library: PrelabelModelLibrary;
  onAddModel: (model: PrelabelModelConfig) => Promise<void>;
  onClose: () => void;
  onDeleteModel: (modelId: string) => Promise<void>;
  onSelectModel: (modelId: string) => Promise<void>;
  onUpdateModel: (model: PrelabelModelConfig) => Promise<void>;
}

interface PtGuidance {
  path: string;
  suggestedOnnxPath: string | null;
}

export function PrelabelSettings({
  isLoaded,
  library,
  onAddModel,
  onClose,
  onDeleteModel,
  onSelectModel,
  onUpdateModel,
}: PrelabelSettingsProps) {
  const currentModel = useMemo(
    () => library.models.find((model) => model.id === library.currentModelId) ?? null,
    [library],
  );
  const [draft, setDraft] = useState<PrelabelModelConfig | null>(null);
  const [editingModel, setEditingModel] = useState<PrelabelModelConfig | null>(currentModel);
  const [ptGuidance, setPtGuidance] = useState<PtGuidance | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<OnnxRuntimeStatus | null>(null);
  const [isRuntimeBusy, setIsRuntimeBusy] = useState(false);
  const [modelValidation, setModelValidation] = useState("");

  useEffect(() => setEditingModel(currentModel), [currentModel]);
  useEffect(() => {
    void getOnnxRuntimeStatus().then(setRuntimeStatus).catch((reason: unknown) => {
      setError(String(reason));
    });
  }, []);

  async function inspectPath(path: string) {
    setIsBusy(true);
    setError("");
    try {
      const summary = await inspectOnnxModel(path);
      setDraft(createPrelabelModelConfig(path, summary));
      setPtGuidance(null);
    } catch (reason) {
      setError(text.importFailed(reason));
    } finally {
      setIsBusy(false);
    }
  }

  async function chooseModel() {
    const path = await selectPrelabelModelFile();
    if (!path) {
      return;
    }
    if (/\.pt$/i.test(path)) {
      setDraft(null);
      setError("");
      try {
        setPtGuidance({ path, suggestedOnnxPath: await findConvertedOnnx(path) });
      } catch (reason) {
        setError(String(reason));
      }
      return;
    }
    await inspectPath(path);
  }

  async function runLibraryMutation(action: () => Promise<void>) {
    setIsBusy(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
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
    if (await confirmAction(text.runtimeDownloadConfirmation)) {
      await runRuntimeAction(downloadOnnxRuntime);
    }
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
          report.inputWidth,
          report.inputHeight,
        ),
      );
      setRuntimeStatus(await getOnnxRuntimeStatus());
    } catch (reason) {
      setError(text.modelValidationFailed(reason));
    } finally {
      setIsRuntimeBusy(false);
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
            className="rounded border border-slate-700 px-3 py-1 text-sm"
            type="button"
            onClick={onClose}
          >
            {text.close}
          </button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[18rem_1fr]">
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
                  type="button"
                  onClick={() => void runLibraryMutation(() => onSelectModel(model.id))}
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
          </aside>

          <main className="overflow-y-auto p-5">
            {error && (
              <p className="mb-4 rounded border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
                {error}
              </p>
            )}
            <RuntimeStatusPanel
              isBusy={isRuntimeBusy}
              status={runtimeStatus}
              onDownload={() => void downloadRuntime()}
              onInstall={() => void installRuntimeManually()}
            />
            {modelValidation && (
              <p className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                {modelValidation}
              </p>
            )}
            {ptGuidance && (
              <PtConversionGuidance
                guidance={ptGuidance}
                onInspectSuggested={(path) => void inspectPath(path)}
              />
            )}
            {draft && (
              <ModelImportForm
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
              <ModelImportForm
                model={editingModel}
                submitLabel={text.saveModel}
                onCancel={() => setEditingModel(currentModel)}
                onChange={setEditingModel}
                onValidate={() => void validateModel(editingModel)}
                onDelete={() => {
                  if (window.confirm(text.removeConfirmation(editingModel.name))) {
                    void runLibraryMutation(() => onDeleteModel(editingModel.id));
                  }
                }}
                onSubmit={() => void runLibraryMutation(() => onUpdateModel(editingModel))}
              />
            )}
            {!draft && !ptGuidance && !editingModel && isLoaded && (
              <div className="grid min-h-64 place-items-center text-sm text-slate-500">
                {text.emptySelection}
              </div>
            )}
          </main>
        </div>
      </section>
    </div>
  );
}

function RuntimeStatusPanel({
  isBusy,
  status,
  onDownload,
  onInstall,
}: {
  isBusy: boolean;
  status: OnnxRuntimeStatus | null;
  onDownload: () => void;
  onInstall: () => void;
}) {
  const available = status?.state === "available";
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
              {text.runtimeDirectoryLabel}：{status.runtimeDirectory}
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
      {!available && (
        <>
          <p className="mt-3 text-xs leading-5 text-slate-400">{text.runtimeDescription}</p>
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
          </div>
        </>
      )}
    </div>
  );
}

function PtConversionGuidance({
  guidance,
  onInspectSuggested,
}: {
  guidance: PtGuidance;
  onInspectSuggested: (path: string) => void;
}) {
  const command = ptConversionCommand(guidance.path);
  return (
    <div className="rounded border border-amber-500/40 bg-amber-500/10 p-4">
      <h3 className="font-medium text-amber-100">{text.ptUnsupported}</h3>
      <p className="mt-2 text-sm text-amber-50/80">{text.ptInstruction}</p>
      <div className="mt-2 flex gap-2">
        <code className="min-w-0 flex-1 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-200">
          {command}
        </code>
        <button
          className="rounded border border-amber-400/50 px-3 text-xs"
          type="button"
          onClick={() => void navigator.clipboard.writeText(command)}
        >
          {text.copy}
        </button>
      </div>
      {guidance.suggestedOnnxPath && (
        <button
          className="mt-4 rounded bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-500"
          type="button"
          onClick={() => onInspectSuggested(guidance.suggestedOnnxPath!)}
        >
          {text.suggestedOnnx(guidance.suggestedOnnxPath)}
        </button>
      )}
    </div>
  );
}

function ModelImportForm({
  model,
  submitLabel,
  onCancel,
  onChange,
  onDelete,
  onSubmit,
  onValidate,
}: {
  model: PrelabelModelConfig;
  submitLabel: string;
  onCancel: () => void;
  onChange: (model: PrelabelModelConfig) => void;
  onDelete?: () => void;
  onSubmit: () => void;
  onValidate: () => void;
}) {
  const invalid =
    !model.name.trim() ||
    model.classNames.some((name) => !name.trim()) ||
    !Number.isFinite(model.confidenceThreshold) ||
    model.confidenceThreshold < 0 ||
    model.confidenceThreshold > 1 ||
    !Number.isFinite(model.iouThreshold) ||
    model.iouThreshold < 0 ||
    model.iouThreshold > 1;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-100">{text.importForm}</h3>
          <p className="mt-1 break-all text-xs text-slate-500">{model.path}</p>
        </div>
        <span className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-300">
          {formatLabel(model.format)}
        </span>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={text.modelName}>
          <input
            className={inputClass}
            value={model.name}
            onChange={(event) => onChange({ ...model, name: event.target.value })}
          />
        </Field>
        <Field label={text.inspectedInfo}>
          <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-300">
            {text.modelSummary(model.classCount, model.inputWidth, model.inputHeight)}
          </div>
        </Field>
        <Field label={text.confidenceThreshold}>
          <input
            className={inputClass}
            max="1"
            min="0"
            step="0.01"
            type="number"
            value={model.confidenceThreshold}
            onChange={(event) =>
              onChange({ ...model, confidenceThreshold: event.target.valueAsNumber })
            }
          />
        </Field>
        <Field label={text.iouThreshold}>
          <input
            className={inputClass}
            max="1"
            min="0"
            step="0.01"
            type="number"
            value={model.iouThreshold}
            onChange={(event) => onChange({ ...model, iouThreshold: event.target.valueAsNumber })}
          />
        </Field>
        <Field label={text.inputWidthOverride}>
          <input
            className={inputClass}
            min="1"
            placeholder={String(model.inputWidth)}
            type="number"
            value={model.inputSizeOverride?.[0] ?? ""}
            onChange={(event) =>
              onChange({
                ...model,
                inputSizeOverride: updateInputSizeOverride(model, 0, event.target.value),
              })
            }
          />
        </Field>
        <Field label={text.inputHeightOverride}>
          <input
            className={inputClass}
            min="1"
            placeholder={String(model.inputHeight)}
            type="number"
            value={model.inputSizeOverride?.[1] ?? ""}
            onChange={(event) =>
              onChange({
                ...model,
                inputSizeOverride: updateInputSizeOverride(model, 1, event.target.value),
              })
            }
          />
        </Field>
      </div>
      <h4 className="mt-5 text-sm font-medium text-slate-200">{text.classNames}</h4>
      <div className="mt-2 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">
        {model.classNames.map((name, index) => (
          <label className="grid grid-cols-[3rem_1fr] items-center gap-2" key={index}>
            <span className="text-right text-xs text-slate-500">{index}</span>
            <input
              className={inputClass}
              value={name}
              onChange={(event) =>
                onChange({
                  ...model,
                  classNames: model.classNames.map((candidate, candidateIndex) =>
                    candidateIndex === index ? event.target.value : candidate,
                  ),
                })
              }
            />
          </label>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-4">
        <div>
          {onDelete && (
            <button
              className="rounded border border-red-500/50 px-3 py-2 text-sm text-red-300"
              type="button"
              onClick={onDelete}
            >
              {text.removeModel}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border border-emerald-500/50 px-3 py-2 text-sm text-emerald-300 disabled:opacity-50"
            disabled={invalid}
            type="button"
            onClick={onValidate}
          >
            {text.validateModel}
          </button>
          <button
            className="rounded border border-slate-700 px-3 py-2 text-sm"
            type="button"
            onClick={onCancel}
          >
            {text.cancelChanges}
          </button>
          <button
            className="rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={invalid}
            type="button"
            onClick={onSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function formatLabel(format: PrelabelModelConfig["format"]): string {
  return format === "yolo11" ? "YOLO11" : format === "yolov8" ? "YOLOv8" : "YOLOv5";
}

const inputClass =
  "w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
