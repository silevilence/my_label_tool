import { SHORTCUT_ACTIONS, type ShortcutMap } from "./defaults/shortcuts";
import { normalizeLabelShortcut, normalizeShortcutKey } from "./shortcut-utils";
import { SHORTCUT_ZH_CN as text } from "../i18n/shortcuts.zh-CN";
import { isReservedReloadBinding } from "./reload-shortcuts";
import { RECOVERY_TEXT as recoveryText } from "../i18n/recovery.zh-CN";

export interface ShortcutActionMeta {
  id: string;
  label: string;
  defaultKey: string;
  scope: "canvas" | "global";
  rebindable: boolean;
  priority?: number;
}
export interface LabelShortcut {
  id: string;
  name: string;
  shortcut?: string;
}
export interface ShortcutEvent {
  code?: string;
  isComposing?: boolean;
  keyCode?: number;
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  repeat?: boolean;
}
export interface ShortcutContext {
  hasBlockingOverlay: boolean;
  hasLightOverlay: boolean;
  isEditableTarget: boolean;
  busy: boolean;
  shortcuts: Partial<ShortcutMap>;
  labelShortcuts: LabelShortcut[];
  available: readonly string[];
  actions?: readonly ShortcutActionMeta[];
}
export function eventShortcut(event: ShortcutEvent): string {
  // Shift+1 is reported as ! on common keyboards; recover the digit from code.
  const key =
    event.shiftKey && /^Digit[0-9]$/.test(event.code ?? "") ? event.code!.slice(5) : event.key;
  const shift = event.shiftKey && (key.length > 1 || /^[a-z0-9]$/i.test(key));
  return `${event.ctrlKey || event.metaKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${shift ? "Shift+" : ""}${normalizeShortcutKey(key)}`;
}
export function shortcutKey(
  action: ShortcutActionMeta,
  shortcuts: Partial<Record<string, string>>,
): string {
  return normalizeShortcutKey(
    action.rebindable ? (shortcuts[action.id] ?? action.defaultKey) : action.defaultKey,
  );
}
export function detectConflicts(
  shortcuts: Partial<ShortcutMap>,
  labels: LabelShortcut[],
  actions: readonly ShortcutActionMeta[] = SHORTCUT_ACTIONS,
) {
  const entries = [
    ...actions.map((action) => ({
      id: action.id,
      label: action.label,
      key: shortcutKey(action, shortcuts),
    })),
    ...labels.map((label) => ({
      id: `label:${label.id}`,
      label: label.name,
      key: label.shortcut ?? "",
    })),
  ];
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = normalizeShortcutKey(entry.key);
    if (key) groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.entries()]
    .filter(([key, group]) => group.length > 1 || isReservedReloadBinding(key))
    .map(([key, group]) => ({
      key,
      ids: group.map((entry) => entry.id),
      message: isReservedReloadBinding(key)
        ? recoveryText.reservedShortcut(key)
        : text.conflict(
            key,
            group.map((entry) => entry.label),
          ),
    }));
}
export function resolveShortcut(event: ShortcutEvent, ctx: ShortcutContext): string | null {
  if (ctx.hasBlockingOverlay || ctx.isEditableTarget || event.isComposing || event.keyCode === 229)
    return null;
  const key = eventShortcut(event);
  const actions = (ctx.actions ?? SHORTCUT_ACTIONS)
    .filter(
      (action) =>
        ctx.available.includes(action.id) &&
        shortcutKey(action, ctx.shortcuts) === key &&
        !(action.scope === "canvas" && (ctx.hasLightOverlay || ctx.busy)),
    )
    .sort(
      (a, b) =>
        (a.scope === b.scope ? 0 : a.scope === "canvas" ? -1 : 1) ||
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.id.localeCompare(b.id),
    );
  if (actions[0]) return actions[0].id;
  if (ctx.hasLightOverlay || ctx.busy || event.repeat || event.metaKey) return null;
  const label = ctx.labelShortcuts.find(
    (item) =>
      normalizeLabelShortcut(item.shortcut ?? "") === key &&
      ctx.available.includes(`label:${item.id}`),
  );
  return label ? `label:${label.id}` : null;
}
