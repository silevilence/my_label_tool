import {
  exportTextFiles,
  readTextFile,
  scriptLibraryDirectory,
  deleteScriptFile,
} from "./tauri-api";
import type { ScriptOptions } from "../types/script";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

export interface ScriptEntry {
  id: string;
  name: string;
  options: ScriptOptions;
}
export interface ScriptLibrary {
  directory: string;
  scripts: ScriptEntry[];
}
const indexName = "index.json";
export function parseScriptIndex(source: string): ScriptEntry[] {
  const value: unknown = JSON.parse(source);
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("scripts" in value) ||
    !Array.isArray(value.scripts)
  )
    throw new Error(text.invalidLibrary);
  const ids = new Set<string>();
  return value.scripts.map((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.id) ||
      ids.has(entry.id) ||
      !("name" in entry) ||
      typeof entry.name !== "string" ||
      !entry.name.trim() ||
      !("options" in entry) ||
      !entry.options ||
      typeof entry.options !== "object" ||
      !("includeDimensions" in entry.options) ||
      typeof entry.options.includeDimensions !== "boolean"
    )
      throw new Error(text.invalidLibrary);
    ids.add(entry.id);
    return {
      id: entry.id,
      name: entry.name,
      options: { includeDimensions: entry.options.includeDimensions },
    };
  });
}
export async function loadScriptLibrary(): Promise<ScriptLibrary> {
  const directory = await scriptLibraryDirectory();
  return { directory, scripts: parseScriptIndex(await readTextFile(`${directory}/${indexName}`)) };
}
export async function readLibraryScript(library: ScriptLibrary, id: string): Promise<string> {
  if (!library.scripts.some((entry) => entry.id === id)) throw new Error(text.invalidLibrary);
  return readTextFile(`${library.directory}/${id}.lua`);
}
export async function saveLibraryScript(
  library: ScriptLibrary,
  entry: ScriptEntry,
  source?: string,
): Promise<ScriptLibrary> {
  const scripts = library.scripts.some((script) => script.id === entry.id)
    ? library.scripts.map((script) => (script.id === entry.id ? entry : script))
    : [...library.scripts, entry];
  const index = JSON.stringify({ schemaVersion: 1, scripts }, null, 2);
  parseScriptIndex(index);
  await exportTextFiles(library.directory, [
    ...(source === undefined ? [] : [{ path: `${entry.id}.lua`, content: source }]),
    { path: indexName, content: index },
  ]);
  return { ...library, scripts };
}
export async function removeLibraryScript(
  library: ScriptLibrary,
  id: string,
): Promise<ScriptLibrary> {
  if (!library.scripts.some((entry) => entry.id === id)) throw new Error(text.invalidLibrary);
  // Index first: a failed file deletion leaves an unreferenced backup, never a broken index.
  const next = { ...library, scripts: library.scripts.filter((entry) => entry.id !== id) };
  await exportTextFiles(library.directory, [
    {
      path: indexName,
      content: JSON.stringify({ schemaVersion: 1, scripts: next.scripts }, null, 2),
    },
  ]);
  try {
    await deleteScriptFile(id);
  } catch (error) {
    await exportTextFiles(library.directory, [
      {
        path: indexName,
        content: JSON.stringify({ schemaVersion: 1, scripts: library.scripts }, null, 2),
      },
    ]);
    throw error;
  }
  return next;
}
export function splitScriptPath(path: string): { directory: string; name: string } {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0 || index === normalized.length - 1) throw new Error(text.invalidFile);
  return { directory: normalized.slice(0, index) || "/", name: normalized.slice(index + 1) };
}
export async function exportScriptFile(path: string, source: string): Promise<void> {
  const { directory, name } = splitScriptPath(path);
  await exportTextFiles(directory, [{ path: name, content: source }]);
}
