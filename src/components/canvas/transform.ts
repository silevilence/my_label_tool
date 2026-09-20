import type { ImageLayout } from "./types";
import type { GesturePoint } from "../../lib/draft-gesture";
export function createTransform(layout: ImageLayout) {
  const toScreen = (point: GesturePoint) => ({
    x: layout.x + point.x * layout.scale,
    y: layout.y + point.y * layout.scale,
  });
  const toImage = (point: GesturePoint) => ({
    x: (point.x - layout.x) / layout.scale,
    y: (point.y - layout.y) / layout.scale,
  });
  return {
    toScreen,
    toImage,
    toScreenLength: (length: number) => length * layout.scale,
    toImageLength: (length: number) => length / layout.scale,
    svgTransform: `translate(${layout.x} ${layout.y}) scale(${layout.scale})`,
    zoomAt: (anchor: GesturePoint, nextScale: number): ImageLayout => {
      const point = toImage(anchor);
      return {
        scale: nextScale,
        width: (layout.width / layout.scale) * nextScale,
        height: (layout.height / layout.scale) * nextScale,
        x: anchor.x - point.x * nextScale,
        y: anchor.y - point.y * nextScale,
      };
    },
  };
}
