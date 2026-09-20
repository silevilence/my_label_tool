import { useEffect, useRef, type ButtonHTMLAttributes } from "react";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { SELECTION_ZH_CN as text } from "../../i18n/selection.zh-CN";

export function ImageListRow({
  selected,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return <button {...props} ref={ref} aria-current={selected ? "true" : undefined} />;
}

export function ScopeBar() {
  const stack = useAnnotationStore((state) => state.scopeStack);
  const popScope = useAnnotationStore((state) => state.popScope);
  const scope = stack[stack.length - 1];
  return (
    <div
      aria-label={text.scope}
      className="sticky top-0 z-10 mb-2 flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-sky-200"
    >
      <span
        className="min-w-0 flex-1 truncate"
        title={scope.kind === "project" ? text.project : scope.label}
      >
        {scope.kind === "project" ? text.project : scope.label}
      </span>
      {scope.kind !== "project" && (
        <button
          type="button"
          aria-label={text.exit}
          title={text.exit}
          onClick={popScope}
          className="rounded px-2 py-1 hover:bg-slate-700"
        >
          ×
        </button>
      )}
    </div>
  );
}
