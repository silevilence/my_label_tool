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
});

it("keeps the bar stable while running and hides counters without a total", () => {
  render({
    total: 0,
    completed: 0,
    source: "",
    failures: [],
    finished: false,
    cancelled: false,
  });
  expect(document.body.querySelector(".h-full.bg-sky-500")).toBeNull();
  expect(document.body.textContent).not.toContain("剩余");
});
