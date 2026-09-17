import { useEffect, useRef, useState } from "react";
import type { ImageDeletionTarget } from "../hooks/useImageDeletion";
import { IMAGE_DELETION_ZH_CN as text } from "../i18n/image-deletion.zh-CN";

export function DeleteImageDialog({
  target,
  annotationCount,
  isDeleting,
  error,
  onCancel,
  onConfirm,
}: {
  target: ImageDeletionTarget;
  annotationCount: number;
  isDeleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [remaining, setRemaining] = useState(3);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const callbacks = useRef({ onCancel, isDeleting });
  callbacks.current = { onCancel, isDeleting };

  useEffect(() => {
    const previousFocus = document.activeElement;
    cancelRef.current?.focus();
    const timer = window.setInterval(() => {
      setRemaining(Math.max(0, Math.ceil((target.readyAt - Date.now()) / 1000)));
    }, 100);
    function blockKeys(event: KeyboardEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type !== "keydown" || callbacks.current.isDeleting) return;
      if (event.key === "Escape") callbacks.current.onCancel();
      if (event.key === "Tab") {
        const next =
          document.activeElement === cancelRef.current && !confirmRef.current?.disabled
            ? confirmRef.current
            : cancelRef.current;
        next?.focus();
      }
    }
    window.addEventListener("keydown", blockKeys, true);
    window.addEventListener("keyup", blockKeys, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("keydown", blockKeys, true);
      window.removeEventListener("keyup", blockKeys, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [target.readyAt]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4"
      onContextMenu={(event) => event.preventDefault()}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-image-title"
        aria-describedby="delete-image-description"
        aria-busy={isDeleting}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-red-500/60 bg-slate-900 p-6 text-slate-100 shadow-2xl"
      >
        <h2 id="delete-image-title" className="text-lg font-semibold text-red-300">
          {text.title}
        </h2>
        <p className="mt-4 break-all font-semibold" title={target.image.path}>
          {target.image.name}
        </p>
        <p className="mt-1 break-all text-xs text-slate-400">{target.image.path}</p>
        <p id="delete-image-description" className="mt-4 text-sm leading-6 text-slate-300">
          {text.consequence}
        </p>
        {annotationCount > 0 && (
          <p className="mt-3 text-sm text-amber-300">{text.annotationCount(annotationCount)}</p>
        )}
        <p className="mt-3 text-xs text-slate-400">{text.pointerOnly}</p>
        {error && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            disabled={isDeleting}
            onClick={onCancel}
            className="rounded border border-slate-600 px-4 py-2 text-sm hover:bg-slate-800 disabled:opacity-50"
          >
            {text.cancel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            disabled={remaining > 0 || isDeleting}
            onClick={(event) => {
              // Keyboard/programmatic activation has detail=0. Only a pointer click can confirm.
              if (event.detail > 0 && Date.now() >= target.readyAt) onConfirm();
            }}
            className="rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isDeleting ? text.deleting : remaining > 0 ? text.countdown(remaining) : text.confirm}
          </button>
        </div>
      </section>
    </div>
  );
}
