import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoBatchDialog } from "./VideoBatchDialog";
import type { VideoBatchProgress } from "../../lib/video-import-queue";
import { VIDEO_ZH_CN as text } from "../../i18n/video.zh-CN";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(progress: VideoBatchProgress) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root.render(<VideoBatchDialog progress={progress} onCancel={vi.fn()} onClose={vi.fn()} />),
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("shows a determinate bar with completed, failed and remaining counts", () => {
  render({
    total: 4,
    completed: 2,
    source: "b.mp4",
    failures: [{ source: "a.mp4", message: "disk full" }],
    finished: false,
    cancelled: false,
  });
  expect(document.body.textContent).toContain(text.batchProgress(2, 4, 1));
  expect(document.body.textContent).toContain(text.batchRemaining(2, 1, 4));
  const bar = document.body.querySelector<HTMLElement>(".h-full.bg-sky-500")!;
  expect(bar.style.width).toBe("75%");
  const progressbar = document.body.querySelector('[role="progressbar"]')!;
  expect(progressbar.getAttribute("aria-label")).toBe(text.batchProgressLabel);
  expect(progressbar.getAttribute("aria-valuetext")).toBe(text.batchProgress(2, 4, 1));
  expect(progressbar.getAttribute("aria-valuenow")).toBe("75");
});

it("hides the progressbar and remaining counter without a total", () => {
  render({
    total: 0,
    completed: 0,
    source: "",
    failures: [],
    finished: false,
    cancelled: false,
  });
  expect(document.body.querySelector(".h-full.bg-sky-500")).toBeNull();
  expect(document.body.querySelector('[role="progressbar"]')).toBeNull();
  expect(document.body.textContent).not.toContain(text.batchRemaining(0, 0, 0));
});

it("keeps processed progress stable when the next video starts", () => {
  const progress: VideoBatchProgress = {
    total: 3,
    completed: 1,
    source: "second.mp4",
    failures: [],
    finished: false,
    cancelled: false,
  };
  render(progress);
  const bar = document.body.querySelector('[role="progressbar"]')!;
  const width = bar.firstElementChild?.getAttribute("style");
  act(() =>
    root.render(
      <VideoBatchDialog
        progress={{ ...progress, source: "third.mp4" }}
        onCancel={vi.fn()}
        onClose={vi.fn()}
      />,
    ),
  );
  expect(document.body.querySelector('[role="progressbar"]')).toBe(bar);
  expect(bar.getAttribute("aria-valuenow")).toBe("33");
  expect(bar.firstElementChild?.getAttribute("style")).toBe(width);
});
