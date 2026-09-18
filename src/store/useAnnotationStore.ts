import { create } from "zustand";
import { annotationShapesEqual } from "../lib/annotation-utils";
import type { AnnotationShape } from "../types/annotation";

interface AnnotationState {
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
      return withHistoryFlags({
        ...state,
        annotationsByImage,
        selectedShapeId:
          state.selectedShapeId && removedIds.has(state.selectedShapeId)
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
