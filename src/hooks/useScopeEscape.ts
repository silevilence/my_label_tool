import { useEffect } from "react";
import { isEditableTarget } from "../lib/app-utils";
import { useAnnotationStore } from "../store/useAnnotationStore";
import { useOverlayStore } from "../store/useOverlayStore";

// Esc 退出当前作用域（搜索结果 / 视频帧范围）回到项目序；
// 门禁与草稿键盘一致：可编辑焦点或任何遮罩（含搜索弹窗自身）打开时不抢 Esc，
// 弹窗的 Esc 优先走 Overlay 自己的关闭逻辑。
export function useScopeEscape() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.repeat) return;
      if (
        isEditableTarget(event.target) ||
        useOverlayStore.getState().depth() > 0 ||
        useAnnotationStore.getState().scopeStack.length <= 1
      )
        return;
      event.preventDefault();
      useAnnotationStore.getState().popScope();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
