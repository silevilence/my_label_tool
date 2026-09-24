import { useEffect, useState } from "react";
import type { ScriptLimits } from "../types/script";
import { DEFAULT_SCRIPT_LIMITS, validateScriptLimits } from "../lib/script-limits";
import { loadScriptResourceLimits, saveScriptResourceLimits } from "../lib/tauri-api";
import { useOperations } from "../store/useOperations";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";
export function useScriptLimits() {
  const [value, setValue] = useState<ScriptLimits>({ ...DEFAULT_SCRIPT_LIMITS });
  const [saved, setSaved] = useState<ScriptLimits | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void loadScriptResourceLimits().then((limits) => { validateScriptLimits(limits); if (active) { setValue(limits); setSaved(limits); } }).catch((error: unknown) => { if (active) setError(String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  async function save(next = value) {
    try {
      validateScriptLimits(next); setLoading(true); setError("");
      await saveScriptResourceLimits(next); setValue(next); setSaved(next);
    } catch (error) { const message = error instanceof Error ? error.message : String(error); setError(message); useOperations.getState().pushError(text.limitsTitle, message); }
    finally { setLoading(false); }
  }
  return { value, setValue, saved, loading, error, save, restore: () => save({ ...DEFAULT_SCRIPT_LIMITS }) };
}
