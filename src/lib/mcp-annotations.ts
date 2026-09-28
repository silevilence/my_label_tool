import { useAnnotationStore } from "../store/useAnnotationStore";
import { withMcpMutation } from "../store/useOperations";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import { validateAnnotationCore } from "./annotation-validation";
import { McpError } from "./mcp-control";
import { MCP_ZH_CN as text } from "../i18n/mcp.zh-CN";

interface Change {
  imageId: string;
  operation: "add" | "update" | "delete";
  annotation?: AnnotationShape;
  annotationId?: string;
}
/** Ephemeral project-scoped IDs deliberately cannot be interpreted as filesystem paths. */
export class McpAnnotations {
  private ids = new Map<string, string>();
  private paths = new Map<string, string>();
  private source: ReturnType<typeof useAnnotationStore.getState>["images"] | null = null;
  reset() {
    this.ids.clear(); this.paths.clear(); this.source = null;
  }
  private refresh() {
    const images = useAnnotationStore.getState().images;
    if (images === this.source) return;
    const paths = new Set(images.map(image => image.path));
    for (const [path, id] of this.ids) if (!paths.has(path)) { this.ids.delete(path); this.paths.delete(id); }
    for (const image of images) if (!this.ids.has(image.path)) {
      const id = crypto.randomUUID(); this.ids.set(image.path, id); this.paths.set(id, image.path);
    }
    this.source = images;
  }
  images() {
    this.refresh();
    const state = useAnnotationStore.getState();
    return state.images.map((image) => {
      const id = this.ids.get(image.path)!;
      return {
        id,
        name: image.name,
        frameIndex: state.frameIndices[image.path] ?? 0,
        annotationCount: state.annotationsByImage[image.path]?.length ?? 0,
        selected: image.path === state.selectedPath,
      };
    });
  }
  path(imageId: unknown): string {
    this.refresh();
    const path = typeof imageId === "string" ? this.paths.get(imageId) : undefined;
    if (path) return path;
    throw new McpError("NOT_FOUND", text.invalidImage);
  }
  read(imageId: unknown) {
    const path = this.path(imageId);
    const state = useAnnotationStore.getState();
    return clone(state.annotationsByImage[path] ?? []).map((shape) => ({
      ...shape,
      frameIndex: state.frameIndices[path] ?? 0,
    }));
  }
  apply(changes: Change[], labels: readonly LabelConfig[]) {
    const state = useAnnotationStore.getState();
    const prepared = new Map<string, AnnotationShape[]>();
    for (const change of changes) {
      const path = this.path(change.imageId);
      const shapes = prepared.get(path) ?? clone(state.annotationsByImage[path] ?? []);
      prepared.set(path, shapes);
      if (change.operation === "delete") {
        if (!change.annotationId || change.annotation) throw new McpError("INVALID_ARGUMENT");
        const index = shapes.findIndex((shape) => shape.id === change.annotationId);
        if (index < 0) throw new McpError("NOT_FOUND", text.invalidAnnotationId);
        shapes.splice(index, 1);
        continue;
      }
      const shape = change.annotation;
      if (!shape || !shape.id.trim()) throw new McpError("INVALID_ARGUMENT");
      try {
        validateAnnotationCore(shape, labels, true);
      } catch (error) {
        throw new McpError("INVALID_ARGUMENT", String(error));
      }
      if (change.annotationId && change.annotationId !== shape.id)
        throw new McpError("INVALID_ARGUMENT");
      const index = shapes.findIndex((current) => current.id === shape.id);
      if (change.operation === "add") {
        if (index >= 0) throw new McpError("CONFLICT", text.duplicateAnnotationId);
        shapes.push({ ...shape, frameIndex: state.frameIndices[path] ?? 0 });
      } else {
        if (index < 0) throw new McpError("NOT_FOUND", text.invalidAnnotationId);
        shapes[index] = { ...shape, frameIndex: state.frameIndices[path] ?? 0 };
      }
    }
    const transactionId = crypto.randomUUID();
    withMcpMutation(() =>
      useAnnotationStore.getState().applyScriptTransaction(
        [...prepared].map(([imagePath, annotations]) => ({ imagePath, annotations })),
        transactionId,
      ),
    );
    return { transactionId, changedImages: prepared.size };
  }
}
function clone(shapes: AnnotationShape[]): AnnotationShape[] {
  return shapes.map((shape) => ({
    ...shape,
    points: [...shape.points],
    ...(shape.attributes ? { attributes: { ...shape.attributes } } : {}),
  }));
}
