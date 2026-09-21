import { createContext, useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayStore, type OverlayKind } from "../../store/useOverlayStore";

const ParentOverlay = createContext<string | null>(null);
const sizes = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-xl",
  xl: "max-w-3xl",
  wide: "max-w-5xl",
};
const focusable =
  ':is(button, input:not([type="hidden"]), select, textarea, a[href], summary, [tabindex]):not(:disabled):not([tabindex="-1"])';

function focusTargets(panel: HTMLElement | null): HTMLElement[] {
  return Array.from(panel?.querySelectorAll<HTMLElement>(focusable) ?? []).filter((element) => {
    for (
      let node: HTMLElement | null = element;
      node && node !== panel;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (
        node.hidden ||
        node.hasAttribute("inert") ||
        style.display === "none" ||
        style.visibility === "hidden"
      )
        return false;
      if (
        node instanceof HTMLDetailsElement &&
        !node.open &&
        !node.querySelector("summary")?.contains(element)
      )
        return false;
    }
    return true;
  });
}

interface OverlayProps {
  open?: boolean;
  onClose: () => void;
  kind?: OverlayKind;
  canDismiss?: boolean | (() => boolean);
  labelledBy?: string;
  describedBy?: string;
  label?: string;
  size?: keyof typeof sizes;
  role?: "dialog" | "alertdialog" | "menu";
  pointerOnly?: boolean;
  anchor?: { x: number; y: number };
  /** 居中遮罩对话框：点击背板（面板外）触发 onClose；锚定菜单默认即支持。 */
  closeOnBackdrop?: boolean;
  /** 将单一操作状态区置于当前工作弹窗内，保持反馈可见及按钮可聚焦。 */
  operationFeedback?: boolean;
  children: ReactNode;
}

export function Overlay({ open = true, ...props }: OverlayProps) {
  return open ? <MountedOverlay {...props} /> : null;
}

function MountedOverlay({
  onClose,
  kind = "blocking",
  canDismiss = true,
  labelledBy,
  describedBy,
  label,
  size = "md",
  role = "dialog",
  pointerOnly = false,
  anchor,
  closeOnBackdrop = false,
  operationFeedback = false,
  children,
}: Omit<OverlayProps, "open">) {
  const id = useId();
  const parentId = useContext(ParentOverlay);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, canDismiss, pointerOnly });
  latest.current = { onClose, canDismiss, pointerOnly };
  const stack = useOverlayStore((state) => state.stack);
  const anchored = anchor !== undefined;
  const anchorX = anchor?.x,
    anchorY = anchor?.y;
  useLayoutEffect(() => {
    if (anchorX === undefined || anchorY === undefined || !panel.current) return;
    const position = () => {
      const element = panel.current;
      if (!element) return;
      element.style.maxWidth = `${Math.max(0, window.innerWidth - 16)}px`;
      element.style.maxHeight = `${Math.max(0, window.innerHeight - 16)}px`;
      const { width, height } = element.getBoundingClientRect();
      element.style.left = `${Math.max(8, Math.min(anchorX, window.innerWidth - width - 8))}px`;
      element.style.top = `${Math.max(8, Math.min(anchorY, window.innerHeight - height - 8))}px`;
    };
    position();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(position);
    observer?.observe(panel.current);
    window.addEventListener("resize", position);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [anchorX, anchorY]);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const store = useOverlayStore.getState();
    store.register({ id, parentId, kind });
    const isTop = () => useOverlayStore.getState().stack.slice(-1)[0]?.id === id;
    const focusFirst = () => (focusTargets(panel.current)[0] ?? panel.current)?.focus();
    if (isTop() && !panel.current?.contains(document.activeElement)) focusFirst();
    function key(event: KeyboardEvent) {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const allowed = latest.current.canDismiss;
        if (event.type === "keydown" && (typeof allowed === "function" ? allowed() : allowed))
          latest.current.onClose();
      } else if (event.key === "Tab" && kind === "blocking" && event.type === "keydown") {
        const elements = focusTargets(panel.current);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next =
          index < 0
            ? event.shiftKey
              ? elements.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
        (elements[next] ?? panel.current)?.focus();
      } else if (
        latest.current.pointerOnly &&
        !(event.type === "keyup" && ["Control", "Shift", "Alt", "Meta"].includes(event.key))
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }
    function focus(event: FocusEvent) {
      if (kind === "blocking" && isTop() && !panel.current?.contains(event.target as Node))
        focusFirst();
    }
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", key, true);
    function outside(event: PointerEvent) {
      if (!isTop() || panel.current?.contains(event.target as Node)) return;
      // 锚定菜单（light）点击外部即关；居中对话框需显式声明 closeOnBackdrop。
      const allowed = latest.current.canDismiss;
      if (
        (anchored ? kind === "light" : closeOnBackdrop) &&
        (typeof allowed === "function" ? allowed() : allowed)
      )
        latest.current.onClose();
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", focus);
    return () => {
      const wasTop = isTop();
      store.unregister(id);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("pointerdown", outside);
      if (wasTop && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [id, parentId, kind, anchored, closeOnBackdrop]);

  return createPortal(
    <ParentOverlay.Provider value={id}>
      <div
        onContextMenu={(event) => event.preventDefault()}
        className={
          anchored
            ? "pointer-events-none fixed inset-0"
            : "fixed inset-0 flex items-center justify-center bg-slate-950/70 p-4"
        }
        style={{
          zIndex:
            100 +
            Math.max(
              0,
              stack.findIndex((entry) => entry.id === id),
            ),
        }}
      >
        <div
          ref={panel}
          tabIndex={-1}
          role={role}
          aria-modal={kind === "blocking" ? true : undefined}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-label={label}
          className={`pointer-events-auto max-h-[calc(100dvh-2rem)] overflow-y-auto outline-none [&>section]:mx-auto ${anchored ? "absolute" : `w-full ${sizes[size]}`}`}
          style={
            anchor
              ? {
                  left: anchor.x,
                  top: anchor.y,
                  maxHeight: window.innerHeight - 16,
                  maxWidth: window.innerWidth - 16,
                }
              : undefined
          }
          onContextMenu={(event) => event.preventDefault()}
        >
          {children}
          {operationFeedback && <div data-operation-feedback={id} />}
        </div>
      </div>
    </ParentOverlay.Provider>,
    document.body,
  );
}
