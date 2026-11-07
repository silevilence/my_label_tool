import type { AnnotationShape } from "../types/annotation";
import type {
  AutosaveSettings,
  RecoveryMetadata,
  RecoverySnapshot,
  RecoveryWrite,
} from "../types/recovery";
import { AUTOSAVE_MIN_SECONDS, AUTOSAVE_MAX_SECONDS } from "./defaults/autosave";
import { validateAnnotationCore } from "./annotation-validation";
import { parseNativeJsonImport, parseProjectConfig } from "./importers";
import { RECOVERY_TEXT as text } from "../i18n/recovery.zh-CN";

export function validAutosaveSettings(value: AutosaveSettings): boolean {
  return (
    ["off", "interval", "switch"].includes(value.mode) &&
    Number.isInteger(value.intervalSeconds) &&
    value.intervalSeconds >= AUTOSAVE_MIN_SECONDS &&
    value.intervalSeconds <= AUTOSAVE_MAX_SECONDS
  );
}
export function relativeImagePath(folder: string, path: string): string {
  const root = folder.replace(/\\/g, "/").replace(/\/$/, "") + "/";
  const normalized = path.replace(/\\/g, "/");
  if (!normalized.toLowerCase().startsWith(root.toLowerCase())) throw new Error(text.invalidCopy);
  const relative = normalized.slice(root.length);
  if (
    !relative ||
    relative.includes(":") ||
    relative.split("/").some((p) => !p || p === ".." || p === ".")
  )
    throw new Error(text.invalidCopy);
  return relative;
}
/** Recovery is strict: never silently drop malformed annotations as a format importer might. */
export function validateRecovery(value: RecoverySnapshot): RecoverySnapshot {
  try {
    if (
      !Number.isSafeInteger(value.revision) ||
      value.revision < 1 ||
      !value.metadata ||
      !value.annotations ||
      Array.isArray(value.annotations)
    )
      throw new Error();
    const metadata = value.metadata;
    if (
      !Array.isArray(metadata.labels) ||
      !metadata.labels.length ||
      metadata.labels.some(
        (label) =>
          !label ||
          typeof label.id !== "string" ||
          !label.id ||
          typeof label.name !== "string" ||
          !label.name ||
          typeof label.color !== "string" ||
          !["any", "rect", "polygon", "point"].includes(label.shapeType),
      ) ||
      new Set(metadata.labels.map((label) => label.id)).size !== metadata.labels.length
    )
      throw new Error();
    const labels = parseNativeJsonImport(
      JSON.stringify({ labels: metadata.labels, images: [] }),
    ).labels;
    if (
      typeof metadata.configPath !== "string" ||
      typeof metadata.selectedPath !== "string" ||
      typeof metadata.savedAt !== "string" ||
      !Number.isFinite(Date.parse(metadata.savedAt))
    )
      throw new Error();
    for (const [path, shapes] of Object.entries(value.annotations)) {
      relativeImagePath("/project", `/project/${path}`);
      if (!Array.isArray(shapes)) throw new Error();
      const ids = new Set<string>();
      for (const shape of shapes) {
        validateAnnotationCore(shape, labels, true);
        if (typeof shape.id !== "string" || !shape.id || ids.has(shape.id)) throw new Error();
        ids.add(shape.id);
        if (
          shape.frameIndex !== undefined &&
          (!Number.isSafeInteger(shape.frameIndex) || shape.frameIndex < 0)
        )
          throw new Error();
      }
    }
    return {
      ...value,
      metadata: {
        ...metadata,
        labels,
        projectConfig:
          metadata.projectConfig === null
            ? null
            : parseProjectConfig(JSON.stringify(metadata.projectConfig)),
      },
    };
  } catch {
    throw new Error(text.invalidCopy);
  }
}

export interface RecoveryContext {
  folder: string;
  metadata: Omit<RecoveryMetadata, "savedAt">;
  annotations: Record<string, AnnotationShape[]>;
}
export interface RecoveryStatus {
  saving: boolean;
  dirty: boolean;
  savedAt: string;
  error: string;
}
/** One queue owns snapshots, revision acknowledgement, retries and manual save barriers. */
export class RecoveryWriter {
  private revision = 0;
  private reset = true;
  private clock = 0;
  private metadataVersion = 0;
  private savedMetadataVersion = 0;
  private dirty = new Map<string, number>();
  private tail: Promise<unknown> = Promise.resolve();
  private queued: Promise<void> | null = null;
  private all = false;
  private requested = new Set<string>();
  private status: RecoveryStatus = { saving: false, dirty: false, savedAt: "", error: "" };
  constructor(
    private readonly context: () => RecoveryContext,
    private readonly write: (folder: string, update: RecoveryWrite) => Promise<number>,
    private readonly changed: (status: RecoveryStatus) => void,
  ) {}
  initialize(revision: number, recovered: boolean, savedAt = "") {
    this.revision = revision;
    this.reset = !recovered;
    this.dirty.clear();
    this.metadataVersion = this.savedMetadataVersion = ++this.clock;
    this.emit({ saving: false, dirty: false, savedAt, error: "" });
  }
  mark(paths: readonly string[]) {
    for (const path of paths) this.dirty.set(path, ++this.clock);
    if (paths.length) this.emit({ dirty: true });
  }
  markMetadata() {
    this.metadataVersion = ++this.clock;
    this.emit({ dirty: true });
  }
  get hasChanges() {
    return this.dirty.size > 0 || this.metadataVersion !== this.savedMetadataVersion;
  }
  get isSaving() {
    return this.status.saving || this.queued !== null;
  }
  async settle() {
    await this.tail;
  }
  async branch(write: (folder: string, update: RecoveryWrite) => Promise<number>) {
    return this.enqueue(async () => {
      this.reset = true;
      await this.flush(undefined, write);
    });
  }
  /** Manual exports share the queue and explicitly persist a recoverable working copy. */
  async manual<T>(action: () => Promise<T>, succeeded: (result: T) => boolean): Promise<T> {
    return this.enqueue(async () => {
      const result = await action();
      if (succeeded(result)) await this.flush();
      return result;
    });
  }
  save(paths?: readonly string[]): Promise<void> {
    if (paths) paths.forEach((path) => this.requested.add(path));
    else this.all = true;
    if (this.queued) return this.queued;
    const pending = this.enqueue(async () => {
      while (this.all || this.requested.size) {
        const all = this.all;
        const paths = this.requested;
        this.all = false;
        this.requested = new Set();
        await this.flush(all ? undefined : paths);
      }
    });
    this.queued = pending;
    void pending.then(
      () => {
        this.queued = null;
      },
      () => {
        this.queued = null;
        this.all = false;
        this.requested.clear();
      },
    );
    return pending;
  }
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => {});
    return result;
  }
  private async flush(paths?: Set<string>, write = this.write) {
    const context = this.context();
    if (!context.folder) return;
    const metadataChanged = this.metadataVersion !== this.savedMetadataVersion;
    const versions = new Map(
      [...this.dirty].filter(([path]) => !paths || paths.has(path) || metadataChanged),
    );
    if (!this.reset && !versions.size && !metadataChanged) return;
    // The initial baseline is the sole full snapshot. Subsequent writes visit only dirty paths.
    const selected = this.reset ? Object.keys(context.annotations) : [...versions.keys()];
    const changes: RecoveryWrite["changes"] = Object.fromEntries(
      selected.map((path) => [
        relativeImagePath(context.folder, path),
        context.annotations[path] ?? null,
      ]),
    );
    const metadataVersion = this.metadataVersion;
    const savedAt = new Date().toISOString();
    const update: RecoveryWrite = {
      expectedRevision: this.revision,
      reset: this.reset,
      metadata: { ...context.metadata, savedAt },
      changes,
    };
    this.emit({ saving: true, error: "" });
    try {
      this.revision = await write(context.folder, update);
      this.reset = false;
      this.acknowledge(versions, metadataVersion);
      this.emit({ saving: false, savedAt });
    } catch (error) {
      this.emit({ saving: false, error: String(error), dirty: true });
      throw error;
    }
  }
  private acknowledge(versions: Map<string, number>, metadataVersion: number) {
    versions.forEach((version, path) => {
      if (this.dirty.get(path) === version) this.dirty.delete(path);
    });
    if (this.metadataVersion === metadataVersion) this.savedMetadataVersion = metadataVersion;
    this.emit({ dirty: this.hasChanges });
  }
  private emit(patch: Partial<RecoveryStatus>) {
    this.status = { ...this.status, ...patch };
    this.changed(this.status);
  }
}
