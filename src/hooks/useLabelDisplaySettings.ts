import { useEffect, useRef, useState } from "react";
import {
  loadLabelDisplaySettings,
  saveLabelDisplaySettings,
  type LabelDisplaySettings,
} from "../lib/defaults/display";
import type { InteractionMode } from "../components/canvas/types";
import type { LabelConfig } from "../types/annotation";

export function useLabelDisplaySettings(labelById: Map<string, LabelConfig>) {
  const timeoutRef = useRef<number | null>(null);
  const [labelDisplaySettings, setLabelDisplaySettings] = useState<LabelDisplaySettings>(
    loadLabelDisplaySettings,
  );
  const [labelSwitchHint, setLabelSwitchHint] = useState<LabelConfig | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  function setLabelDisplaySetting(mode: InteractionMode, visible: boolean) {
    const nextSettings = { ...labelDisplaySettings, [mode]: visible };
    setLabelDisplaySettings(nextSettings);
    saveLabelDisplaySettings(nextSettings);
  }

  function showLabelSwitchHint(labelId: string) {
    const label = labelById.get(labelId);
    if (!label) {
      return;
    }

    setLabelSwitchHint(label);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setLabelSwitchHint(null);
      timeoutRef.current = null;
    }, 1500);
  }

  return {
    labelDisplaySettings,
    labelSwitchHint,
    setLabelDisplaySetting,
    showLabelSwitchHint,
  };
}
