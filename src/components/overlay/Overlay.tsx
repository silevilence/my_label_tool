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
  ':is(button, input, select, textarea, a[href], [tabindex]):not(:disabled):not([tabindex="-1"])';

interface OverlayProps {
  open?: boolean;
  onClose: () => void;
  kind?: OverlayKind;
  canDismiss?: boolean | (() => boolean);
  labelledBy?: string;
  label?: string;
  size?: keyof typeof sizes;
  role?: "dialog" | "alertdialog" | "menu";
  pointerOnly?: boolean;
  anchor?: { x: number; y: number };
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
  label,
  size = "md",
  role = "dialog",
  pointerOnly = false,
  anchor,
  children,
}: Omit<OverlayProps, "open">) {
  const id = useId();
  const parentId = useContext(ParentOverlay);
  const panel = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, canDismiss, pointerOnly });
  latest.current = { onClose, canDismiss, pointerOnly };
  const stack = useOverlayStore((state) => state.stack);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const store = useOverlayStore.getState();
    store.register({ id, parentId, kind });
    const isTop = () => useOverlayStore.getState().stack.slice(-1)[0]?.id === id;
    const focusFirst = () =>
      (panel.current?.querySelector<HTMLElement>(focusable) ?? panel.current)?.focus();
    if (isTop()) focusFirst();
    function key(event: KeyboardEvent) {
      if (!isTop()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        const allowed = latest.current.canDismiss;
        if (event.type === "keydown" && (typeof allowed === "function" ? allowed() : allowed))
          latest.current.onClose();
      } else if (event.key === "Tab" && kind === "blocking" && event.type === "keydown") {
        const elements = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []);
        const index = elements.indexOf(document.activeElement as HTMLElement);
        event.preventDefault();
        const next =
          index < 0
            ? event.shiftKey
              ? elements.length - 1
              : 0
            : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
        (elements[next] ?? panel.current)?.focus();
      } else if (latest.current.pointerOnly) {
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
    document.addEventListener("focusin", focus);
    return () => {
      const wasTop = isTop();
      store.unregister(id);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", key, true);
      document.removeEventListener("focusin", focus);
      if (wasTop && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [id, parentId, kind]);

  const anchored = anchor !== undefined;
  return createPortal(
    <ParentOverlay.Provider value={id}>
      <div
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
          aria-label={label}
          className={`pointer-events-auto max-h-[calc(100dvh-2rem)] overflow-y-auto outline-none [&>section]:mx-auto ${anchored ? "absolute" : `w-full ${sizes[size]}`}`}
          style={
            anchor
              ? {
                  left: Math.max(8, Math.min(anchor.x, window.innerWidth - 184)),
                  top: Math.max(8, Math.min(anchor.y, window.innerHeight / 2)),
                  maxHeight:
                    window.innerHeight -
                    Math.max(8, Math.min(anchor.y, window.innerHeight / 2)) -
                    16,
                }
              : undefined
          }
          onContextMenu={(event) => event.preventDefault()}
        >
          {children}
        </div>
      </div>
    </ParentOverlay.Provider>,
    document.body,
  );
}
