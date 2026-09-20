import type { PrelabelDevice, PrelabelModelConfig } from "../../types/prelabel";
import { PRELABEL_ZH_CN as text } from "../../i18n/prelabel.zh-CN";
import {
  isValidModelSourceUrl,
  prelabelFormatLabel as formatLabel,
  updateInputSizeOverride,
} from "../../lib/prelabel-models";

export interface ModelDownloadUiState {
  isUpdating: boolean;
  progress: { downloaded: number; total: number | null } | null;
}

export function ModelImportForm({
  mode,
  disabled = false,
  model,
  submitLabel,
  gpuAvailable,
  update,
  onCancel,
  onChange,
  onCancelUpdate,
  onDelete,
  onSubmit,
  onUpdateFromUrl,
  onValidate,
}: {
  mode: "create" | "edit";
  disabled?: boolean;
  model: PrelabelModelConfig;
  submitLabel: string;
  gpuAvailable?: boolean | null;
  update?: ModelDownloadUiState;
  onCancel: () => void;
  onChange: (model: PrelabelModelConfig) => void;
  onCancelUpdate?: () => void;
  onDelete?: () => void;
  onSubmit: () => void;
  onUpdateFromUrl?: () => void;
  onValidate: () => void;
}) {
  const fieldErrors = {
    name: !model.name.trim() ? text.fieldNameRequired : "",
    classNames: model.classNames.some((name) => !name.trim()) ? text.fieldClassNamesBlank : "",
    confidence:
      !Number.isFinite(model.confidenceThreshold) ||
      model.confidenceThreshold < 0 ||
      model.confidenceThreshold > 1
        ? text.fieldThresholdRange
        : "",
    iou:
      !Number.isFinite(model.iouThreshold) ||
      model.iouThreshold < 0 ||
      model.iouThreshold > 1
        ? text.fieldThresholdRange
        : "",
    inputSize: !(model.inputSizeOverride ?? [model.inputWidth, model.inputHeight]).every(
      (dimension) => Number.isSafeInteger(dimension) && dimension > 0,
    )
      ? text.fieldSizePositive
      : "",
    sourceUrl:
      Boolean(model.sourceUrl?.trim()) && !isValidModelSourceUrl(model.sourceUrl ?? "")
        ? text.fieldSourceUrlInvalid
        : "",
  };
  const invalid = Object.values(fieldErrors).some(Boolean);
  const firstFieldError = Object.values(fieldErrors).find(Boolean) ?? "";
  const sourceUrl = model.sourceUrl ?? "";
  const canUpdate = Boolean(update && onUpdateFromUrl) && isValidModelSourceUrl(sourceUrl);
  const progressPercent =
    update?.progress && update.progress.total
      ? Math.min(100, (update.progress.downloaded / update.progress.total) * 100)
      : 0;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!invalid && !disabled) onSubmit();
      }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium text-slate-100">{text.importForm}</h3>
          <p className="mt-1 break-all text-xs text-slate-500">{model.path}</p>
        </div>
        <span className="rounded bg-sky-500/15 px-2 py-1 text-xs text-sky-300">
          {formatLabel(model.format)}
        </span>
      </div>
      <fieldset disabled={disabled} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field error={fieldErrors.name} errorId="model-name-error" label={text.modelName}>
          <input
            aria-describedby={fieldErrors.name ? "model-name-error" : undefined}
            aria-invalid={Boolean(fieldErrors.name) || undefined}
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
        <Field error={fieldErrors.confidence} errorId="model-confidence-error" label={text.confidenceThreshold}>
          <input
            aria-describedby={fieldErrors.confidence ? "model-confidence-error" : undefined}
            aria-invalid={Boolean(fieldErrors.confidence) || undefined}
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
        <Field error={fieldErrors.iou} errorId="model-iou-error" label={text.iouThreshold}>
          <input
            aria-describedby={fieldErrors.iou ? "model-iou-error" : undefined}
            aria-invalid={Boolean(fieldErrors.iou) || undefined}
            className={inputClass}
            max="1"
            min="0"
            step="0.01"
            type="number"
            value={model.iouThreshold}
            onChange={(event) => onChange({ ...model, iouThreshold: event.target.valueAsNumber })}
          />
        </Field>
        <Field label={text.device}>
          <select
            className={inputClass}
            value={model.device}
            onChange={(event) =>
              onChange({ ...model, device: event.target.value as PrelabelDevice })
            }
          >
            <option value="auto">{text.deviceAuto}</option>
            <option value="cpu">{text.deviceCpu}</option>
            <option value="gpu">{text.deviceGpu}</option>
          </select>
        </Field>
        {model.device === "gpu" && gpuAvailable === false && (
          <p className="text-xs text-amber-300">{text.deviceGpuUnavailable}</p>
        )}
        <Field error={fieldErrors.inputSize} errorId="model-width-error" label={text.inputWidthOverride}>
          <input
            aria-describedby={fieldErrors.inputSize ? "model-width-error" : undefined}
            aria-invalid={Boolean(fieldErrors.inputSize) || undefined}
            className={inputClass}
            min="1"
            placeholder={model.inputWidth ? String(model.inputWidth) : text.dynamicDimension}
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
        <Field error={fieldErrors.inputSize} errorId="model-height-error" label={text.inputHeightOverride}>
          <input
            aria-describedby={fieldErrors.inputSize ? "model-height-error" : undefined}
            aria-invalid={Boolean(fieldErrors.inputSize) || undefined}
            className={inputClass}
            min="1"
            placeholder={model.inputHeight ? String(model.inputHeight) : text.dynamicDimension}
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
      </fieldset>
      <h4 className="mt-5 text-sm font-medium text-slate-200">{text.classNames}</h4>
      <fieldset
        disabled={disabled}
        className="mt-2 grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2"
      >
        {model.classNames.map((name, index) => (
          <label className="grid grid-cols-[3rem_1fr] items-center gap-2" key={index}>
            <span className="text-right text-xs text-slate-500">{index}</span>
            <input
              aria-describedby={fieldErrors.classNames ? "model-classnames-error" : undefined}
              aria-invalid={Boolean(fieldErrors.classNames) || undefined}
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
      </fieldset>
      {fieldErrors.classNames && (
        <p id="model-classnames-error" className="mt-1 text-xs text-red-300">
          {fieldErrors.classNames}
        </p>
      )}
      {mode === "edit" && update && (
        <div className="mt-5 rounded border border-slate-700 bg-slate-950/60 p-3">
          <Field error={fieldErrors.sourceUrl} errorId="model-source-url-error" label={text.sourceUrl}>
            <div className="flex gap-2">
              <input
                aria-describedby={fieldErrors.sourceUrl ? "model-source-url-error" : undefined}
                aria-invalid={Boolean(fieldErrors.sourceUrl) || undefined}
                className={inputClass}
                placeholder={text.sourceUrlPlaceholder}
                disabled={disabled}
                value={sourceUrl}
                onChange={(event) =>
                  onChange({ ...model, sourceUrl: event.target.value || undefined })
                }
              />
              <button
                className="shrink-0 rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                disabled={disabled || invalid || !canUpdate || update.isUpdating}
                type="button"
                onClick={onUpdateFromUrl}
              >
                {update.isUpdating ? text.modelDownloading : text.updateModel}
              </button>
            </div>
          </Field>
          <p className="mt-1 text-xs text-slate-500">{text.sourceUrlHint}</p>
          {update.isUpdating && (
            <div className="mt-2 rounded border border-slate-700 bg-slate-900/60 p-3">
              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>
                  {text.modelDownloading}
                  {update.progress?.total != null &&
                    ` · ${text.runtimeDownloadBytes(update.progress.downloaded, update.progress.total)}`}
                </span>
                <button
                  className="rounded border border-slate-600 px-2 py-1 text-slate-200 hover:bg-slate-800"
                  type="button"
                  onClick={onCancelUpdate}
                >
                  {text.runtimeCancelDownload}
                </button>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
                <div
                  className={`h-full bg-emerald-500 transition-all ${
                    update.progress?.total ? "" : "progress-indeterminate w-1/2"
                  }`}
                  style={update.progress?.total ? { width: `${progressPercent}%` } : undefined}
                />
              </div>
            </div>
          )}
        </div>
      )}
      <div className="mt-5 flex flex-wrap justify-between gap-2 border-t border-slate-800 pt-4">
        <div>
          {onDelete && (
            <button
              className="rounded border border-red-500/50 px-3 py-2 text-sm text-red-300"
              type="button"
              disabled={disabled}
              onClick={onDelete}
            >
              {text.removeModel}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <button
            className="rounded border border-emerald-500/50 px-3 py-2 text-sm text-emerald-300 disabled:opacity-50"
            disabled={disabled || invalid}
            type="button"
            onClick={onValidate}
          >
            {text.validateModel}
          </button>
          <button
            className="rounded border border-slate-700 px-3 py-2 text-sm"
            type="button"
            disabled={disabled}
            onClick={onCancel}
          >
            {text.cancelChanges}
          </button>
          <button
            aria-describedby={invalid ? "model-submit-reason" : undefined}
            className="rounded bg-sky-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={disabled || invalid}
            type="submit"
          >
            {submitLabel}
          </button>
        </div>
        {invalid && !disabled && (
          <p id="model-submit-reason" className="w-full text-xs text-amber-300">
            {firstFieldError}
          </p>
        )}
      </div>
    </form>
  );
}

export function Field({
  error,
  errorId,
  label,
  children,
}: {
  error?: string;
  errorId?: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="text-xs text-slate-400">
      <span className="mb-1 block">{label}</span>
      {children}
      {error && errorId && (
        <span id={errorId} className="mt-1 block text-xs text-red-300">
          {error}
        </span>
      )}
    </label>
  );
}

export const inputClass =
  "w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500";
