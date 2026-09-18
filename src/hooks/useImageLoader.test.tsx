import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useImageLoader } from "./useImageLoader";
vi.mock("../lib/tauri-api", () => ({ imageFileSrc: (path: string) => path }));
class FrameImage {
  static pending: FrameImage[] = [];
  naturalWidth = 64;
  naturalHeight = 48;
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    FrameImage.pending.push(this);
  }
}
afterEach(() => vi.unstubAllGlobals());
it("never renders an old decoded frame under a newly selected frame's annotations", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("Image", FrameImage);
  const root = createRoot(document.createElement("div"));
  const images = ["a", "b", "c"].map((path) => ({ path, name: path }));
  const observed: Array<string | null> = [];
  function Harness({ path }: { path: string }) {
    const { loadedImage } = useImageLoader(images, path);
    observed.push(loadedImage?.src ?? null);
    return null;
  }
  await act(async () => root.render(<Harness path="a" />));
  const first = FrameImage.pending.find((image) => image.src === "a")!;
  const lateLoad = first.onload!;
  await act(async () => first.onload?.());
  expect(observed[observed.length - 1]).toBe("a");
  observed.length = 0;
  await act(async () => root.render(<Harness path="b" />));
  expect(observed.every((source) => source === null)).toBe(true);
  await act(async () => lateLoad());
  expect(observed[observed.length - 1]).toBeNull();
  const second = FrameImage.pending.filter((image) => image.src === "b").slice(-1)[0]!;
  await act(async () => second.onload?.());
  expect(observed[observed.length - 1]).toBe("b");
  await act(async () => root.render(<Harness path="a" />));
  expect(observed[observed.length - 1]).toBe("a");
  await act(async () => root.unmount());
});
