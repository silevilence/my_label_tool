/** Windowed-render math for lists with fixed but heterogeneous row heights. */
/** offsets[i] is row i's top inside the content; offsets[n] is the total content height. */
export function rowOffsets(heights: readonly number[]): Float64Array {
  const offsets = new Float64Array(heights.length + 1);
  for (let index = 0; index < heights.length; index += 1) {
    offsets[index + 1] = offsets[index] + heights[index];
  }
  return offsets;
}

/** Index of the row containing `offset`; -1 for an empty list. */
export function rowAtOffset(offsets: Float64Array, offset: number): number {
  if (offsets.length <= 1) return -1;
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle] <= offset) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Inclusive [start, end] window covering the viewport plus overscan rows on both sides. */
export function visibleRows(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscan = 4,
): { start: number; end: number } {
  const last = offsets.length - 2;
  if (last < 0) return { start: 0, end: -1 };
  return {
    start: Math.max(0, rowAtOffset(offsets, scrollTop) - overscan),
    end: Math.min(last, rowAtOffset(offsets, scrollTop + Math.max(viewportHeight, 0)) + overscan),
  };
}

/** Scroll position bringing row `index` into view ("nearest"); rows may sit `contentTop` below the scroller top. */
export function scrollTopForIndex(
  offsets: Float64Array,
  index: number,
  scrollTop: number,
  viewportHeight: number,
  contentTop = 0,
): number {
  const last = offsets.length - 2;
  if (last < 0 || index < 0) return scrollTop;
  const row = Math.min(Math.max(index, 0), last);
  const top = contentTop + offsets[row];
  const bottom = contentTop + offsets[row + 1];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) {
    // 行高于视口时贴顶，否则按 CSSOM nearest 语义把行底边对齐到视口底边
    return bottom - top <= viewportHeight ? bottom - viewportHeight : top;
  }
  return scrollTop;
}
