import { SHORTCUT_ACTIONS, type ShortcutMap } from "./defaults/shortcuts";
import { normalizeShortcutKey } from "./shortcut-utils";
import { SHORTCUT_ZH_CN as text } from "../i18n/shortcuts.zh-CN";

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
  return `${event.ctrlKey || event.metaKey ? "Ctrl+" : ""}${event.altKey ? "Alt+" : ""}${event.shiftKey && event.key.length > 1 ? "Shift+" : ""}${normalizeShortcutKey(event.key)}`;
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
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      ids: group.map((entry) => entry.id),
      message: text.conflict(
        key,
        group.map((entry) => entry.label),
      ),
    }));
}
export function resolveShortcut(event: ShortcutEvent, ctx: ShortcutContext): string | null {
  if (ctx.hasBlockingOverlay || ctx.isEditableTarget) return null;
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
  if (ctx.hasLightOverlay || ctx.busy) return null;
  const label = ctx.labelShortcuts.find(
    (item) =>
      normalizeShortcutKey(item.shortcut ?? "") === key &&
      ctx.available.includes(`label:${item.id}`),
  );
  return label ? `label:${label.id}` : null;
}
