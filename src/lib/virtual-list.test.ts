import { describe, expect, it } from "vitest";
import { rowAtOffset, rowOffsets, scrollTopForIndex, visibleRows } from "./virtual-list";

const IMAGE = 48;
const HEADER = 64;
const FRAME_LIST = 196;

describe("rowOffsets", () => {
  it("builds prefix sums over heterogeneous row heights", () => {
    const offsets = rowOffsets([IMAGE, HEADER, HEADER + FRAME_LIST]);
    expect([...offsets]).toEqual([0, 48, 112, 372]);
  });

  it("handles the empty list", () => {
    expect([...rowOffsets([])]).toEqual([0]);
  });
});

describe("rowAtOffset", () => {
  const offsets = rowOffsets([IMAGE, HEADER, 40, 40]);

  it("locates rows at and across boundaries", () => {
    expect(rowAtOffset(offsets, 0)).toBe(0);
    expect(rowAtOffset(offsets, 47.9)).toBe(0);
    expect(rowAtOffset(offsets, 48)).toBe(1);
    expect(rowAtOffset(offsets, 111)).toBe(1);
    expect(rowAtOffset(offsets, 500)).toBe(3);
  });

  it("returns -1 for an empty list", () => {
    expect(rowAtOffset(rowOffsets([]), 0)).toBe(-1);
  });
});

describe("visibleRows", () => {
  // rows: 0..9 at 48px each, 10..11 video headers at 64px, 12..13 tall active blocks
  const offsets = rowOffsets([...Array(10).fill(IMAGE), HEADER, HEADER, 260, 260]);

  it("windows the viewport with overscan and clamps at the edges", () => {
    expect(visibleRows(offsets, 0, 96, 2)).toEqual({ start: 0, end: 4 });
    expect(visibleRows(offsets, 48 * 5, 48, 2)).toEqual({ start: 3, end: 8 });
    expect(visibleRows(offsets, 48 * 10, 64, 2)).toEqual({ start: 8, end: 13 });
  });

  it("never renders beyond the last row and reports an empty window for empty lists", () => {
    expect(visibleRows(offsets, 1e9, 100, 4).end).toBe(13);
    expect(visibleRows(rowOffsets([]), 0, 100, 4)).toEqual({ start: 0, end: -1 });
  });
});

describe("scrollTopForIndex", () => {
  const offsets = rowOffsets([...Array(100).fill(IMAGE)]);

  it("aligns rows above the viewport to the top", () => {
    expect(scrollTopForIndex(offsets, 5, 4000, 96)).toBe(240);
  });

  it("aligns rows below the viewport to the bottom", () => {
    expect(scrollTopForIndex(offsets, 20, 0, 96)).toBe(912);
  });

  it("keeps the scroll position for visible rows", () => {
    expect(scrollTopForIndex(offsets, 20, 960, 96)).toBe(960);
  });

  it("honours content that sits below the scroller top (scope bar)", () => {
    expect(scrollTopForIndex(offsets, 20, 0, 96, 30)).toBe(942);
  });

  it("top-aligns rows taller than the viewport", () => {
    const mixed = rowOffsets([...Array(5).fill(IMAGE), 300]);
    expect(scrollTopForIndex(mixed, 5, 0, 96)).toBe(240);
  });

  it("is a no-op for empty lists and negative indexes", () => {
    expect(scrollTopForIndex(rowOffsets([]), 3, 12, 96)).toBe(12);
    expect(scrollTopForIndex(offsets, -1, 12, 96)).toBe(12);
  });
});
