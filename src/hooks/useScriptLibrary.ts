import { useEffect, useRef, useState } from "react";
import { DEFAULT_SCRIPT_SOURCE } from "../lib/defaults/scripts";
import {
  exportScriptFile,
  loadScriptLibrary,
  readLibraryScript,
  removeLibraryScript,
  saveLibraryScript,
  splitScriptPath,
  type ScriptLibrary,
} from "../lib/script-library";
import { readTextFile, selectScriptExportPath, selectScriptFile } from "../lib/tauri-api";
import { confirmAction, promptText } from "../lib/prompts";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";
import { useOperations } from "../store/useOperations";

export function useScriptLibrary() {
  const [library, setLibrary] = useState<ScriptLibrary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [source, setSource] = useState(DEFAULT_SCRIPT_SOURCE);
  const [includeDimensions, setIncludeDimensions] = useState(false);
  const [saved, setSaved] = useState({ source: DEFAULT_SCRIPT_SOURCE, includeDimensions: false });
  const [pending, setPending] = useState(true);
  const working = useRef(false);
  const dirty = source !== saved.source || includeDimensions !== saved.includeDimensions;
  const selected = library?.scripts.find((entry) => entry.id === selectedId);
  useEffect(() => {
    let mounted = true;
    void loadScriptLibrary()
      .then(async (value) => {
        const entry = value.scripts[0];
        const source = entry ? await readLibraryScript(value, entry.id) : DEFAULT_SCRIPT_SOURCE;
        if (!mounted) return;
        setLibrary(value);
        setSelectedId(entry?.id ?? "");
        setSource(source);
        const includeDimensions = entry?.options.includeDimensions ?? false;
        setIncludeDimensions(includeDimensions);
        setSaved({ source, includeDimensions });
      })
      .catch((error: unknown) => {
        if (mounted) useOperations.getState().pushError(text.library, String(error));
      })
      .finally(() => {
        if (mounted) setPending(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  async function discardChanges() {
    return (
      !dirty ||
      (await confirmAction(`${text.discardTitle}\n${text.discardMessage}`, { danger: true }))
    );
  }
  async function work(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setPending(true);
    try {
      await action();
    } catch (error) {
      useOperations
        .getState()
        .pushError(text.library, error instanceof Error ? error.message : String(error));
    } finally {
      working.current = false;
      setPending(false);
    }
  }
  function setDocument(id: string, content: string, dimensions: boolean) {
    setSelectedId(id);
    setSource(content);
    setIncludeDimensions(dimensions);
    setSaved({ source: content, includeDimensions: dimensions });
  }
  return {
    library,
    selected,
    source,
    setSource,
    includeDimensions,
    setIncludeDimensions,
    pending,
    dirty,
    discardChanges,
    select: (id: string) =>
      work(async () => {
        if (!library || id === selectedId || !(await discardChanges())) return;
        const entry = library.scripts.find((entry) => entry.id === id);
        if (entry)
          setDocument(id, await readLibraryScript(library, id), entry.options.includeDimensions);
      }),
    create: () =>
      work(async () => {
        if (!library || !(await discardChanges())) return;
        const name = await promptText(text.newScript, text.defaultName);
        if (!name?.trim()) return;
        const entry = {
          id: crypto.randomUUID(),
          name: name.trim(),
          options: { includeDimensions: false },
        };
        setLibrary(await saveLibraryScript(library, entry, DEFAULT_SCRIPT_SOURCE));
        setDocument(entry.id, DEFAULT_SCRIPT_SOURCE, false);
      }),
    save: () =>
      work(async () => {
        if (!library) return;
        const name = selected?.name ?? (await promptText(text.saveAs, text.defaultName));
        if (!name?.trim()) return;
        const entry = {
          id: selected?.id ?? crypto.randomUUID(),
          name: name.trim(),
          options: { includeDimensions },
        };
        setLibrary(await saveLibraryScript(library, entry, source));
        setDocument(entry.id, source, includeDimensions);
      }),
    rename: () =>
      work(async () => {
        if (!library || !selected) return;
        const name = await promptText(text.rename, selected.name);
        if (name?.trim())
          setLibrary(await saveLibraryScript(library, { ...selected, name: name.trim() }));
      }),
    remove: () =>
      work(async () => {
        if (
          !library ||
          !selected ||
          !(await confirmAction(text.deleteMessage(selected.name), { danger: true }))
        )
          return;
        setLibrary(await removeLibraryScript(library, selected.id));
        setDocument("", DEFAULT_SCRIPT_SOURCE, false);
      }),
    open: () =>
      work(async () => {
        if (!(await discardChanges())) return;
        const path = await selectScriptFile();
        if (path) {
          const content = await readTextFile(path);
          setDocument("", content, false);
          setSaved({ source: "", includeDimensions: false });
        }
      }),
    export: () =>
      work(async () => {
        const path = await selectScriptExportPath(`${selected?.name ?? text.defaultName}.lua`);
        if (path) {
          splitScriptPath(path);
          await exportScriptFile(path, source);
        }
      }),
  };
}
