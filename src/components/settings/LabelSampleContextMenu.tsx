import { useEffect } from "react";
import { Overlay } from "../overlay/Overlay";
import { LABEL_SAMPLE_ZH_CN as text } from "../../i18n/label-sample.zh-CN";

/**
 * 样例图候选的右键菜单：跳转到该标注所在图片，或直接删除该条标注。
 * 只承载菜单本身，选中/删除的实际效果由调用方按当前候选执行。
 */
export function LabelSampleContextMenu({
  x,
  y,
  disabled,
  onJumpToImage,
  onDeleteAnnotation,
  onClose,
}: {
  x: number;
  y: number;
  disabled: boolean;
  onJumpToImage: () => void;
  onDeleteAnnotation: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    // 菜单锚定在卡片上，窗口失焦或尺寸变化后原锚点已不可信，直接关闭。
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return (
    <Overlay onClose={onClose} kind="light" role="menu" label={text.menuLabel} anchor={{ x, y }}>
      <div
        data-label-sample-menu
        className="w-44 rounded-lg border border-slate-700 bg-slate-900 py-1 text-sm shadow-2xl"
      >
        <button
          role="menuitem"
          type="button"
          disabled={disabled}
          className="flex w-full items-center px-3 py-2 text-left text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          onClick={() => {
            onClose();
            onJumpToImage();
          }}
        >
          {text.jumpToImage}
        </button>
        <button
          role="menuitem"
          type="button"
          disabled={disabled}
          className="flex w-full items-center px-3 py-2 text-left text-red-300 hover:bg-red-500/20 disabled:opacity-50"
          onClick={() => {
            onClose();
            onDeleteAnnotation();
          }}
        >
          {text.deleteAnnotation}
        </button>
      </div>
    </Overlay>
  );
}
