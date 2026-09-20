import { Overlay } from "../overlay/Overlay";
import { useEffect } from "react";
import type { ImageFile } from "../../lib/tauri-api";
import { SHORTCUT_ACTIONS } from "../../lib/defaults/shortcuts";
import { shortcutKey } from "../../lib/shortcuts";
import { useShortcutStore } from "../../store/useShortcutStore";
import { IMAGE_DELETION_ZH_CN as text } from "../../i18n/image-deletion.zh-CN";

// 滚动累计位移超过该阈值才关闭菜单：轻微滚动（含触控板惯性起始）不再导致菜单闪关。
const SCROLL_CLOSE_PX = 16;

export function ImageListContextMenu({
  image,
  x,
  y,
  disabled,
  onDelete,
  onClose,
  actionLabel = text.deleteImage,
}: {
  actionLabel?: string;
  image: ImageFile;
  x: number;
  y: number;
  disabled: boolean;
  onDelete: (path: string) => void;
  onClose: () => void;
}) {
  const shortcuts = useShortcutStore((state) => state.shortcuts);
  const deleteImageAction = SHORTCUT_ACTIONS.find((action) => action.id === "deleteImage");
  const hint = deleteImageAction ? shortcutKey(deleteImageAction, shortcuts) : "";
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-image-list-menu]"))
        onClose();
    }
    // 与列表虚拟化联动的滚动关闭策略：按累计位移阈值关闭，快速滚动大距离仍即时关闭。
    let excess = 0;
    const lastTop = new Map<Element, number>();
    function onScroll(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const previous = lastTop.get(target);
      lastTop.set(target, target.scrollTop);
      if (previous === undefined) return;
      excess += Math.abs(target.scrollTop - previous);
      if (excess > SCROLL_CLOSE_PX) onClose();
    }
    window.addEventListener("mousedown", outside);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  return (
    <Overlay onClose={onClose} kind="light" role="menu" label={actionLabel} anchor={{ x, y }}>
      <div
        data-image-list-menu
        className="w-44 rounded-lg border border-slate-700 bg-slate-900 py-1 text-sm shadow-2xl"
      >
        <button
          role="menuitem"
          type="button"
          disabled={disabled}
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          onClick={() => {
            onClose();
            onDelete(image.path);
          }}
        >
          {actionLabel}
          {hint && <span className="text-xs font-normal text-slate-500">{hint}</span>}
        </button>
      </div>
    </Overlay>
  );
}
