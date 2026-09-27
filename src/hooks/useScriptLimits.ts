import { useEffect, useRef, useState } from "react";
import type { ScriptLimits } from "../types/script";
import { DEFAULT_SCRIPT_LIMITS, validateScriptLimits } from "../lib/script-limits";
import { loadScriptResourceLimits, saveScriptResourceLimits } from "../lib/tauri-api";
import { useOperations } from "../store/useOperations";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";
import { useTextReadStore } from "../store/useTextReadStore";
export function useScriptLimits() {
  const readerRevision = useTextReadStore((state) => state.revision);
  const loadedOnce = useRef(false);
  const edited = useRef(false);
  const [value, setValue] = useState<ScriptLimits>({ ...DEFAULT_SCRIPT_LIMITS });
  const [saved, setSaved] = useState<ScriptLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (loadedOnce.current) return;
    let active = true;
    setLoading(true);
    setError("");
    void loadScriptResourceLimits()
      .then((limits) => {
        validateScriptLimits(limits);
        if (active && !loadedOnce.current) {
          loadedOnce.current = true;
          if (!edited.current) setValue(limits);
          setSaved(limits);
        }
      })
      .catch((error: unknown) => {
        if (active) setError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [readerRevision]);
  async function save(next = value) {
    try {
      validateScriptLimits(next);
      setLoading(true);
      setError("");
      await saveScriptResourceLimits(next);
      loadedOnce.current = true;
      setValue(next);
      setSaved(next);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      useOperations.getState().pushError(text.limitsTitle, message);
    } finally {
      setLoading(false);
    }
  }
  return {
    value,
    setValue: (next: ScriptLimits) => {
      edited.current = true;
      setValue(next);
    },
    saved,
    loading,
    error,
    save,
    restore: () => save({ ...DEFAULT_SCRIPT_LIMITS }),
  };
}
