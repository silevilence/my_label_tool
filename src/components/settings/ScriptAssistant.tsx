import { ACP_ZH_CN as text } from "../../i18n/acp.zh-CN";
import { ACP_CONFIG_STORAGE_KEY } from "../../lib/defaults/acp";
import { parseAcpConfig } from "../../lib/script-assistance";
import { useOperations } from "../../store/useOperations";
import type { useScriptAssistant } from "../../hooks/useScriptAssistant";
import { AcpPermissionDialog } from "./AcpPermissionDialog";
import { LuaEditor } from "./LuaEditor";

export function ScriptAssistant({
  assistant,
}: {
  assistant: ReturnType<typeof useScriptAssistant>;
}) {
  const {
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
  } = assistant;
  return (
    <details className="rounded-lg border border-slate-600 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-sky-300">{text.title}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-400">{text.contextHint}</p>
        <p className="text-xs text-amber-200/80">{text.trustHint}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            {text.executable}
            <input
              aria-label={text.executable}
              disabled={busy}
              value={executable}
              onChange={(event) => setExecutable(event.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2"
            />
          </label>
          <label>
            {text.arguments}
            <input
              aria-label={text.arguments}
              disabled={busy}
              value={args}
              onChange={(event) => setArgs(event.target.value)}
              className="mt-1 w-full rounded border border-slate-600 bg-slate-950 p-2 font-mono"
            />
          </label>
          <label>
            {text.timeout}
            <input
              aria-label={text.timeout}
              type="number"
              min={1}
              max={600}
              disabled={busy}
              value={timeout}
              onChange={(event) => setTimeout(Number(event.target.value))}
              className="ml-3 w-24 rounded border border-slate-600 bg-slate-950 p-2"
            />
          </label>
          <button
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-2"
            onClick={() => {
              try {
                localStorage.setItem(
                  ACP_CONFIG_STORAGE_KEY,
                  JSON.stringify(parseAcpConfig(executable, args, timeout)),
                );
                useOperations
                  .getState()
                  .begin({ label: text.saveConfig, resource: "acp-agent" })
                  .complete(text.configSaved);
              } catch (cause) {
                error(cause);
              }
            }}
          >
            {text.saveConfig}
          </button>
        </div>
        <p className="text-xs text-slate-400">{text.configHint}</p>
        <label className="block">
          {text.instruction}
          <textarea
            aria-label={text.instruction}
            disabled={busy}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder={text.instructionExample}
            className="mt-1 min-h-20 w-full rounded border border-slate-600 bg-slate-950 p-2"
          />
        </label>
        <div className="flex gap-3">
          <button
            disabled={busy || !instruction.trim() || !executable.trim()}
            onClick={() => void generate()}
            className="rounded bg-sky-600 px-3 py-2 disabled:opacity-40"
          >
            {text.generate}
          </button>
          {session.busy && (
            <button
              onClick={() => void session.cancel()}
              className="rounded border border-rose-600 px-3 py-2"
            >
              {text.cancel}
            </button>
          )}
        </div>
        {session.reply && (
          <pre
            aria-label={text.reply}
            className="max-h-44 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs"
          >
            {session.reply}
          </pre>
        )}
        {candidate && (
          <section className="space-y-3 border-t border-slate-700 pt-3" aria-label={text.draft}>
            <h3 className="font-medium">{text.draft}</h3>
            {stale && (
              <p role="alert" className="text-amber-300">
                {text.stale}
              </p>
            )}
            <LuaEditor
              value={candidate.source}
              disabled={busy}
              onChange={(source) =>
                setCandidate((current) => (current ? { ...current, source } : null))
              }
            />
            <pre
              aria-label={text.diff}
              className="max-h-56 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-3 text-xs"
            >
              {diff.map((part, index) => (
                <span
                  key={index}
                  className={
                    part.kind === "added"
                      ? "block text-emerald-300"
                      : part.kind === "removed"
                        ? "block text-rose-300"
                        : "block text-slate-400"
                  }
                >
                  {part.kind === "added" ? "+ " : part.kind === "removed" ? "− " : "  "}
                  {part.line}
                  {"\n"}
                </span>
              ))}
            </pre>
            <div className="flex gap-3">
              <button
                disabled={busy || stale}
                onClick={() => void save()}
                className="rounded border border-sky-500 px-3 py-2 disabled:opacity-40"
              >
                {text.saveDraft}
              </button>
              <button
                disabled={busy}
                onClick={() => setCandidate(null)}
                className="rounded border border-slate-600 px-3 py-2"
              >
                {text.discardDraft}
              </button>
            </div>
          </section>
        )}
      </div>
      {session.permissions[0] && (
        <AcpPermissionDialog
          key={session.permissions[0].requestId}
          permission={session.permissions[0]}
          respond={session.respond}
        />
      )}
    </details>
  );
}
