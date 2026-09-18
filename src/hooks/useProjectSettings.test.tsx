import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useProjectSettings } from "./useProjectSettings";
import { ProjectVideoSettings } from "../components/settings/ProjectVideoSettings";
import { exportAnnotationsJson, listTextFiles, readTextFile } from "../lib/tauri-api";
vi.mock("../lib/tauri-api", () => ({
  exportAnnotationsJson: vi.fn(),
  listTextFiles: vi.fn(),
  readTextFile: vi.fn(),
}));
let model: ReturnType<typeof useProjectSettings>;
let root: Root;
let container: HTMLDivElement;
function Harness({ folder }: { folder: string }) {
  model = useProjectSettings(folder);
  return <ProjectVideoSettings folder={folder} model={model} />;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  vi.mocked(listTextFiles).mockResolvedValue([]);
  vi.mocked(exportAnnotationsJson).mockResolvedValue(undefined);
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
it("saves a project default before any annotations exist and reloads it independently", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  expect(model.settings.videoExtraction.frameInterval).toBe(30);
  await act(async () => {
    expect(await model.save(8)).toBe(true);
  });
  expect(exportAnnotationsJson).toHaveBeenCalledWith("C:/one/my-label-tool.settings.json", {
    schemaVersion: 1,
    videoExtraction: { frameInterval: 8 },
  });
  expect(container.querySelector("input")?.value).toBe("8");
  await act(async () => root.render(<Harness folder="C:/two" />));
  expect(model.settings.videoExtraction.frameInterval).toBe(30);
  vi.mocked(listTextFiles).mockResolvedValue([
    { name: "my-label-tool.settings.json", path: "C:/one/my-label-tool.settings.json" },
  ]);
  vi.mocked(readTextFile).mockResolvedValue(
    '{"schemaVersion":1,"videoExtraction":{"frameInterval":8}}',
  );
  await act(async () => root.render(<Harness folder="C:/one" />));
  expect(model.settings.videoExtraction.frameInterval).toBe(8);
});
it("keeps the saved default on write failure and validates before writing", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => {
    expect(await model.save(0)).toBe(false);
  });
  expect(exportAnnotationsJson).not.toHaveBeenCalled();
  vi.mocked(exportAnnotationsJson).mockRejectedValue(new Error("read only"));
  await act(async () => {
    expect(await model.save(9)).toBe(false);
  });
  expect(model.settings.videoExtraction.frameInterval).toBe(30);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("read only");
});
it("does not apply a late load from the previous project", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof listTextFiles>>) => void;
  vi.mocked(listTextFiles).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await act(async () => root.render(<Harness folder="C:/one" />));
  expect(model.loading).toBe(true);
  await act(async () => root.render(<Harness folder="C:/two" />));
  await act(async () => model.save(7));
  await act(async () => resolve([]));
  expect(model.settings.videoExtraction.frameInterval).toBe(7);
});
it("keeps save feedback visible after the stored interval updates", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("button")!.click());
  expect(model.settings.videoExtraction.frameInterval).toBe(8);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => root.render(<Harness folder="C:/two" />));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
it("does not show a previous project's late save feedback in the current project", async () => {
  let finish!: () => void;
  vi.mocked(exportAnnotationsJson).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(<Harness folder="C:/two" />));
  await act(async () => finish());
  expect(container.querySelector('[role="status"]')).toBeNull();
});
