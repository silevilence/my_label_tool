import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useAnnotationStore } from "../../store/useAnnotationStore";
import { SELECTION_ZH_CN as text } from "../../i18n/selection.zh-CN";

// 选中行的滚动定位由列表容器按索引计算 scrollTop 完成（配合窗口化虚拟渲染），
// 行组件自身不再调用 scrollIntoView。
export function ImageListRow({
  selected,
  leading,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean; leading?: ReactNode }) {
  return (
    <button {...props} aria-current={selected ? "true" : undefined}>
      {leading}
      {children}
    </button>
  );
}

export function ScopeBar() {
  const stack = useAnnotationStore((state) => state.scopeStack);
  const popScope = useAnnotationStore((state) => state.popScope);
  const scope = stack[stack.length - 1];
  return (
    <div
      aria-label={text.scope}
      aria-live="polite"
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
