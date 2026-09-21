import { INTERACTION_ZH_CN as interactionText } from "../../i18n/interaction.zh-CN";
import { Overlay } from "../overlay/Overlay";
import { confirmAction } from "../../lib/prompts";
import { useEffect, useState } from "react";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutMap,
} from "../../lib/defaults/shortcuts";

type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
import type { InteractionMode } from "../canvas/types";
import type { HelpDisplaySettings, LabelDisplaySettings } from "../../lib/defaults/display";
import { formatShortcut, normalizeShortcutKey } from "../../lib/shortcut-utils";
import { detectConflicts, shortcutKey } from "../../lib/shortcuts";
import { SHORTCUT_ZH_CN as shortcutText } from "../../i18n/shortcuts.zh-CN";
import { PRELABEL_RESOURCE_ZH_CN as resourceText } from "../../i18n/prelabel-resource.zh-CN";
import { PrelabelResourceSettings } from "./PrelabelResourceSettings";
import { usePrelabelResourceStore } from "../../store/usePrelabelResourceStore";

interface ShortcutSettingsProps {
  helpDisplaySettings: HelpDisplaySettings;
  labelDisplaySettings: LabelDisplaySettings;
  labelShortcuts: string[];
  shortcuts: ShortcutMap;
  onChangeHelpDisplaySetting: (setting: keyof HelpDisplaySettings, visible: boolean) => void;
  onChangeLabelDisplaySetting: (mode: InteractionMode, visible: boolean) => void;
  onChangeShortcut: (changes: Partial<ShortcutMap>) => void;
  onClose: () => void;
}

export function ShortcutSettings({
  helpDisplaySettings,
  labelDisplaySettings,
  labelShortcuts,
  shortcuts,
  onChangeHelpDisplaySetting,
  onChangeLabelDisplaySetting,
  onChangeShortcut,
  onClose,
}: ShortcutSettingsProps) {
  const [recordingActionId, setRecordingActionId] = useState<ShortcutActionId | null>(null);
  const [recordError, setRecordError] = useState("");
  const [resourceDirty, setResourceDirty] = useState(false);
  const [resourceSaving, setResourceSaving] = useState(false);

  async function requestClose() {
    if (resourceSaving || usePrelabelResourceStore.getState().saving) return;
    if (resourceDirty && !(await confirmAction(resourceText.discard))) return;
    onClose();
  }

  useEffect(() => {
    if (!recordingActionId) {
      return;
    }

    const actionId = recordingActionId;

    function handleKeyDown(event: KeyboardEvent) {
      event.preventDefault();

      if (event.ctrlKey || event.altKey || event.metaKey || isModifierKey(event.key)) {
        setRecordError(shortcutText.singleKey);
        return;
      }

      const shortcut = normalizeShortcutKey(event.key);
      if (["Enter", " ", "Tab"].includes(shortcut)) {
        setRecordError(shortcutText.reserved);
        return;
      }
      const conflict = detectConflicts(
        { ...shortcuts, [actionId]: shortcut },
        labelShortcuts.map((key, index) => ({
          id: String(index),
          name: shortcutText.labelBinding(key),
          shortcut: key,
        })),
      ).find((item) => item.ids.includes(actionId));
      if (conflict) {
        setRecordError(conflict.message);
        return;
      }

      setRecordError("");
      onChangeShortcut({ [actionId]: shortcut });
      setRecordingActionId(null);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [labelShortcuts, onChangeShortcut, recordingActionId, shortcuts]);

  function applyRestoredShortcuts(changes: Partial<ShortcutMap>) {
    const conflict = detectConflicts(
      { ...shortcuts, ...changes },
      labelShortcuts.map((key, index) => ({
        id: String(index),
        name: shortcutText.labelBinding(key),
        shortcut: key,
      })),
    ).find((item) => item.ids.some((id) => Object.keys(changes).includes(id)));
    if (conflict) {
      setRecordError(conflict.message);
      return;
    }
    setRecordError("");
    onChangeShortcut(changes);
  }

  async function restoreDefault(action: ShortcutAction) {
    const current = formatShortcut(shortcutKey(action, shortcuts));
    const fallback = formatShortcut(action.defaultKey);
    if (current === fallback) return;
    if (
      !(await confirmAction(
        shortcutText.restoreDefaultConfirmation(action.label, current, fallback),
        {
          confirmLabel: shortcutText.restoreDefault,
        },
      ))
    )
      return;
    applyRestoredShortcuts({ [action.id]: action.defaultKey });
  }

  async function restoreAllDefaults() {
    const rebindable = SHORTCUT_ACTIONS.filter(
      (action) => action.rebindable && shortcutKey(action, shortcuts) !== action.defaultKey,
    );
    if (rebindable.length === 0) return;
    if (
      !(await confirmAction(shortcutText.restoreAllConfirmation(rebindable.length), {
        confirmLabel: shortcutText.restoreAllDefaults,
      }))
    )
      return;
    applyRestoredShortcuts(
      Object.fromEntries(rebindable.map((action) => [action.id, action.defaultKey])),
    );
  }

  const hasCustomized = SHORTCUT_ACTIONS.some(
    (action) => action.rebindable && shortcutKey(action, shortcuts) !== action.defaultKey,
  );

  return (
    <Overlay
      onClose={requestClose}
      label={interactionText.shortcuts}
      size="lg"
      canDismiss={() => {
        if (recordingActionId) {
          setRecordingActionId(null);
          return false;
        }
        return !resourceSaving;
      }}
    >
      <section className="scrollbar-dark max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-100">设置</h2>
            <p className="mt-1 text-xs text-slate-400">
              配置快捷键、画布提示，以及不同交互模式下是否显示框上的标签名。
            </p>
          </div>
          <button
            className="rounded border border-slate-700 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
            type="button"
            disabled={resourceSaving}
            onClick={() => void requestClose()}
          >
            关闭
          </button>
        </div>

        <PrelabelResourceSettings
          onDirtyChange={setResourceDirty}
          onSavingChange={setResourceSaving}
        />

        {recordError && (
          <p
            role="alert"
            className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-300"
          >
            {recordError}
          </p>
        )}

        <div className="mt-4 rounded border border-slate-800 p-3">
          <h3 className="text-sm font-medium text-slate-100">画布提示</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-sm text-slate-200">
              <input
                checked={helpDisplaySettings.showAnnotationCrosshairCursor}
                className="mt-1"
                type="checkbox"
                onChange={(event) =>
                  onChangeHelpDisplaySetting("showAnnotationCrosshairCursor", event.target.checked)
                }
              />
              <span>
                <span className="block">标注时使用十字光标</span>
                <span className="block text-xs text-slate-500">指向已有框时仍用普通选择</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-sm text-slate-200">
              <input
                checked={helpDisplaySettings.showAnnotationGuideLines}
                className="mt-1"
                type="checkbox"
                onChange={(event) =>
                  onChangeHelpDisplaySetting("showAnnotationGuideLines", event.target.checked)
                }
              />
              <span>
                <span className="block">显示十字辅助线</span>
                <span className="block text-xs text-slate-500">辅助对齐当前鼠标位置</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-sm text-slate-200">
              <input
                checked={helpDisplaySettings.showModeHelp}
                className="mt-1"
                type="checkbox"
                onChange={(event) =>
                  onChangeHelpDisplaySetting("showModeHelp", event.target.checked)
                }
              />
              <span>
                <span className="block">显示模式操作提示</span>
                <span className="block text-xs text-slate-500">画布左上角的操作说明</span>
              </span>
            </label>
            <label className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-sm text-slate-200">
              <input
                checked={helpDisplaySettings.showLabelShortcuts}
                className="mt-1"
                type="checkbox"
                onChange={(event) =>
                  onChangeHelpDisplaySetting("showLabelShortcuts", event.target.checked)
                }
              />
              <span>
                <span className="block">显示标签快捷键</span>
                <span className="block text-xs text-slate-500">如 1：人、Q：车</span>
              </span>
            </label>
          </div>
        </div>

        <div className="mt-4 rounded border border-slate-800 p-3">
          <h3 className="text-sm font-medium text-slate-100">标签名显示</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {LABEL_DISPLAY_OPTIONS.map((option) => (
              <label
                className="flex items-start gap-2 rounded border border-slate-800 bg-slate-950 p-2 text-sm text-slate-200"
                key={option.id}
              >
                <input
                  checked={labelDisplaySettings[option.id]}
                  className="mt-1"
                  type="checkbox"
                  onChange={(event) => onChangeLabelDisplaySetting(option.id, event.target.checked)}
                />
                <span>
                  <span className="block">{option.label}</span>
                  <span className="block text-xs text-slate-500">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 divide-y divide-slate-800 rounded border border-slate-800">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <h3 className="text-sm font-medium text-slate-100">快捷键</h3>
            {hasCustomized && (
              <button
                className="rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                type="button"
                onClick={() => void restoreAllDefaults()}
              >
                {shortcutText.restoreAllDefaults}
              </button>
            )}
          </div>
          {SHORTCUT_ACTIONS.map((action) => (
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-3" key={action.id}>
              <div>
                <p className="text-sm font-medium text-slate-100">{action.label}</p>
                <p className="text-xs text-slate-500">{action.description}</p>
                {detectConflicts(
                  shortcuts,
                  labelShortcuts.map((shortcut, index) => ({
                    id: String(index),
                    name: shortcutText.labelBinding(shortcut),
                    shortcut,
                  })),
                )
                  .filter((item) => item.ids.includes(action.id))
                  .map((item) => (
                    <p key={item.key} className="mt-1 text-xs text-amber-300">
                      {item.message}
                    </p>
                  ))}
              </div>
              <div className="flex items-center gap-2">
                <kbd className="rounded bg-slate-950 px-2 py-1 text-xs text-slate-200">
                  {recordingActionId === action.id
                    ? "按键中..."
                    : formatShortcut(shortcutKey(action, shortcuts))}
                </kbd>
                {action.rebindable && shortcutKey(action, shortcuts) !== action.defaultKey && (
                  <button
                    aria-label={`${shortcutText.restoreDefault}：${action.label}`}
                    className="rounded border border-slate-600 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                    title={shortcutText.restoreDefault}
                    type="button"
                    onClick={() => void restoreDefault(action)}
                  >
                    ↺
                  </button>
                )}
              </div>
              <button
                className="rounded bg-sky-500 px-3 py-1 text-sm font-medium text-white hover:bg-sky-400"
                type="button"
                disabled={!action.rebindable}
                onClick={() => setRecordingActionId(action.id)}
              >
                {action.rebindable ? "录制" : shortcutText.fixedShort}
              </button>
            </div>
          ))}
        </div>
      </section>
    </Overlay>
  );
}

const LABEL_DISPLAY_OPTIONS: Array<{
  id: InteractionMode;
  label: string;
  description: string;
}> = [
  { id: "default", label: "默认模式", description: "普通查看、选择与调整" },
  { id: "select", label: "选择模式", description: "按住 Shift 强制选择" },
  { id: "annotate", label: "标注模式", description: "按住 Ctrl 强制绘制" },
];

function isModifierKey(key: string): boolean {
  return ["Alt", "Control", "Meta", "Shift"].includes(key);
}
