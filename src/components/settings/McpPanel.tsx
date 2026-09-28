import { useState } from "react";
import { mcpConfigure, mcpToken } from "../../lib/tauri-api";
import { MCP_ZH_CN as text } from "../../i18n/mcp.zh-CN";
import type { McpStatus } from "../../types/mcp";
import { confirmAction } from "../../lib/prompts";

export function McpPanel({
  status,
  error,
  children,
  onRevoke,
}: {
  status: McpStatus | null;
  error: string;
  children?: React.ReactNode;
  onRevoke?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("127.0.0.1");
  const [port, setPort] = useState(1421);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const button =
    "rounded border border-slate-600 px-3 py-1 text-xs hover:border-sky-400 focus-visible:outline focus-visible:outline-sky-400 disabled:opacity-40";
  const endpoint = status
    ? `http://${status.address.includes(":") ? `[${status.address}]` : status.address}:${status.port}/mcp`
    : "";
  async function configure(enabled: boolean, rotate = false) {
    if (rotate && !(await confirmAction(text.rotateConfirm))) return;
    onRevoke?.();
    setBusy(true);
    setMessage("");
    try {
      await mcpConfigure(enabled, address, port, rotate);
      setToken("");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      data-mcp-control
      className="relative z-40 shrink-0 border-b border-slate-700 bg-slate-900 text-slate-100"
      aria-label={text.title}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-3 px-3 py-1 text-xs">
        <span
          className={`h-2 w-2 rounded-full ${status?.running ? "bg-emerald-400" : "bg-amber-400"}`}
        />
        <span>{!status ? text.loading : status.running ? text.running : text.stopped}</span>
        <span className="text-slate-400">
          {status?.sessions.length ?? 0} · {text.connections}
        </span>
        {children ?? <span>{text.human}</span>}
        <button
          className={`${button} ml-auto`}
          onClick={() => {
            setAddress(status?.address ?? "127.0.0.1");
            setPort(status?.port ?? 1421);
            setToken("");
            setMessage("");
            setOpen(!open);
          }}
        >
          {open ? text.close : text.settings}
        </button>
      </div>
      {(error || status?.error) && (
        <p role="alert" className="px-3 pb-2 text-xs text-rose-300">
          {error || status?.error}
        </p>
      )}
      {open && (
        <div className="absolute right-2 top-full z-50 mt-2 max-h-[80vh] w-[min(560px,96vw)] space-y-4 overflow-auto rounded-lg border border-slate-600 bg-slate-900 p-4 shadow-2xl">
          <h2 className="text-base font-semibold">{text.title}</h2>
          <div>
            <p className="mb-1 text-xs text-slate-400">{text.endpoint}</p>
            <code className="break-all text-sm text-sky-300">{endpoint}</code>
          </div>
          <fieldset disabled={busy || !status} className="flex flex-wrap items-end gap-2">
            <label className="text-xs">
              {text.address}
              <select
                className="ml-2 rounded bg-slate-800 p-2"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              >
                <option>127.0.0.1</option>
                <option>::1</option>
              </select>
            </label>
            <label className="text-xs">
              {text.port}
              <input
                className="ml-2 w-24 rounded bg-slate-800 p-2"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </label>
            <button className={button} onClick={() => void configure(true)}>
              {status?.running ? text.apply : text.start}
            </button>
            <button className={button} onClick={() => void configure(false)}>
              {text.stop}
            </button>
          </fieldset>
          <div className="space-y-2 border-t border-slate-700 pt-3">
            <p className="text-xs text-slate-400">{text.tokenHint}</p>
            <div className="flex gap-2">
              <button
                className={button}
                disabled={busy}
                onClick={() =>
                  void mcpToken()
                    .then(setToken)
                    .catch((e) => setMessage(String(e)))
                }
              >
                {text.token}
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => void configure(status?.enabled ?? true, true)}
              >
                {text.rotate}
              </button>
            </div>
            {token && (
              <input
                aria-label={text.token}
                readOnly
                className="w-full rounded bg-slate-950 p-2 font-mono text-xs"
                value={token}
              />
            )}
          </div>
          {message && (
            <p role="status" className="text-xs text-amber-300">
              {message}
            </p>
          )}
          <div className="border-t border-slate-700 pt-3">
            <h3 className="mb-2 text-sm">{text.connections}</h3>
            {!status?.sessions.length ? (
              <p className="text-xs text-slate-400">{text.noConnections}</p>
            ) : (
              status.sessions.map((s) => (
                <p key={s.id} className="truncate text-xs">
                  {s.client} · {s.version} · {s.id.slice(0, 8)}
                </p>
              ))
            )}
          </div>
          <div className="border-t border-slate-700 pt-3">
            <h3 className="mb-2 text-sm">{text.audit}</h3>
            <div className="max-h-40 overflow-auto font-mono text-xs text-slate-400">
              {!status?.audit.length
                ? text.noAudit
                : [...status.audit].reverse().map((a, i) => (
                    <p key={i}>
                      {new Date(a.time).toLocaleTimeString()} · {a.session} · {a.tool} · {a.result}
                    </p>
                  ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
