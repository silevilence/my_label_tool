import { expect, it } from "vitest";
import { timelinePlayheadStyle } from "./timeline-playhead";

it.each([
  [0, 1, 50],
  [0, 300, 1 / 6],
  [149, 300, (149.5 / 300) * 100],
  [299, 300, (299.5 / 300) * 100],
])("keeps frame %i/%i centred within the full strip", (index, count, percent) => {
  const style = timelinePlayheadStyle(index, count);
  expect(style.width).toBe(2);
  expect(style.left).toBe("var(--playhead-left)");
  const bounded = style["--playhead-left"];
  expect(bounded).toMatch(/^clamp\(0px, calc\([\d.]+% - 1px\), calc\(100% - 2px\)\)$/);
  expect(Number(bounded.match(/([\d.]+)%/)![1])).toBeCloseTo(percent, 12);
});
