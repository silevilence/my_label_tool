import type { AnnotationShape, AnnotationShapeType, LabelTemplate } from "./annotation";
import { PLUGIN_ZH_CN as text } from "../i18n/plugin.zh-CN";

/** Manifest structure version. Independent from host API and protocol versions. */
export const PLUGIN_MANIFEST_SCHEMA_VERSION = 1 as const;
export const PLUGIN_PROTOCOL_VERSION = 1 as const;
export const DEFAULT_PLUGIN_TIMEOUT_MS = 30_000;
export const MAX_PLUGIN_TIMEOUT_MS = 300_000;

export const PLUGIN_PROTOCOL_MESSAGE_TYPES = ["request", "response", "event", "control"] as const;
export const PLUGIN_PROTOCOL_ERROR_CODES = [
  "PARSE_ERROR",
  "PROTOCOL_ERROR",
  "METHOD_NOT_FOUND",
  "PERMISSION_DENIED",
  "TIMEOUT",
  "CANCELLED",
  "INTERNAL_ERROR",
  "CONFIG_MIGRATION_REQUIRED",
  "INVALID_ARGUMENT",
  "API_VERSION_UNSUPPORTED",
] as const;

export type PluginProtocolMessageType = (typeof PLUGIN_PROTOCOL_MESSAGE_TYPES)[number];
export type PluginProtocolErrorCode = (typeof PLUGIN_PROTOCOL_ERROR_CODES)[number];

export interface PluginProtocolError {
  code: PluginProtocolErrorCode;
  message: string;
  data?: unknown;
}

export interface PluginProtocolEnvelope {
  v: typeof PLUGIN_PROTOCOL_VERSION;
  id: string | null;
  type: PluginProtocolMessageType;
}

export interface PluginProtocolRequest extends PluginProtocolEnvelope {
  id: string;
  type: "request";
  method: string;
  params: unknown;
}

export interface PluginFsReadParams {
  path: string;
}

export interface PluginFsReadResult {
  contentUtf8: string;
}

export interface PluginFsWriteParams {
  path: string;
  contentUtf8: string;
}

export interface PluginFsWriteResult {
  writtenBytes: number;
}

export type PluginHostMethod = "fs.read" | "fs.write";
export type PluginCapabilityMethod = "config.migrate" | "exporter.export" | "prelabel.run";

export type PluginHostRequest =
  | (PluginProtocolEnvelope & {
      id: string;
      type: "request";
      method: "fs.read";
      params: PluginFsReadParams;
    })
  | (PluginProtocolEnvelope & {
      id: string;
      type: "request";
      method: "fs.write";
      params: PluginFsWriteParams;
    });

export type PluginProtocolResponse =
  | (PluginProtocolEnvelope & {
      id: string;
      type: "response";
      result: unknown;
      error?: never;
    })
  | (PluginProtocolEnvelope & {
      id: string;
      type: "response";
      result?: never;
      error: PluginProtocolError;
    });

export interface PluginProgressPayload {
  percent?: number;
  [key: string]: unknown;
}

export type PluginProtocolEvent =
  | (PluginProtocolEnvelope & {
      id: string;
      type: "event";
      event: "progress";
      payload: PluginProgressPayload;
    })
  | (PluginProtocolEnvelope & {
      id: string;
      type: "event";
      event: "log";
      payload: Record<string, unknown>;
    });

export type PluginProtocolControl =
  | (PluginProtocolEnvelope & {
      id: string;
      type: "control";
      action: "cancel";
    })
  | (PluginProtocolEnvelope & {
      id: string | null;
      type: "control";
      action: "heartbeat";
    });

export type PluginProtocolMessage =
  | PluginProtocolRequest
  | PluginProtocolResponse
  | PluginProtocolEvent
  | PluginProtocolControl;

export interface PluginSupportedApiVersions {
  hostApi: number[];
  exporter?: number[];
  prelabel?: number[];
}

export interface PluginHelloParams {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  hostApiVersion: number;
  supportedVersions: PluginSupportedApiVersions;
}

export interface PluginHelloCapabilities {
  exporter?: boolean;
  prelabel?: boolean;
  batch?: boolean;
  progress?: boolean;
  cancel?: boolean;
  configMigration?: boolean;
}

export interface PluginHelloResult {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  capabilities?: PluginHelloCapabilities;
}

export interface PluginNegotiatedCapabilities {
  exporter: boolean;
  prelabel: boolean;
  batch: boolean;
  progress: boolean;
  cancel: boolean;
  configMigration: boolean;
}

export interface PluginNegotiatedSession {
  protocolVersion: typeof PLUGIN_PROTOCOL_VERSION;
  capabilities: PluginNegotiatedCapabilities;
}
export const MAX_PLUGIN_CONTRACT_VERSION = 4_294_967_295;

export const PLUGIN_MANIFEST_FIELDS = [
  "schemaVersion",
  "id",
  "name",
  "version",
  "apiVersion",
  "extensionKind",
  "runtime",
  "entry",
  "exporterOptions",
  "prelabelOptions",
  "capabilities",
  "permissions",
  "configVersion",
  "timeoutMs",
] as const satisfies readonly (keyof PluginManifest)[];

export type PluginExtensionKind = "label-preset" | "exporter" | "prelabel";
export type PluginRuntime = "process";
export type PluginPermission = `fs.read:${string}` | `fs.write:${string}` | "network";

/**
 * A target host API version. The host dispatches the matching implementation;
 * breaking changes receive a new version while old versions remain available
 * for the documented deprecation period.
 */
export interface PluginApiVersionTarget {
  min: number;
}

export interface PluginEntry {
  command: string;
  args: string[];
}

export interface PluginExporterFormat {
  id: string;
  displayName: string;
  extensions: string[];
  multiFile: boolean;
}

export interface PluginExporterOptions {
  formats: PluginExporterFormat[];
}

export interface PluginPrelabelOptions {
  classNames: string[];
}

export interface PluginCapabilityVersion {
  apiVersion: PluginApiVersionTarget;
}

export interface PluginCapabilities {
  annotationTypes: AnnotationShapeType[];
  batch: boolean;
  progress: boolean;
  cancel: boolean;
  configMigration: boolean;
  exporter: PluginCapabilityVersion;
  prelabel: PluginCapabilityVersion;
}

/**
 * Public plugin manifest contract. Plugin version, host API target versions and
 * the NDJSON protocol version are independent. The protocol version is
 * negotiated in hello and deliberately does not appear in this manifest.
 */
export interface PluginManifest {
  schemaVersion: typeof PLUGIN_MANIFEST_SCHEMA_VERSION;
  id: string;
  name: string;
  version: string;
  apiVersion: PluginApiVersionTarget;
  extensionKind: PluginExtensionKind;
  runtime?: PluginRuntime;
  entry?: PluginEntry;
  exporterOptions?: PluginExporterOptions;
  prelabelOptions?: PluginPrelabelOptions;
  capabilities: PluginCapabilities;
  permissions: PluginPermission[];
  configVersion: number;
  timeoutMs: number;
}

export type PluginState = "enabled" | "disabled" | "auto-disabled" | "pending-migration";

export interface PluginPermissionGrant {
  permission: string;
  target: string | null;
}

export interface PluginRegistryEntry {
  id: string;
  name: string;
  version: string;
  extensionKind: PluginExtensionKind;
  entry: PluginEntry | null;
  exporterOptions?: PluginExporterOptions;
  prelabelOptions?: PluginPrelabelOptions;
  capabilities: PluginCapabilities;
  grants: PluginPermissionGrant[];
  state: PluginState;
  failureCount: number;
  lastError: string | null;
  configVersion: number;
  timeoutMs: number;
  installedAt: string;
  updatedAt: string;
}

export interface PluginRegistrySnapshot {
  plugins: PluginRegistryEntry[];
  warning: string | null;
}

export interface PluginLabelPreset {
  pluginId: string;
  pluginName: string;
  template: LabelTemplate;
}

export interface PluginLabelPresetSnapshot {
  presets: PluginLabelPreset[];
  warning: string | null;
}

export interface PluginExportFormatDescriptor {
  selectionId: `plugin:${string}:${string}`;
  pluginId: string;
  pluginName: string;
  format: PluginExporterFormat;
  enabled: boolean;
  disabledReason: string | null;
  supportsProgress: boolean;
  supportsCancel: boolean;
}

export interface PluginExportFormatSnapshot {
  formats: PluginExportFormatDescriptor[];
  warning: string | null;
}

export interface PluginExportResult {
  files: string[];
}

export interface PluginExportEvent {
  event: "progress" | "log";
  payload: { percent?: number; message?: string; [key: string]: unknown };
}

export interface PluginExportCancellationResult {
  exportId: string;
  found: boolean;
}

export interface PluginPrelabelSourceDescriptor {
  selectionId: `plugin:${string}`;
  pluginId: string;
  pluginName: string;
  classNames: string[];
  annotationTypes: AnnotationShapeType[];
  enabled: boolean;
  disabledReason: string | null;
  supportsBatch: boolean;
  supportsProgress: boolean;
  supportsCancel: boolean;
}

export interface PluginPrelabelSourceSnapshot {
  sources: PluginPrelabelSourceDescriptor[];
  warning: string | null;
}

export interface PluginPrelabelClassMapping {
  modelClass: string;
  labelId: string;
  labelName: string;
}

export interface PluginPrelabelImageResult {
  imagePath: string;
  shapes: AnnotationShape[];
}

export interface PluginPrelabelResult {
  images: PluginPrelabelImageResult[];
  cancelled: boolean;
}

export interface PluginPrelabelEvent {
  event: "progress" | "log";
  payload: { percent?: number; message?: string; [key: string]: unknown };
}

export interface PluginPrelabelCancellationResult {
  operationId: string;
  found: boolean;
}

/** Project-scoped plugin config. The host persists `config` without interpreting it. */
export interface PluginConfig {
  pluginId: string;
  configVersion: number;
  config: unknown;
}

export interface PluginConfigMigrationParams {
  fromVersion: number;
  toVersion: number;
  config: unknown;
}

export interface PluginConfigMigrationResult {
  configVersion: number;
  config: unknown;
}

export interface PluginConfigMigrationIssue {
  pluginId: string;
  code: string;
  message: string;
}

export interface PluginConfigMigrationReport {
  configs: PluginConfig[];
  pendingPluginIds: string[];
  unavailablePluginIds: string[];
  issues: PluginConfigMigrationIssue[];
}

export interface PluginRuntimeSettings {
  safeMode: boolean;
}

export interface PluginInstallPreview {
  installToken: string;
  manifest: PluginManifest;
  permissions: PluginPermissionGrant[];
  warning: string | null;
  isUpdate: boolean;
}

type AssertNever<T extends never> = T;
export type PluginManifestFieldCoverage = AssertNever<
  Exclude<keyof PluginManifest, (typeof PLUGIN_MANIFEST_FIELDS)[number]>
>;

export type PluginManifestErrorCode =
  | "REQUIRED"
  | "INVALID_TYPE"
  | "INVALID_VALUE"
  | "INVALID_FORMAT"
  | "INVALID_VERSION"
  | "INVALID_PATH"
  | "FORBIDDEN"
  | "DUPLICATE"
  | "UNKNOWN_PERMISSION"
  | "UNSUPPORTED_RUNTIME"
  | "UNSUPPORTED_VERSION";

export interface PluginManifestError {
  field: string;
  code: PluginManifestErrorCode;
  reason: string;
}

export type PluginManifestParseResult =
  { ok: true; value: PluginManifest } | { ok: false; errors: PluginManifestError[] };

const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:\.[a-z0-9]+){1,}$/;
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const EXTENSION_KINDS: PluginExtensionKind[] = ["label-preset", "exporter", "prelabel"];
const ANNOTATION_TYPES: AnnotationShapeType[] = ["rect", "polygon", "point"];
const EXPORT_FORMAT_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const EXPORT_EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export function parsePluginManifest(input: unknown): PluginManifestParseResult {
  const errors: PluginManifestError[] = [];
  if (!isRecord(input)) {
    return failure("$", "INVALID_TYPE", text.manifestMustBeObject);
  }

  const schemaVersion = parseSchemaVersion(input.schemaVersion, errors);
  const id = parseNonEmptyString(input.id, "id", errors);
  if (id && !PLUGIN_ID_PATTERN.test(id)) {
    addError(errors, "id", "INVALID_FORMAT", text.pluginIdInvalid);
  }
  const name = parseNonEmptyString(input.name, "name", errors);
  const version = parseNonEmptyString(input.version, "version", errors);
  if (version && !SEMVER_PATTERN.test(version)) {
    addError(errors, "version", "INVALID_FORMAT", text.pluginVersionInvalid);
  }
  const apiVersion = parseApiVersion(input.apiVersion, "apiVersion", errors);
  const extensionKind = parseExtensionKind(input.extensionKind, errors);
  const runtime = parseRuntime(input.runtime, extensionKind, errors);
  const entry = parseEntry(input.entry, extensionKind, errors);
  const exporterOptions = parseExporterOptions(input.exporterOptions, extensionKind, errors);
  const prelabelOptions = parsePrelabelOptions(input.prelabelOptions, extensionKind, errors);
  const capabilities = parseCapabilities(input.capabilities, extensionKind, apiVersion, errors);
  const permissions = parsePermissions(input.permissions, errors);
  const configVersion = parseBoundedInteger(
    input.configVersion,
    "configVersion",
    0,
    MAX_PLUGIN_CONTRACT_VERSION,
    0,
    errors,
  );
  const timeoutMs = parseBoundedInteger(
    input.timeoutMs,
    "timeoutMs",
    1,
    MAX_PLUGIN_TIMEOUT_MS,
    DEFAULT_PLUGIN_TIMEOUT_MS,
    errors,
  );
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      schemaVersion: schemaVersion as 1,
      id: id as string,
      name: name as string,
      version: version as string,
      apiVersion: apiVersion as PluginApiVersionTarget,
      extensionKind: extensionKind as PluginExtensionKind,
      ...(runtime ? { runtime } : {}),
      ...(entry ? { entry } : {}),
      ...(exporterOptions ? { exporterOptions } : {}),
      ...(prelabelOptions ? { prelabelOptions } : {}),
      capabilities,
      permissions,
      configVersion,
      timeoutMs,
    },
  };
}

function parsePrelabelOptions(
  value: unknown,
  extensionKind: PluginExtensionKind | undefined,
  errors: PluginManifestError[],
): PluginPrelabelOptions | undefined {
  if (value === undefined) return undefined;
  if (extensionKind !== "prelabel") {
    addError(errors, "prelabelOptions", "FORBIDDEN", text.prelabelOptionsForbidden);
    return undefined;
  }
  if (!isRecord(value) || !Array.isArray(value.classNames)) {
    addError(
      errors,
      "prelabelOptions.classNames",
      "INVALID_VALUE",
      text.prelabelClassNamesInvalid,
    );
    return undefined;
  }
  const classNames = value.classNames.filter(
    (name): name is string => typeof name === "string" && name.trim().length > 0,
  );
  if (
    classNames.length === 0 ||
    classNames.length !== value.classNames.length ||
    new Set(classNames).size !== classNames.length
  ) {
    addError(
      errors,
      "prelabelOptions.classNames",
      "INVALID_VALUE",
      text.prelabelClassNamesInvalid,
    );
    return undefined;
  }
  return { classNames };
}

function parseExporterOptions(
  value: unknown,
  extensionKind: PluginExtensionKind | undefined,
  errors: PluginManifestError[],
): PluginExporterOptions | undefined {
  if (value === undefined) return undefined;
  if (extensionKind !== "exporter") {
    addError(errors, "exporterOptions", "FORBIDDEN", text.exporterOptionsForbidden);
    return undefined;
  }
  if (!isRecord(value) || !Array.isArray(value.formats) || value.formats.length === 0) {
    addError(errors, "exporterOptions.formats", "INVALID_VALUE", text.exporterFormatsRequired);
    return undefined;
  }
  const seen = new Set<string>();
  const formats = value.formats.flatMap((item, index): PluginExporterFormat[] => {
    const field = `exporterOptions.formats[${index}]`;
    if (!isRecord(item)) {
      addError(errors, field, "INVALID_TYPE", text.exporterFormatInvalid);
      return [];
    }
    const id = parseNonEmptyString(item.id, `${field}.id`, errors);
    const displayName = parseNonEmptyString(item.displayName, `${field}.displayName`, errors);
    const extensions = parseStringArray(item.extensions, `${field}.extensions`, [], errors);
    const multiFile = parseRequiredBoolean(item.multiFile, `${field}.multiFile`, errors);
    if (id && (!EXPORT_FORMAT_ID_PATTERN.test(id) || seen.has(id))) {
      addError(errors, `${field}.id`, "INVALID_FORMAT", text.exporterFormatIdInvalid);
    }
    if (id) seen.add(id);
    if (
      extensions.length === 0 ||
      new Set(extensions).size !== extensions.length ||
      extensions.some((extension) => !EXPORT_EXTENSION_PATTERN.test(extension))
    ) {
      addError(errors, `${field}.extensions`, "INVALID_FORMAT", text.exporterExtensionsInvalid);
    }
    return id && displayName && multiFile !== undefined
      ? [{ id, displayName, extensions, multiFile }]
      : [];
  });
  return formats.length > 0 ? { formats } : undefined;
}

function parseRequiredBoolean(
  value: unknown,
  field: string,
  errors: PluginManifestError[],
): boolean | undefined {
  if (typeof value !== "boolean") {
    addError(errors, field, value === undefined ? "REQUIRED" : "INVALID_TYPE", text.fieldMustBeBoolean(field));
    return undefined;
  }
  return value;
}

export function isValidPluginId(value: string): boolean {
  return PLUGIN_ID_PATTERN.test(value);
}

function parseSchemaVersion(value: unknown, errors: PluginManifestError[]): number | undefined {
  if (value === undefined) {
    addError(errors, "schemaVersion", "REQUIRED", text.schemaVersionRequired);
    return undefined;
  }
  if (value !== PLUGIN_MANIFEST_SCHEMA_VERSION) {
    addError(errors, "schemaVersion", "UNSUPPORTED_VERSION", text.schemaVersionUnsupported);
    return undefined;
  }
  return value;
}

function parseExtensionKind(
  value: unknown,
  errors: PluginManifestError[],
): PluginExtensionKind | undefined {
  if (value === undefined) {
    addError(errors, "extensionKind", "REQUIRED", text.extensionKindRequired);
    return undefined;
  }
  if (typeof value !== "string" || !EXTENSION_KINDS.includes(value as PluginExtensionKind)) {
    addError(errors, "extensionKind", "INVALID_VALUE", text.extensionKindUnsupported);
    return undefined;
  }
  return value as PluginExtensionKind;
}

function parseRuntime(
  value: unknown,
  extensionKind: PluginExtensionKind | undefined,
  errors: PluginManifestError[],
): PluginRuntime | undefined {
  if (extensionKind === "label-preset") {
    if (value !== undefined)
      addError(errors, "runtime", "FORBIDDEN", text.dataPluginRuntimeForbidden);
    return undefined;
  }
  if (value === undefined) {
    if (extensionKind) addError(errors, "runtime", "REQUIRED", text.codePluginRuntimeRequired);
    return undefined;
  }
  if (value !== "process") {
    addError(errors, "runtime", "UNSUPPORTED_RUNTIME", text.runtimeUnsupported);
    return undefined;
  }
  return value;
}

function parseEntry(
  value: unknown,
  extensionKind: PluginExtensionKind | undefined,
  errors: PluginManifestError[],
): PluginEntry | undefined {
  if (extensionKind === "label-preset") {
    if (value !== undefined) addError(errors, "entry", "FORBIDDEN", text.dataPluginEntryForbidden);
    return undefined;
  }
  if (value === undefined) {
    if (extensionKind) addError(errors, "entry", "REQUIRED", text.codePluginEntryRequired);
    return undefined;
  }
  if (!isRecord(value)) {
    addError(errors, "entry", "INVALID_TYPE", text.entryMustBeObject);
    return undefined;
  }
  const command = parseNonEmptyString(value.command, "entry.command", errors);
  if (command && !isSafeRelativePath(command)) {
    addError(errors, "entry.command", "INVALID_PATH", text.entryPathInvalid);
  }
  const args = parseStringArray(value.args, "entry.args", [], errors);
  return command && isSafeRelativePath(command) ? { command, args } : undefined;
}

function parseCapabilities(
  value: unknown,
  extensionKind: PluginExtensionKind | undefined,
  overallApiVersion: PluginApiVersionTarget | undefined,
  errors: PluginManifestError[],
): PluginCapabilities {
  const source = value === undefined ? {} : value;
  if (!isRecord(source)) {
    addError(errors, "capabilities", "INVALID_TYPE", text.capabilitiesMustBeObject);
  }
  const record = isRecord(source) ? source : {};
  const annotationTypes = parseAnnotationTypes(record.annotationTypes, errors);
  if (extensionKind === "prelabel" && annotationTypes.length === 0) {
    addError(
      errors,
      "capabilities.annotationTypes",
      "REQUIRED",
      text.prelabelAnnotationTypesRequired,
    );
  }
  const fallback = overallApiVersion ?? { min: 1 };
  return {
    annotationTypes,
    batch: parseBoolean(record.batch, "capabilities.batch", errors),
    progress: parseBoolean(record.progress, "capabilities.progress", errors),
    cancel: parseBoolean(record.cancel, "capabilities.cancel", errors),
    configMigration: parseBoolean(record.configMigration, "capabilities.configMigration", errors),
    exporter: {
      apiVersion:
        parseCapabilityApiVersion(record.exporter, "capabilities.exporter", errors) ?? fallback,
    },
    prelabel: {
      apiVersion:
        parseCapabilityApiVersion(record.prelabel, "capabilities.prelabel", errors) ?? fallback,
    },
  };
}

function parseCapabilityApiVersion(
  value: unknown,
  field: string,
  errors: PluginManifestError[],
): PluginApiVersionTarget | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    addError(errors, field, "INVALID_TYPE", text.capabilityVersionMustBeObject);
    return undefined;
  }
  return parseApiVersion(value.apiVersion, `${field}.apiVersion`, errors);
}

function parseApiVersion(
  value: unknown,
  field: string,
  errors: PluginManifestError[],
): PluginApiVersionTarget | undefined {
  if (value === undefined) {
    addError(errors, field, "REQUIRED", text.apiVersionRequired);
    return undefined;
  }
  if (!isRecord(value)) {
    addError(errors, field, "INVALID_TYPE", text.apiVersionMustBeObject);
    return undefined;
  }
  Object.keys(value)
    .filter((key) => key !== "min")
    .forEach((key) => addError(errors, `${field}.${key}`, "FORBIDDEN", text.apiVersionOnlyMin));
  if (
    !Number.isSafeInteger(value.min) ||
    Number(value.min) < 1 ||
    Number(value.min) > MAX_PLUGIN_CONTRACT_VERSION
  ) {
    addError(errors, `${field}.min`, "INVALID_VERSION", text.apiVersionInvalid);
    return undefined;
  }
  return { min: Number(value.min) };
}

function parseAnnotationTypes(
  value: unknown,
  errors: PluginManifestError[],
): AnnotationShapeType[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addError(
      errors,
      "capabilities.annotationTypes",
      "INVALID_TYPE",
      text.annotationTypesMustBeArray,
    );
    return [];
  }
  const result: AnnotationShapeType[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string" || !ANNOTATION_TYPES.includes(item as AnnotationShapeType)) {
      addError(
        errors,
        `capabilities.annotationTypes[${index}]`,
        "INVALID_VALUE",
        text.annotationTypeUnsupported,
      );
    } else if (result.includes(item as AnnotationShapeType)) {
      addError(
        errors,
        `capabilities.annotationTypes[${index}]`,
        "DUPLICATE",
        text.annotationTypeDuplicate,
      );
    } else {
      result.push(item as AnnotationShapeType);
    }
  });
  return result;
}

function parsePermissions(value: unknown, errors: PluginManifestError[]): PluginPermission[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    addError(errors, "permissions", "INVALID_TYPE", text.permissionsMustBeArray);
    return [];
  }
  const result: PluginPermission[] = [];
  const seen = new Set<string>();
  value.forEach((item, index) => {
    const field = `permissions[${index}]`;
    if (typeof item !== "string" || !isKnownPermission(item)) {
      addError(errors, field, "UNKNOWN_PERMISSION", text.permissionUnknown);
      return;
    }
    const normalized = item.replace(/\\/g, "/") as PluginPermission;
    if (seen.has(normalized)) {
      addError(errors, field, "DUPLICATE", text.permissionDuplicate);
    } else {
      seen.add(normalized);
      result.push(normalized);
    }
  });
  return result;
}

function isKnownPermission(value: string): value is PluginPermission {
  if (value === "network") return true;
  const match = /^(fs\.read|fs\.write):(.+)$/.exec(value);
  if (!match) return false;
  const segments = match[2].replace(/\\/g, "/").split("/");
  return (
    ["%PROJECT%", "%MODELS%", "%APP_DATA%"].includes(segments[0]) &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    !value.includes("\0")
  );
}

function parseNonEmptyString(
  value: unknown,
  field: string,
  errors: PluginManifestError[],
): string | undefined {
  if (value === undefined) {
    addError(errors, field, "REQUIRED", text.requiredField(field));
    return undefined;
  }
  if (typeof value !== "string") {
    addError(errors, field, "INVALID_TYPE", text.fieldMustBeString(field));
    return undefined;
  }
  if (value.trim() === "") {
    addError(errors, field, "INVALID_VALUE", text.fieldMustNotBeEmpty(field));
    return undefined;
  }
  return value;
}

function parseStringArray(
  value: unknown,
  field: string,
  fallback: string[],
  errors: PluginManifestError[],
): string[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) {
    addError(errors, field, "INVALID_TYPE", text.fieldMustBeStringArray(field));
    return fallback;
  }
  const result: string[] = [];
  value.forEach((item, index) => {
    if (typeof item !== "string") {
      addError(errors, `${field}[${index}]`, "INVALID_TYPE", text.commandArgumentMustBeString);
    } else {
      result.push(item);
    }
  });
  return result;
}

function parseBoolean(value: unknown, field: string, errors: PluginManifestError[]): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    addError(errors, field, "INVALID_TYPE", text.fieldMustBeBoolean(field));
    return false;
  }
  return value;
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
  fallback: number,
  errors: PluginManifestError[],
): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    addError(
      errors,
      field,
      "INVALID_VALUE",
      text.fieldMustBeBoundedInteger(field, minimum, maximum),
    );
    return fallback;
  }
  return Number(value);
}

function isSafeRelativePath(value: string): boolean {
  if (/^(?:[a-zA-Z]:|[\\/])/.test(value)) return false;
  const segments = value.replace(/\\/g, "/").split("/");
  return segments.every((segment) => segment !== ".." && segment !== "" && segment !== ".");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  field: string,
  code: PluginManifestErrorCode,
  reason: string,
): PluginManifestParseResult {
  return { ok: false, errors: [{ field, code, reason }] };
}

function addError(
  errors: PluginManifestError[],
  field: string,
  code: PluginManifestErrorCode,
  reason: string,
): void {
  errors.push({ field, code, reason });
}
