import { useEffect, useRef, useState } from "react";
import { exportAnnotationsJson, listTextFiles, readTextFile } from "../lib/tauri-api";
import { joinPath } from "../lib/app-utils";
import { DEFAULT_PROJECT_SETTINGS } from "../lib/defaults/video";
import {
  PROJECT_SETTINGS_NAME,
  parseProjectSettings,
  validFrameInterval,
} from "../lib/project-settings";
import type { ProjectSettings } from "../types/project-settings";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

export function useProjectSettings(folder: string) {
  const [state, setState] = useState({ folder: "", settings: DEFAULT_PROJECT_SETTINGS, error: "" });
  const [saving, setSaving] = useState(false);
  const currentFolder = useRef(folder);
  currentFolder.current = folder;
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    if (!folder) return;
    void (async () => {
      try {
        const files = await listTextFiles(folder, "json");
        const file = files.find((entry) => entry.name.toLowerCase() === PROJECT_SETTINGS_NAME);
        const settings = file
          ? parseProjectSettings(await readTextFile(file.path))
          : DEFAULT_PROJECT_SETTINGS;
        if (active) setState({ folder, settings, error: "" });
      } catch (error) {
        if (active) setState({ folder, settings: DEFAULT_PROJECT_SETTINGS, error: String(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [folder]);
  async function save(frameInterval: number) {
    if (!folder || pending.current || state.folder !== folder) return false;
    if (!validFrameInterval(frameInterval)) {
      setState((current) => ({ ...current, error: text.invalidSettings }));
      return false;
    }
    pending.current = true;
    setSaving(true);
    const settings: ProjectSettings = { schemaVersion: 1, videoExtraction: { frameInterval } };
    try {
      await exportAnnotationsJson(joinPath(folder, PROJECT_SETTINGS_NAME), settings);
      if (currentFolder.current === folder) setState({ folder, settings, error: "" });
      return true;
    } catch (error) {
      if (currentFolder.current === folder)
        setState((current) => ({ ...current, error: String(error) }));
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  return {
    settings: state.folder === folder ? state.settings : DEFAULT_PROJECT_SETTINGS,
    error: state.folder === folder ? state.error : "",
    loading: !!folder && state.folder !== folder,
    saving,
    save,
  };
}
