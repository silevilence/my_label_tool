import { Overlay } from "../overlay/Overlay";
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
  useEffect(() => {
    function outside(event: MouseEvent) {
      if (!(event.target instanceof Element) || !event.target.closest("[data-image-list-menu]"))
        onClose();
    }
    window.addEventListener("mousedown", outside);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("mousedown", outside);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
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
          className="w-full px-3 py-2 text-left text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          onClick={() => {
            onClose();
            onDelete(image.path);
          }}
        >
          {actionLabel}
        </button>
      </div>
    </Overlay>
  );
}
