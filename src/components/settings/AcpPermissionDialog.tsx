import { useState } from "react";
import type { AcpPermission } from "../../hooks/useAcpSession";
import { ACP_ZH_CN as text } from "../../i18n/acp.zh-CN";
import { Overlay } from "../overlay/Overlay";

export function AcpPermissionDialog({
  permission,
  respond,
}: {
  permission: AcpPermission;
  respond: (requestId: string, optionId: string | null) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  async function answer(optionId: string | null) {
    if (pending) return;
    setPending(true);
    try {
      await respond(permission.requestId, optionId);
    } finally {
      setPending(false);
    }
  }
  return (
    <Overlay label={text.permission} canDismiss={!pending} onClose={() => void answer(null)}>
      <section className="space-y-4 rounded-xl border border-slate-600 bg-slate-900 p-5 text-slate-100">
        <h2 className="font-semibold">{text.permission}</h2>
        <p className="break-words">{permission.title}</p>
        {permission.details != null && (
          <pre
            aria-label={text.permissionDetails}
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-3 text-xs"
          >
            {JSON.stringify(permission.details, null, 2)}
          </pre>
        )}
        <p className="text-sm text-slate-400">{text.permissionHint}</p>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={pending}
            onClick={() => void answer(null)}
            className="rounded border border-slate-500 px-3 py-2"
          >
            {text.deny}
          </button>
          {permission.options
            .filter((option) => option.kind === "allow_once")
            .map((option) => (
              <button
                key={option.optionId}
                disabled={pending}
                onClick={() => void answer(option.optionId)}
                className="rounded border border-amber-600 px-3 py-2 text-amber-200"
              >
                {text.allowOnce} · {option.name}
              </button>
            ))}
        </div>
      </section>
    </Overlay>
  );
}
