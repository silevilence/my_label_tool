import { create } from "zustand";
import { annotationShapesEqual } from "../lib/annotation-utils";
import type { AnnotationShape } from "../types/annotation";

interface AnnotationState {
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

export const useAnnotationStore = create<AnnotationState>((set) => ({
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
      const after = before.map((annotation) =>
        annotation.id === annotationId ? { ...annotation, ...patch } : annotation,
      );
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
  insertAnnotationsBatch: (entries, mode, requestedGroupId) => {
    const groupId = requestedGroupId ?? `store-${nextHistoryGroupId}`;
    if (requestedGroupId === undefined) {
      nextHistoryGroupId += 1;
    }
    set((state) =>
      entries.reduce((nextState, entry) => {
        const before = nextState.annotationsByImage[entry.imagePath] ?? [];
        const after = mode === "append" ? [...before, ...entry.annotations] : entry.annotations;
        const selectedAfter =
          nextState.selectedShapeId &&
          before.some((annotation) => annotation.id === nextState.selectedShapeId) &&
          !after.some((annotation) => annotation.id === nextState.selectedShapeId)
            ? null
            : nextState.selectedShapeId;
        return applyImageHistory(nextState, entry.imagePath, after, selectedAfter, groupId);
      }, state),
    );
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
          [entry.imagePath]: cloneAnnotations(entry.before),
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
          [entry.imagePath]: cloneAnnotations(entry.after),
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
        annotationsByImage,
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
  after: AnnotationShape[],
  selectedAfter: string | null,
  groupId?: string,
): AnnotationState {
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
