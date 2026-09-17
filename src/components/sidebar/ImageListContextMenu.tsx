import { useEffect } from "react";
import type { ImageFile } from "../../lib/tauri-api";
import { IMAGE_DELETION_ZH_CN as text } from "../../i18n/image-deletion.zh-CN";

export function ImageListContextMenu({
  image,
  x,
  y,
  disabled,
  onDelete,
  onClose,
}: {
  image: ImageFile;
  x: number;
  y: number;
  disabled: boolean;
  onDelete: (path: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-image-list-menu]"))
        onClose();
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("mousedown", outside);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div
      role="menu"
      data-image-list-menu
      className="fixed z-50 w-44 rounded-lg border border-slate-700 bg-slate-900 py-1 text-sm shadow-2xl"
      style={{
        left: Math.max(8, Math.min(x, window.innerWidth - 184)),
        top: Math.max(8, Math.min(y, window.innerHeight - 52)),
      }}
    >
      <button
        role="menuitem"
        type="button"
        disabled={disabled}
        className="w-full px-3 py-2 text-left text-red-300 hover:bg-red-500/20 disabled:opacity-50"
        onClick={() => {
          onClose();
          onDelete(image.path);
        }}
      >
        {text.deleteImage}
      </button>
    </div>
  );
}
