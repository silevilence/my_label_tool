import { useEffect, useState } from "react";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutMap,
} from "../../lib/defaults/shortcuts";

interface ShortcutSettingsProps {
  labelShortcuts: string[];
  shortcuts: ShortcutMap;
  onChangeShortcut: (actionId: ShortcutActionId, shortcut: string) => void;
  onClose: () => void;
}

export function ShortcutSettings({
  labelShortcuts,
  shortcuts,
  onChangeShortcut,
  onClose,
}: ShortcutSettingsProps) {
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null);

  useEffect(() => {
    if (!recordingActionId) {
      return;
    }

    const actionId = recordingActionId;

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();

      if (event.key === "Escape") {
        setRecordingActionId(null);
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey || isModifierKey(event.key)) {
        window.alert("暂不支持组合键，请按单个按键。");
        return;
      }

      const shortcut = normalizeShortcutKey(event.key);
      const action = SHORTCUT_ACTIONS.find(
        (item) => item.id !== actionId && shortcuts[item.id] === shortcut,
      );
      if (action) {
        window.alert(`快捷键 ${formatShortcut(shortcut)} 已被「${action.label}」使用。`);
        return;
      }

      if (labelShortcuts.includes(shortcut)) {
        window.alert(`快捷键 ${formatShortcut(shortcut)} 已被标签使用。`);
        return;
      }

      onChangeShortcut(actionId, shortcut);
      setRecordingActionId(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [labelShortcuts, onChangeShortcut, recordingActionId, shortcuts]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4">
      <section className="w-full max-w-xl rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">快捷键配置</h2>
            <p className="mt-1 text-xs text-slate-400">点击“录制”，按下新按键完成改绑。</p>
          </div>
          <button
            className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            type="button"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="mt-4 divide-y divide-slate-800 rounded border border-slate-800">
          {SHORTCUT_ACTIONS.map((action) => (
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-3" key={action.id}>
              <div>
                <p className="text-sm font-medium text-slate-100">{action.label}</p>
                <p className="text-xs text-slate-500">{action.description}</p>
              </div>
              <kbd className="rounded bg-slate-950 px-2 py-1 text-xs text-slate-200">
                {recordingActionId === action.id
                  ? "按键中..."
                  : formatShortcut(shortcuts[action.id])}
              </kbd>
              <button
                className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400"
                type="button"
                onClick={() => setRecordingActionId(action.id)}
              >
                录制
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function normalizeShortcutKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

function formatShortcut(shortcut: string): string {
  if (shortcut === "ArrowLeft") {
    return "←";
  }
  if (shortcut === "ArrowRight") {
    return "→";
  }
  return shortcut.toUpperCase();
}

function isModifierKey(key: string): boolean {
  return ["Alt", "Control", "Meta", "Shift"].includes(key);
}
