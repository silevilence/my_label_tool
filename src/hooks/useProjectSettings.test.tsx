import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useProjectSettings } from "./useProjectSettings";
import { ProjectVideoSettings } from "../components/settings/ProjectVideoSettings";
import { exportAnnotationsJson, listTextFiles, readTextFile } from "../lib/tauri-api";
import { extractionSettings } from "../lib/project-settings";
import { DEFAULT_PROJECT_SETTINGS } from "../lib/defaults/video";
import { parseProjectConfig, type ProjectConfig } from "../lib/importers";
vi.mock("../lib/tauri-api", () => ({
  exportAnnotationsJson: vi.fn(),
  listTextFiles: vi.fn(),
  readTextFile: vi.fn(),
}));
let model: ReturnType<typeof useProjectSettings>;
let root: Root;
let container: HTMLDivElement;
function fixture(folder: string): ProjectConfig {
  return {
    schemaVersion: 1,
    format: "json",
    annotationPath: `${folder}/annotations.json`,
    exportedAt: "today",
    imageFolder: folder,
    labels: [],
    template: { id: "project-config", name: "project" },
    exportOptions: { format: "json" },
    prelabelMappings: { model: [] },
    pluginConfigs: [{ pluginId: "dev.test.plugin", configVersion: 1, config: { keep: true } }],
  };
}
function Harness({ folder, hasProject = true }: { folder: string; hasProject?: boolean }) {
  const [config, setConfig] = useState<ProjectConfig | null>(() =>
    hasProject ? fixture(folder) : null,
  );
  useEffect(() => setConfig(hasProject ? fixture(folder) : null), [folder, hasProject]);
  model = useProjectSettings(
    folder,
    config,
    hasProject ? `${folder}/my-label-tool.project.json` : "",
    setConfig,
  );
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
it("defaults to 5 FPS and saves into the project file without losing other settings", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  expect(model.settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  await act(async () => {
    expect(await model.save(extractionSettings(8))).toBe(true);
  });
  const config = {
    ...fixture("C:/one"),
    settings: { schemaVersion: 1, videoExtraction: extractionSettings(8) },
  };
  expect(exportAnnotationsJson).toHaveBeenCalledExactlyOnceWith(
    "C:/one/my-label-tool.project.json",
    config,
  );
  expect(parseProjectConfig(JSON.stringify(config)).settings).toEqual(model.settings);
  expect(container.querySelector("input")?.value).toBe("8");
  await act(async () => root.render(<Harness folder="C:/two" />));
  expect(model.settings).toEqual(DEFAULT_PROJECT_SETTINGS);
});
it("does not write settings without a project file", async () => {
  await act(async () => root.render(<Harness folder="C:/one" hasProject={false} />));
  await act(async () => {
    expect(await model.save(extractionSettings(8))).toBe(false);
  });
  expect(exportAnnotationsJson).not.toHaveBeenCalled();
});
it("migrates legacy interval settings into the project on save", async () => {
  vi.mocked(listTextFiles).mockResolvedValue([
    { name: "my-label-tool.settings.json", path: "C:/one/my-label-tool.settings.json" },
  ]);
  vi.mocked(readTextFile).mockResolvedValue(
    '{"schemaVersion":1,"videoExtraction":{"frameInterval":8}}',
  );
  await act(async () => root.render(<Harness folder="C:/one" />));
  expect(model.settings.videoExtraction).toEqual(extractionSettings(8));
  await act(async () => model.save(model.settings.videoExtraction));
  expect(exportAnnotationsJson).toHaveBeenCalledWith(
    "C:/one/my-label-tool.project.json",
    expect.objectContaining({ settings: model.settings }),
  );
});
it("keeps the saved default on write failure and validates before writing", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => {
    expect(await model.save(extractionSettings(0))).toBe(false);
  });
  expect(exportAnnotationsJson).not.toHaveBeenCalled();
  vi.mocked(exportAnnotationsJson).mockRejectedValue(new Error("read only"));
  await act(async () => {
    expect(await model.save(extractionSettings(9))).toBe(false);
  });
  expect(model.settings).toEqual(DEFAULT_PROJECT_SETTINGS);
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
  await act(async () => model.save(extractionSettings(7)));
  await act(async () => resolve([]));
  expect(model.settings.videoExtraction.frameInterval).toBe(7);
});
it("keeps save feedback visible after changing FPS and preserves the other mode's value", async () => {
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => container.querySelector("button")!.click());
  expect(model.settings.videoExtraction).toEqual({ mode: "fps", fps: 8, frameInterval: 30 });
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "interval";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("input")?.value).toBe("30");
  await act(async () => container.querySelector("button")!.click());
  expect(model.settings.videoExtraction).toEqual({ mode: "interval", fps: 8, frameInterval: 30 });
  await act(async () => {
    const select = container.querySelector("select")!;
    select.value = "fps";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector("input")?.value).toBe("8");
  await act(async () => root.render(<Harness folder="C:/two" />));
  expect(container.querySelector('[role="status"]')).toBeNull();
});
it("does not show a previous project's late save feedback in the current project", async () => {
  let finish!: () => void;
  vi.mocked(exportAnnotationsJson).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(<Harness folder="C:/one" />));
  await act(async () => container.querySelector("button")!.click());
  await act(async () => root.render(<Harness folder="C:/two" />));
  await act(async () => finish());
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(model.settings).toEqual(DEFAULT_PROJECT_SETTINGS);
});
