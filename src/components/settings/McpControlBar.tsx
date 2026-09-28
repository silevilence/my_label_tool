import { useEffect, useState } from "react";
import type { McpController } from "../../lib/mcp-controller";
import type { McpControlState, McpPermission } from "../../types/mcp";
import { MCP_ZH_CN as text } from "../../i18n/mcp.zh-CN";
import { MCP_LIMITS } from "../../lib/defaults/mcp";
import { selectExportFolder } from "../../lib/tauri-api";

export function McpControlBar({
  controller,
  state,
}: {
  controller: McpController;
  state: McpControlState;
}) {
  const [minutes, setMinutes] = useState<number>(MCP_LIMITS.lockMinutes);
  const [error, setError] = useState("");
  const [excluded, setExcluded] = useState<McpPermission[]>([]);
  const [directory, setDirectory] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const button =
    "rounded border border-slate-600 px-2 py-1 hover:border-sky-400 focus-visible:outline focus-visible:outline-sky-400";
  function perform(action: () => void) {
    try {
      action();
      setError("");
    } catch (error) {
      setError(String(error));
    }
  }
  const seconds = Math.max(0, Math.ceil((state.expiresAt - now) / 1000));
  return (
    <div className="flex flex-wrap items-center gap-2" data-mcp-control>
      <span role="status" className={state.mode === "mcp" ? "text-amber-300" : "text-slate-300"}>
        {state.mode === "human"
          ? text.human
          : state.mode === "pending"
            ? text.pending
            : state.mode === "locked"
              ? text.locked
              : `${text.remote} · ${state.client}`}
        {state.mode !== "human" && ` · ${text.remaining} ${seconds}s`}
      </span>
      {state.mode === "pending" && (
        <>
          {state.permissions.includes("save") && (
            <span
              className="max-w-72 truncate"
              title={controller.context().activeProjectConfig?.annotationPath}
            >
              {text.saveTarget}:{" "}
              {controller.context().activeProjectConfig?.annotationPath ?? text.saveRequired}
            </span>
          )}
          {state.permissions.includes("export") && (
            <button
              className={button}
              title={directory}
              onClick={() => {
                const request = controller.control.state;
                void selectExportFolder()
                  .then((path) => {
                    if (path && controller.control.state === request) {
                      controller.exportDirectory = path;
                      setDirectory(path);
                    }
                  })
                  .catch((error) => setError(String(error)));
              }}
            >
              {text.exportDirectory}
              {controller.exportDirectory ? ` · ${controller.exportDirectory}` : ""}
            </button>
          )}
          <span className="max-w-40 truncate">{state.client}</span>
          {state.permissions.map((permission) => (
            <label className="flex items-center gap-1" key={permission}>
              <input
                type="checkbox"
                checked={!excluded.includes(permission)}
                onChange={(e) =>
                  setExcluded(
                    e.target.checked
                      ? excluded.filter((p) => p !== permission)
                      : [...excluded, permission],
                  )
                }
              />
              {text.permissions[permission]}
            </label>
          ))}
          <button
            className={`${button} border-emerald-600`}
            onClick={() =>
              perform(() =>
                controller.approve(state.permissions.filter((p) => !excluded.includes(p))),
              )
            }
          >
            {text.approve}
          </button>
          <button className={button} onClick={() => controller.control.revoke("CONTROL_DENIED")}>
            {text.reject}
          </button>
        </>
      )}
      {state.mode === "mcp" && (
        <button
          className={`${button} border-amber-400 font-semibold text-amber-200`}
          onClick={() => controller.control.revoke()}
        >
          {text.reclaim}
        </button>
      )}
      {state.mode === "locked" ? (
        <button className={button} onClick={() => controller.control.revoke()}>
          {text.unlock}
        </button>
      ) : (
        <>
          <input
            aria-label={text.minutes}
            className="w-14 rounded bg-slate-800 px-1 py-1"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
          <button
            className={button}
            onClick={() => perform(() => controller.control.lock(minutes))}
          >
            {text.lock}
          </button>
        </>
      )}
      {error && (
        <span role="alert" className="text-rose-300">
          {error}
        </span>
      )}
    </div>
  );
}
