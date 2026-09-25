import { useMemo, useRef, useState } from "react";
import { useAcpSession } from "./useAcpSession";
import { ACP_ZH_CN as text } from "../i18n/acp.zh-CN";
import { ACP_CONFIG_STORAGE_KEY, DEFAULT_ACP_CONFIG } from "../lib/defaults/acp";
import {
  createScriptPrompt,
  extractLuaDraft,
  parseAcpConfig,
  scriptDiff,
} from "../lib/script-assistance";
import { useOperations } from "../store/useOperations";
function savedConfig() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(ACP_CONFIG_STORAGE_KEY) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "executable" in value &&
      typeof value.executable === "string" &&
      "args" in value &&
      "timeoutSeconds" in value &&
      typeof value.timeoutSeconds === "number"
    )
      return parseAcpConfig(value.executable, JSON.stringify(value.args), value.timeoutSeconds);
  } catch {
    /* A stale config must never prevent offline script editing. */
  }
  return DEFAULT_ACP_CONFIG;
}

export function useScriptAssistant({
  source,
  documentId,
  includeDimensions,
  disabled,
  onSave,
}: {
  source: string;
  documentId: string;
  includeDimensions: boolean;
  disabled: boolean;
  onSave: (source: string) => Promise<boolean>;
}) {
  const [initial] = useState(savedConfig);
  const [executable, setExecutable] = useState(initial.executable);
  const [args, setArgs] = useState(JSON.stringify(initial.args));
  const [timeout, setTimeout] = useState(initial.timeoutSeconds);
  const [instruction, setInstruction] = useState("");
  const [candidate, setCandidate] = useState<{
    source: string;
    original: string;
    documentId: string;
    includeDimensions: boolean;
  } | null>(null);
  const session = useAcpSession();
  const saving = useRef(false);
  const busy = disabled || session.busy;
  const stale =
    !!candidate &&
    (candidate.original !== source ||
      candidate.documentId !== documentId ||
      candidate.includeDimensions !== includeDimensions);
  const diff = useMemo(
    () => (candidate ? scriptDiff(candidate.original, candidate.source) : []),
    [candidate],
  );
  const error = (error: unknown) => useOperations.getState().pushError(text.title, String(error));
  async function generate() {
    try {
      const config = parseAcpConfig(executable, args, timeout);
      const prompt = createScriptPrompt(source, instruction, includeDimensions);
      const original = { original: source, documentId, includeDimensions };
      const reply = await session.run(config, prompt);
      if (reply !== null) setCandidate({ ...original, source: extractLuaDraft(reply) });
    } catch (cause) {
      error(cause);
    }
  }
  async function save() {
    if (!candidate || stale || busy || saving.current) return;
    saving.current = true;
    try {
      if (await onSave(candidate.source)) setCandidate(null);
    } catch (cause) {
      error(cause);
    } finally {
      saving.current = false;
    }
  }
  return {
    executable,
    setExecutable,
    args,
    setArgs,
    timeout,
    setTimeout,
    instruction,
    setInstruction,
    candidate,
    setCandidate,
    session,
    busy,
    stale,
    diff,
    error,
    generate,
    save,
  };
}
