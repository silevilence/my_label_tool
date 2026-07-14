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
  replaceAnnotations: (annotationsByImage: Record<string, AnnotationShape[]>) => void;
  replaceLabel: (oldLabelId: string, nextLabelId: string) => void;
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
  replaceAnnotations: (annotationsByImage) => set({ annotationsByImage, selectedShapeId: null }),
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
