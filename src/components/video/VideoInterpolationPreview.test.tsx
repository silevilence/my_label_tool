import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { VideoInterpolationPreview } from "./VideoInterpolationPreview";
import type { AnnotationShape } from "../../types/annotation";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

it.each([
  ["rect", [10, 20, 30, 40], "rect", { x: "10", y: "20", width: "30", height: "40" }],
  ["polygon", [10, 20, 30, 40, 50, 20], "polygon", { points: "10,20 30,40 50,20" }],
  ["point", [10, 20], "circle", { cx: "10", cy: "20", r: "3" }],
] as const)(
  "aligns a read-only %s preview with the canvas during zoom and pan",
  async (type, points, tag, attributes) => {
    const shape: AnnotationShape = { id: "ghost", labelId: "label", type, points: [...points] };
    await act(async () =>
      root.render(
        <VideoInterpolationPreview
          shape={shape}
          layout={{ x: 13, y: -7, width: 200, height: 200, scale: 2 }}
        />,
      ),
    );
    const svg = container.querySelector("svg")!;
    expect(svg.classList.contains("pointer-events-none")).toBe(true);
    expect(svg.querySelector("g")?.getAttribute("transform")).toBe("translate(13 -7) scale(2)");
    expect(svg.querySelector("g")?.getAttribute("stroke-width")).toBe("1");
    for (const [name, value] of Object.entries(attributes))
      expect(svg.querySelector(tag)?.getAttribute(name)).toBe(value);
    await act(async () =>
      root.render(
        <VideoInterpolationPreview
          shape={shape}
          layout={{ x: -50, y: 25, width: 50, height: 50, scale: 0.5 }}
        />,
      ),
    );
    expect(svg.querySelector("g")?.getAttribute("transform")).toBe("translate(-50 25) scale(0.5)");
    expect(svg.querySelector("g")?.getAttribute("stroke-width")).toBe("4");
    expect(svg.querySelector("g")?.getAttribute("stroke-dasharray")).toBe("14 8");
  },
);
