import {
  isLabelCompatibleWithShape,
  type AnnotationShapeType,
  type LabelConfig,
} from "../types/annotation";

export function useShapeToolSelection({
  currentLabelId,
  labelById,
  labels,
  selectCurrentLabel,
  setCurrentShapeType,
  showLabelSwitchHint,
}: {
  currentLabelId: string;
  labelById: Map<string, LabelConfig>;
  labels: LabelConfig[];
  selectCurrentLabel: (labelId: string) => void;
  setCurrentShapeType: (shapeType: AnnotationShapeType) => void;
  showLabelSwitchHint: (labelId: string) => void;
}) {
  function changeCurrentLabel(labelId: string) {
    selectCurrentLabel(labelId);
    showLabelSwitchHint(labelId);
  }

  function selectShapeType(shapeType: AnnotationShapeType) {
    setCurrentShapeType(shapeType);
    const label =
      labels.find((item) => isLabelCompatibleWithShape(item, shapeType)) ??
      labelById.get(currentLabelId) ??
      labels[0];
    if (label) {
      selectCurrentLabel(label.id);
      showLabelSwitchHint(label.id);
    }
  }

  return { changeCurrentLabel, selectShapeType };
}
