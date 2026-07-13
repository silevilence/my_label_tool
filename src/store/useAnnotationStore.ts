import { create } from "zustand";
import type { AnnotationShape } from "../types/annotation";

interface AnnotationState {
  annotationsByImage: Record<string, AnnotationShape[]>;
  selectedShapeId: string | null;
  addAnnotation: (imagePath: string, annotation: AnnotationShape) => void;
  updateAnnotation: (
    imagePath: string,
    annotationId: string,
    patch: Partial<AnnotationShape>,
  ) => void;
  selectShape: (annotationId: string | null) => void;
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  annotationsByImage: {},
  selectedShapeId: null,
  addAnnotation: (imagePath, annotation) =>
    set((state) => ({
      annotationsByImage: {
        ...state.annotationsByImage,
        [imagePath]: [...(state.annotationsByImage[imagePath] ?? []), annotation],
      },
      selectedShapeId: annotation.id,
    })),
  updateAnnotation: (imagePath, annotationId, patch) =>
    set((state) => ({
      annotationsByImage: {
        ...state.annotationsByImage,
        [imagePath]: (state.annotationsByImage[imagePath] ?? []).map((annotation) =>
          annotation.id === annotationId ? { ...annotation, ...patch } : annotation,
        ),
      },
    })),
  selectShape: (annotationId) => set({ selectedShapeId: annotationId }),
}));
