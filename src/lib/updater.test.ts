import { expect, it, vi } from "vitest";
import { installAppUpdate } from "./updater";
import type { Update, DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: vi.fn() }));
it("never installs or relaunches when cancellation is requested during transfer", async () => {
  vi.mocked(relaunch).mockClear();
  const update = {
    download: vi.fn(async (progress: (event: DownloadEvent) => void) => {
      progress({ event: "Started", data: { contentLength: 20 } });
      progress({ event: "Progress", data: { chunkLength: 10 } });
    }),
    install: vi.fn(),
    close: vi.fn(),
  };
  const progress = vi.fn();
  expect(await installAppUpdate(update as unknown as Update, progress, () => true)).toBe(false);
  expect(progress).toHaveBeenLastCalledWith({ downloaded: 10, total: 20, percent: 50 });
  expect(update.install).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  expect(update.close).toHaveBeenCalledOnce();
});
it("turns off cancellation before installation and then relaunches", async () => {
  const order: string[] = [];
  const update = {
    download: vi.fn(async () => {}),
    install: vi.fn(async () => {
      order.push("install");
    }),
  };
  expect(
    await installAppUpdate(
      update as unknown as Update,
      vi.fn(),
      () => false,
      () => {
        order.push("uncancellable");
      },
    ),
  ).toBe(true);
  expect(order).toEqual(["uncancellable", "install"]);
  expect(relaunch).toHaveBeenCalledOnce();
});

it("closes a rejected transfer and reports cancellation only when it was requested", async () => {
  vi.mocked(relaunch).mockClear();
  const update = {
    download: vi.fn().mockRejectedValue(new Error("offline")),
    install: vi.fn(),
    close: vi.fn(),
  };
  await expect(installAppUpdate(update as unknown as Update, vi.fn(), () => true)).resolves.toBe(
    false,
  );
  expect(update.close).toHaveBeenCalledOnce();
  expect(update.install).not.toHaveBeenCalled();
  expect(relaunch).not.toHaveBeenCalled();
  await expect(installAppUpdate(update as unknown as Update, vi.fn())).rejects.toThrow("offline");
  expect(update.close).toHaveBeenCalledTimes(2);
});
