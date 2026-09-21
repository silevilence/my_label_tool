import { useEffect, useRef, useState } from "react";
import { Overlay } from "./Overlay";
import { usePromptStore, type ConfirmRequest, type PromptRequest } from "../../lib/prompts";
import { PROMPTS_ZH_CN as text } from "../../i18n/prompts.zh-CN";

// 应用内「确认」与「命名输入」原语的宿主：挂在 App 根部一次，
// 任意模块（含非组件调用点）经 lib/prompts 的请求函数触发。
export function PromptHost() {
  const confirm = usePromptStore((state) => state.confirmQueue[0] ?? null);
  const prompt = usePromptStore((state) => state.promptQueue[0] ?? null);
  return (
    <>
      {confirm && <ConfirmCard key={confirm.title + (confirm.message ?? "")} request={confirm} />}
      {prompt && <PromptCard key={prompt.title} request={prompt} />}
    </>
  );
}

function ConfirmCard({ request }: { request: ConfirmRequest }) {
  const settleConfirm = usePromptStore((state) => state.settleConfirm);
  return (
    <Overlay
      kind="blocking"
      role="alertdialog"
      label={request.title}
      onClose={() => settleConfirm(false)}
    >
      <section className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
        <h2 className="text-base font-semibold">{request.title}</h2>
        {request.message && (
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">
            {request.message}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={() => settleConfirm(false)}
          >
            {request.cancelLabel ?? text.cancel}
          </button>
          <button
            type="button"
            autoFocus
            className={`rounded px-3 py-1.5 text-sm text-white ${
              request.danger ? "bg-red-600 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"
            }`}
            onClick={() => settleConfirm(true)}
          >
            {request.confirmLabel ?? text.confirm}
          </button>
        </div>
      </section>
    </Overlay>
  );
}

function PromptCard({ request }: { request: PromptRequest }) {
  const settlePrompt = usePromptStore((state) => state.settlePrompt);
  const [value, setValue] = useState(request.initial ?? "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.select();
    setValue(request.initial ?? "");
  }, [request]);
  function submit() {
    const trimmed = value.trim();
    if (!trimmed) return;
    settlePrompt(trimmed);
  }
  return (
    <Overlay kind="blocking" label={request.title} onClose={() => settlePrompt(null)}>
      <section className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-slate-100 shadow-2xl">
        <h2 className="text-base font-semibold">{request.title}</h2>
        {request.message && (
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{request.message}</p>
        )}
        <input
          ref={inputRef}
          aria-label={request.title}
          className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          value={value}
          placeholder={request.placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            onClick={() => settlePrompt(null)}
          >
            {text.cancel}
          </button>
          <button
            type="button"
            className="rounded bg-sky-600 px-3 py-1.5 text-sm text-white hover:bg-sky-500 disabled:opacity-40"
            disabled={!value.trim()}
            onClick={submit}
          >
            {request.confirmLabel ?? text.confirm}
          </button>
        </div>
      </section>
    </Overlay>
  );
}
