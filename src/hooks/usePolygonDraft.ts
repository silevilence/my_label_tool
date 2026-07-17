import { useCallback, useMemo, useState } from "react";
import { toCanvasPoints } from "../components/canvas/geometry";
import type { ImageLayout } from "../components/canvas/types";

export function usePolygonDraft(imageLayout: ImageLayout | null) {
  const [polygonPoints, setPolygonPoints] = useState<number[] | null>(null);
  const [polygonCursorPoint, setPolygonCursorPoint] = useState<{ x: number; y: number } | null>(
    null,
  );

  const draftPolygonPoints = useMemo(
    () =>
      polygonPoints && imageLayout
        ? toCanvasPoints(
            polygonCursorPoint
              ? [...polygonPoints, polygonCursorPoint.x, polygonCursorPoint.y]
              : polygonPoints,
            imageLayout,
          )
        : null,
    [imageLayout, polygonCursorPoint, polygonPoints],
  );

  const clearPolygonDraft = useCallback(() => {
    setPolygonPoints(null);
    setPolygonCursorPoint(null);
  }, []);

  const undoPolygonDraftPoint = useCallback(() => {
    if (!polygonPoints || polygonPoints.length === 0) {
      return false;
    }

    const nextPoints = polygonPoints.slice(0, -2);
    setPolygonPoints(nextPoints.length > 0 ? nextPoints : null);
    setPolygonCursorPoint(null);
    return true;
  }, [polygonPoints]);

  return {
    clearPolygonDraft,
    draftPolygonPoints,
    polygonPoints,
    polygonCursorPoint,
    setPolygonCursorPoint,
    setPolygonPoints,
    undoPolygonDraftPoint,
  };
}
