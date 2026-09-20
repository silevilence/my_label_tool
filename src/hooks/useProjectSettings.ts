import { tryBeginOperation } from "../store/useOperations";
import { OPERATION_ZH_CN as operationText } from "../i18n/operations.zh-CN";
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { listTextFiles, readTextFile } from "../lib/tauri-api";
import { saveProjectConfig } from "../lib/app-utils";
import { DEFAULT_PROJECT_SETTINGS } from "../lib/defaults/video";
import {
  PROJECT_SETTINGS_NAME,
  parseProjectSettings,
  validExtraction,
} from "../lib/project-settings";
import type { ProjectConfig } from "../lib/importers";
import type { ProjectSettings, VideoExtractionSettings } from "../types/project-settings";
import { VIDEO_ZH_CN as text } from "../i18n/video.zh-CN";

export function useProjectSettings(
  folder: string,
  config: ProjectConfig | null,
  configPath: string,
  setConfig: Dispatch<SetStateAction<ProjectConfig | null>>,
) {
  const [legacy, setLegacy] = useState({
    folder: "",
    settings: DEFAULT_PROJECT_SETTINGS,
    error: "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const current = useRef({ configPath, config });
  current.current = { configPath, config };
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    setSaveError("");
    if (!folder) return;
    void (async () => {
      try {
        const files = await listTextFiles(folder, "json");
        const file = files.find((entry) => entry.name.toLowerCase() === PROJECT_SETTINGS_NAME);
        const settings = file
          ? parseProjectSettings(await readTextFile(file.path))
          : DEFAULT_PROJECT_SETTINGS;
        if (active) setLegacy({ folder, settings, error: "" });
      } catch (error) {
        if (active) setLegacy({ folder, settings: DEFAULT_PROJECT_SETTINGS, error: String(error) });
      }
    })();
    return () => {
      active = false;
    };
  }, [folder]);
  async function save(videoExtraction: VideoExtractionSettings) {
    if (!config || !configPath || pending.current) return false;
    if (!validExtraction(videoExtraction)) {
      setSaveError(text.invalidSettings);
      return false;
    }
    const operation = tryBeginOperation({
      label: text.saveSettings,
      resource: ["project-annotations", "export-dir"],
    });
    if (!operation) {
      setSaveError(operationText.busy);
      return false;
    }
    pending.current = true;
    setSaving(true);
    setSaveError("");
    const settings: ProjectSettings = { schemaVersion: 1, videoExtraction };
    try {
      await saveProjectConfig(configPath, { ...config, settings });
      if (current.current.configPath !== configPath) return false;
      setConfig((latest) => (latest ? { ...latest, settings } : latest));
      return true;
    } catch (error) {
      operation.fail(error);
      if (current.current.configPath === configPath) setSaveError(String(error));
      return false;
    } finally {
      operation.complete();
      pending.current = false;
      setSaving(false);
    }
  }
  return {
    settings:
      config?.settings ?? (legacy.folder === folder ? legacy.settings : DEFAULT_PROJECT_SETTINGS),
    error: saveError || (!config?.settings && legacy.folder === folder ? legacy.error : ""),
    loading: !config?.settings && !!folder && legacy.folder !== folder,
    saving,
    save,
  };
}
