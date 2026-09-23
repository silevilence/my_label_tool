import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  DEFAULT_RECT_SIZE_DISPLAY_SETTINGS,
  loadRectSizeDisplaySettings,
  saveRectSizeDisplaySettings,
  loadLabelDisplaySettings,
  saveLabelDisplaySettings,
} from "./display";

const key = "my-label-tool.rect-size-display-settings";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("defaults to showing sizes only in annotate mode", () => {
  expect(loadRectSizeDisplaySettings()).toEqual({ default: false, select: false, annotate: true });
});

it("persists all modes independently of label visibility", () => {
  const sizes = { default: true, select: true, annotate: false };
  const labels = { default: false, select: true, annotate: true };
  saveLabelDisplaySettings(labels);
  saveRectSizeDisplaySettings(sizes);
  expect(loadRectSizeDisplaySettings()).toEqual(sizes);
  expect(loadLabelDisplaySettings()).toEqual(labels);
});

it.each(["{", "null", "true", "123", '"invalid"', "[]"])(
  "falls back safely for invalid storage: %s",
  (raw) => {
    localStorage.setItem(key, raw);
    expect(loadRectSizeDisplaySettings()).toEqual(DEFAULT_RECT_SIZE_DISPLAY_SETTINGS);
  },
);

it("preserves valid fields and defaults missing or invalid modes", () => {
  localStorage.setItem(key, JSON.stringify({ default: true, select: "true", unknown: false }));
  expect(loadRectSizeDisplaySettings()).toEqual({ default: true, select: false, annotate: true });
});

it("handles unavailable storage without preventing session changes", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("denied");
  });
  expect(loadRectSizeDisplaySettings()).toEqual(DEFAULT_RECT_SIZE_DISPLAY_SETTINGS);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("full");
  });
  expect(() => saveRectSizeDisplaySettings(DEFAULT_RECT_SIZE_DISPLAY_SETTINGS)).not.toThrow();
});
