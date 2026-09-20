import { useAnnotationStore } from "../store/useAnnotationStore";

export function useImageNavigation() {
  const selectAdjacentImage = useAnnotationStore((state) => state.selectAdjacent);
  const selectAdjacentUnannotatedImage = useAnnotationStore((state) => state.selectUnannotated);
  return { selectAdjacentImage, selectAdjacentUnannotatedImage };
}
