import { beforeEach, expect, it, vi } from "vitest";
import {
  exportScriptFile,
  loadScriptLibrary,
  parseScriptIndex,
  readLibraryScript,
  removeLibraryScript,
  saveLibraryScript,
  splitScriptPath,
} from "./script-library";
const fs = vi.hoisted(() => new Map<string, string>());
vi.mock("./tauri-api", () => ({
  scriptLibraryDirectory: async () => "/data/scripts",
  readTextFile: async (path: string) => {
    if (!fs.has(path)) throw new Error("missing");
    return fs.get(path);
  },
  exportTextFiles: async (directory: string, files: { path: string; content: string }[]) => {
    for (const file of files) fs.set(`${directory}/${file.path}`, file.content);
  },
  deleteScriptFile: async (id: string) => {
    fs.delete(`/data/scripts/${id}.lua`);
  },
}));
beforeEach(() => {
  fs.clear();
  fs.set("/data/scripts/index.json", '{"schemaVersion":1,"scripts":[]}');
});
it("persists scripts and options through reload, rename, export and delete using host text commands", async () => {
  let library = await loadScriptLibrary();
  await saveLibraryScript(
    library,
    { id: "id-1", name: "编号", options: { includeDimensions: true } },
    "-- 中文\nreturn 1\n",
  );
  library = await loadScriptLibrary();
  expect(library.scripts[0].options.includeDimensions).toBe(true);
  const source = await readLibraryScript(library, "id-1");
  library = await saveLibraryScript(library, { ...library.scripts[0], name: "重命名" });
  expect(await readLibraryScript(library, "id-1")).toBe(source);
  await exportScriptFile("C:\\scripts\\demo.lua", source);
  expect(fs.get("C:/scripts/demo.lua")).toBe(source);
  library = await removeLibraryScript(library, "id-1");
  expect(library.scripts).toHaveLength(0);
  expect((await loadScriptLibrary()).scripts).toHaveLength(0);
  expect(fs.has("/data/scripts/id-1.lua")).toBe(false);
});
it("rejects corrupt indexes, traversal and missing entries", async () => {
  for (const value of [
    null,
    {},
    { schemaVersion: 2, scripts: [] },
    { schemaVersion: 1, scripts: [null] },
    {
      schemaVersion: 1,
      scripts: [{ id: "../escape", name: "a", options: { includeDimensions: false } }],
    },
  ])
    expect(() => parseScriptIndex(JSON.stringify(value))).toThrow();
  const entry = { id: "a", name: "a", options: { includeDimensions: false } };
  expect(() =>
    parseScriptIndex(JSON.stringify({ schemaVersion: 1, scripts: [entry, entry] })),
  ).toThrow();
  await expect(readLibraryScript(await loadScriptLibrary(), "missing")).rejects.toThrow();
  await expect(removeLibraryScript(await loadScriptLibrary(), "missing")).rejects.toThrow();
  expect(() => splitScriptPath("file.lua")).toThrow();
  expect(splitScriptPath("/file.lua")).toEqual({ directory: "/", name: "file.lua" });
});
