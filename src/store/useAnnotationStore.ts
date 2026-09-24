import { validateAnnotationCore } from "../lib/annotation-validation";
import type { ImageFile } from "../lib/tauri-api";
import { create } from "zustand";
import { annotationShapesEqual } from "../lib/annotation-utils";
import type { AnnotationShape } from "../types/annotation";

export type Scope =
  { kind: "project" } | { kind: "search" | "video"; ids: string[]; label: string };

export function scopePaths(state: { images: ImageFile[]; scopeStack: Scope[] }): string[] {
  const scope = state.scopeStack[state.scopeStack.length - 1];
  return scope.kind === "project" ? state.images.map((image) => image.path) : scope.ids;
}

interface AnnotationState {
  images: ImageFile[];
  selectedPath: string;
  scopeStack: Scope[];
  setImages: (images: ImageFile[]) => void;
  select: (path: string) => void;
  pushScope: (scope: Exclude<Scope, { kind: "project" }>) => void;
  popScope: () => void;
  selectAdjacent: (delta: number) => void;
  selectUnannotated: (delta: 1 | -1) => void;
  frameIndices: Record<string, number>;
  setFrameIndices: (indices: Record<string, number>) => void;
  annotationsByImage: Record<string, AnnotationShape[]>;
  selectedShapeId: string | null;
  undoStack: AnnotationHistoryEntry[];
  redoStack: AnnotationHistoryEntry[];
  canUndo: boolean;
  canRedo: boolean;
  addAnnotation: (imagePath: string, annotation: AnnotationShape) => void;
  updateAnnotation: (
    imagePath: string,
    annotationId: string,
    patch: Partial<AnnotationShape>,
  ) => void;
  deleteAnnotation: (imagePath: string, annotationId: string) => void;
  clearImageAnnotations: (imagePath: string) => void;
  removeImage: (imagePath: string) => void;
  removeImages: (imagePaths: string[]) => void;
  insertAnnotationsBatch: (
    entries: Array<{ imagePath: string; annotations: AnnotationShape[] }>,
    mode: "append" | "replace",
    groupId?: string,
  ) => void;
  undo: () => void;
  redo: () => void;
  replaceAnnotations: (annotationsByImage: Record<string, AnnotationShape[]>) => void;
  replaceLabel: (oldLabelId: string, nextLabelId: string) => void;
  selectShape: (annotationId: string | null) => void;
}

interface AnnotationHistoryEntry {
  imagePath: string;
  before: AnnotationShape[];
  after: AnnotationShape[];
  selectedBefore: string | null;
  selectedAfter: string | null;
  groupId?: string;
}

const HISTORY_LIMIT = 100;
let nextHistoryGroupId = 1;

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  images: [],
  selectedPath: "",
  scopeStack: [{ kind: "project" }],
  setImages: (images) =>
    set((state) => ({
      images,
      scopeStack: [{ kind: "project" }],
      selectedPath: images.some((image) => image.path === state.selectedPath)
        ? state.selectedPath
        : (images[0]?.path ?? ""),
      selectedShapeId: null,
    })),
  select: (path) =>
    set((state) => {
      if (!state.images.some((image) => image.path === path)) return state;
      const scopeStack = [...state.scopeStack];
      while (scopeStack.length > 1 && !scopePaths({ ...state, scopeStack }).includes(path))
        scopeStack.pop();
      return {
        selectedPath: path,
        scopeStack,
        selectedShapeId: path === state.selectedPath ? state.selectedShapeId : null,
      };
    }),
  pushScope: (scope) =>
    set((state) => {
      const paths = new Set(state.images.map((image) => image.path));
      const ids = [...new Set(scope.ids)].filter((id) => paths.has(id));
      const stack =
        state.scopeStack[state.scopeStack.length - 1]?.kind === scope.kind
          ? state.scopeStack.slice(0, -1)
          : state.scopeStack;
      const selectedPath = ids.includes(state.selectedPath) ? state.selectedPath : (ids[0] ?? "");
      return {
        scopeStack: [...stack, { ...scope, ids }],
        selectedPath,
        selectedShapeId: selectedPath === state.selectedPath ? state.selectedShapeId : null,
      };
    }),
  popScope: () =>
    set((state) => {
      if (state.scopeStack.length === 1) return state;
      const scopeStack = state.scopeStack.slice(0, -1);
      const ids = scopePaths({ ...state, scopeStack });
      const selectedPath = ids.includes(state.selectedPath) ? state.selectedPath : (ids[0] ?? "");
      return {
        scopeStack,
        selectedPath,
        selectedShapeId: selectedPath === state.selectedPath ? state.selectedShapeId : null,
      };
    }),
  selectAdjacent: (delta) => {
    const state = get();
    const ids = scopePaths(state);
    const index = ids.indexOf(state.selectedPath);
    const path =
      ids[
        Math.max(
          0,
          Math.min(ids.length - 1, index < 0 ? (delta < 0 ? ids.length - 1 : 0) : index + delta),
        )
      ];
    if (path) state.select(path);
  },
  selectUnannotated: (delta) => {
    const state = get();
    const ids = scopePaths(state);
    const current = ids.indexOf(state.selectedPath);
    for (
      let i = current < 0 ? (delta > 0 ? 0 : ids.length - 1) : current + delta;
      i >= 0 && i < ids.length;
      i += delta
    ) {
      if (!state.annotationsByImage[ids[i]]?.length) {
        state.select(ids[i]);
        break;
      }
    }
  },
  frameIndices: {},
  setFrameIndices: (frameIndices) =>
    set((state) => ({
      frameIndices,
      annotationsByImage: Object.fromEntries(
        Object.entries(state.annotationsByImage).map(([path, annotations]) => [
          path,
          bindFrame(annotations, frameIndices[path]),
        ]),
      ),
    })),
  annotationsByImage: {},
  selectedShapeId: null,
  undoStack: [],
  redoStack: [],
  canUndo: false,
  canRedo: false,
  addAnnotation: (imagePath, annotation) =>
    set((state) =>
      applyImageHistory(
        state,
        imagePath,
        [...(state.annotationsByImage[imagePath] ?? []), annotation],
        null,
      ),
    ),
  updateAnnotation: (imagePath, annotationId, patch) =>
    set((state) => {
      const before = state.annotationsByImage[imagePath] ?? [];
      const after = before.map((annotation) => {
        if (annotation.id !== annotationId) return annotation;
        const updated = { ...annotation, ...patch };
        if (
          annotation.attributes?.videoInterpolated === true &&
          (patch.points !== undefined || patch.labelId !== undefined)
        ) {
          updated.attributes = {
            ...updated.attributes,
            videoKeyframe: true,
            videoInterpolated: false,
          };
        }
        return updated;
      });
      return applyImageHistory(state, imagePath, after, state.selectedShapeId);
    }),
  deleteAnnotation: (imagePath, annotationId) =>
    set((state) =>
      applyImageHistory(
        state,
        imagePath,
        (state.annotationsByImage[imagePath] ?? []).filter(
          (annotation) => annotation.id !== annotationId,
        ),
        state.selectedShapeId === annotationId ? null : state.selectedShapeId,
      ),
    ),
  clearImageAnnotations: (imagePath) =>
    set((state) => applyImageHistory(state, imagePath, [], null)),
  removeImage: (imagePath) => get().removeImages([imagePath]),
  removeImages: (imagePaths) =>
    set((state) => {
      const removedPaths = new Set(imagePaths);
      const removedIds = new Set(
        imagePaths.flatMap((path) => (state.annotationsByImage[path] ?? []).map((item) => item.id)),
      );
      for (const entry of [...state.undoStack, ...state.redoStack]) {
        if (removedPaths.has(entry.imagePath)) {
          for (const item of [...entry.before, ...entry.after]) removedIds.add(item.id);
        }
      }
      const annotationsByImage = { ...state.annotationsByImage };
      for (const path of removedPaths) delete annotationsByImage[path];
      const prune = (entries: AnnotationHistoryEntry[]) =>
        entries
          .filter((entry) => !removedPaths.has(entry.imagePath))
          .map((entry) => ({
            ...entry,
            selectedBefore:
              entry.selectedBefore && removedIds.has(entry.selectedBefore)
                ? null
                : entry.selectedBefore,
            selectedAfter:
              entry.selectedAfter && removedIds.has(entry.selectedAfter)
                ? null
                : entry.selectedAfter,
          }));
      const images = state.images.filter((image) => !removedPaths.has(image.path));
      const scopeStack = state.scopeStack.map((scope): Scope =>
        scope.kind === "project"
          ? scope
          : {
              ...scope,
              ids: scope.ids.filter((path) => !removedPaths.has(path)),
            },
      );
      while (scopeStack.length > 1 && scopePaths({ images, scopeStack }).length === 0)
        scopeStack.pop();
      const ids = scopePaths({ images, scopeStack });
      const oldIndex = scopePaths(state).indexOf(state.selectedPath);
      const selectedPath = ids.includes(state.selectedPath)
        ? state.selectedPath
        : (ids[Math.max(0, Math.min(oldIndex, ids.length - 1))] ?? "");
      const frameIndices = Object.fromEntries(
        Object.entries(state.frameIndices).filter(([path]) => !removedPaths.has(path)),
      );
      return withHistoryFlags({
        ...state,
        images,
        scopeStack,
        selectedPath,
        frameIndices,
        annotationsByImage,
        selectedShapeId:
          selectedPath !== state.selectedPath ||
          (state.selectedShapeId && removedIds.has(state.selectedShapeId))
            ? null
            : state.selectedShapeId,
        undoStack: prune(state.undoStack),
        redoStack: prune(state.redoStack),
      });
    }),
  insertAnnotationsBatch: (entries, mode, requestedGroupId) => {
    const groupId = requestedGroupId ?? `store-${nextHistoryGroupId}`;
    if (requestedGroupId === undefined) {
      nextHistoryGroupId += 1;
    }
    set((state) => {
      const annotationsByImage = { ...state.annotationsByImage };
      let selectedShapeId = state.selectedShapeId;
      const history: AnnotationHistoryEntry[] = [];
      for (const entry of entries) {
        const before = annotationsByImage[entry.imagePath] ?? [];
        const after = bindFrame(
          mode === "append" ? [...before, ...entry.annotations] : entry.annotations,
          state.frameIndices[entry.imagePath],
        );
        if (annotationShapesEqual(before, after)) continue;
        const selectedAfter =
          selectedShapeId &&
          before.some((annotation) => annotation.id === selectedShapeId) &&
          !after.some((annotation) => annotation.id === selectedShapeId)
            ? null
            : selectedShapeId;
        history.push({
          imagePath: entry.imagePath,
          before: cloneAnnotations(before),
          after: cloneAnnotations(after),
          selectedBefore: selectedShapeId,
          selectedAfter,
          groupId,
        });
        annotationsByImage[entry.imagePath] = cloneAnnotations(after);
        selectedShapeId = selectedAfter;
      }
      if (history.length === 0) return state;
      return withHistoryFlags({
        ...state,
        annotationsByImage,
        selectedShapeId,
        undoStack: trimHistory([...state.undoStack, ...history]),
        redoStack: [],
      });
    });
  },
  undo: () =>
    set((state) => {
      const entry = state.undoStack[state.undoStack.length - 1];
      if (!entry) {
        return state;
      }

      const undoStack = state.undoStack.slice(0, -1);
      const redoStack = [...state.redoStack, entry];
      return withHistoryFlags({
        ...state,
        annotationsByImage: {
          ...state.annotationsByImage,
          [entry.imagePath]: cloneAnnotations(
            bindFrame(entry.before, state.frameIndices[entry.imagePath]),
          ),
        },
        selectedShapeId: entry.selectedBefore,
        undoStack,
        redoStack,
      });
    }),
  redo: () =>
    set((state) => {
      const entry = state.redoStack[state.redoStack.length - 1];
      if (!entry) {
        return state;
      }

      const undoStack = trimHistory([...state.undoStack, entry]);
      const redoStack = state.redoStack.slice(0, -1);
      return withHistoryFlags({
        ...state,
        annotationsByImage: {
          ...state.annotationsByImage,
          [entry.imagePath]: cloneAnnotations(
            bindFrame(entry.after, state.frameIndices[entry.imagePath]),
          ),
        },
        selectedShapeId: entry.selectedAfter,
        undoStack,
        redoStack,
      });
    }),
  replaceAnnotations: (annotationsByImage) =>
    set((state) =>
      withHistoryFlags({
        ...state,
        annotationsByImage: Object.fromEntries(
          Object.entries(annotationsByImage).map(([path, annotations]) => [
            path,
            bindFrame(annotations, state.frameIndices[path]),
          ]),
        ),
        selectedShapeId: null,
        undoStack: [],
        redoStack: [],
      }),
    ),
  replaceLabel: (oldLabelId, nextLabelId) =>
    set((state) => ({
      annotationsByImage: Object.fromEntries(
        Object.entries(state.annotationsByImage).map(([imagePath, annotations]) => [
          imagePath,
          annotations.map((annotation) =>
            annotation.labelId === oldLabelId
              ? { ...annotation, labelId: nextLabelId }
              : annotation,
          ),
        ]),
      ),
    })),
  selectShape: (annotationId) => set({ selectedShapeId: annotationId }),
}));

function applyImageHistory(
  state: AnnotationState,
  imagePath: string,
  annotations: AnnotationShape[],
  selectedAfter: string | null,
  groupId?: string,
): AnnotationState {
  annotations.forEach((annotation) => validateAnnotationCore(annotation));
  const after = bindFrame(annotations, state.frameIndices[imagePath]);
  const before = state.annotationsByImage[imagePath] ?? [];
  if (annotationShapesEqual(before, after)) {
    return state;
  }

  const entry: AnnotationHistoryEntry = {
    imagePath,
    before: cloneAnnotations(before),
    after: cloneAnnotations(after),
    selectedBefore: state.selectedShapeId,
    selectedAfter,
    groupId,
  };

  return withHistoryFlags({
    ...state,
    annotationsByImage: {
      ...state.annotationsByImage,
      [imagePath]: cloneAnnotations(after),
    },
    selectedShapeId: selectedAfter,
    undoStack: trimHistory([...state.undoStack, entry]),
    redoStack: [],
  });
}

function trimHistory(entries: AnnotationHistoryEntry[]): AnnotationHistoryEntry[] {
  if (entries.length <= HISTORY_LIMIT) {
    return entries;
  }
  let start = entries.length - HISTORY_LIMIT;
  const boundaryGroupId = entries[start].groupId;
  if (boundaryGroupId !== undefined) {
    while (start > 0 && entries[start - 1].groupId === boundaryGroupId) {
      start -= 1;
    }
  }
  return entries.slice(start);
}

function withHistoryFlags(state: Omit<AnnotationState, "canUndo" | "canRedo">): AnnotationState {
  return {
    ...state,
    canUndo: state.undoStack.length > 0,
    canRedo: state.redoStack.length > 0,
  };
}

function cloneAnnotations(annotations: AnnotationShape[]): AnnotationShape[] {
  return annotations.map((annotation) => ({
    ...annotation,
    points: [...annotation.points],
    attributes: annotation.attributes ? { ...annotation.attributes } : undefined,
  }));
}

function bindFrame(
  annotations: AnnotationShape[],
  frameIndex: number | undefined,
): AnnotationShape[] {
  return frameIndex === undefined
    ? annotations
    : annotations.map((annotation) => ({ ...annotation, frameIndex }));
}
