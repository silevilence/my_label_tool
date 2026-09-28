import type { Completion } from "@codemirror/autocomplete";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import { SCRIPT_COMMANDS } from "./script-commands";

// Editor hints only; the existing domain types keep field names in sync.
// No validation or execution is performed here.
const shapeFields = {
  id: "string",
  type: '"rect" | "polygon" | "point"',
  labelId: "string",
  points: "number[]",
  attributes: "table",
  frameIndex: "number",
} satisfies Record<keyof AnnotationShape, string>;
const labelFields = {
  id: "string",
  name: "string",
  color: "string",
  shortcut: "string",
  shapeType: '"any" | "rect" | "polygon" | "point"',
} satisfies Record<keyof LabelConfig, string>;

function fields(type: string | undefined): Record<string, string> {
  if (type === "AnnotationShape") return shapeFields;
  if (type === "LabelConfig") return labelFields;
  // Structural return signatures (images and size) come from the host registry.
  if (type && /^\{[\w,]+\}$/.test(type)) {
    return Object.fromEntries(
      type
        .slice(1, -1)
        .split(",")
        .map((field) => [field, ""]),
    );
  }
  return {};
}

function elementType(type: string | undefined): string | undefined {
  if (type?.endsWith("[]")) return type.slice(0, -2);
  if (type?.startsWith("[") && type.endsWith("]")) return type.slice(1, -1);
  return undefined;
}

function expressionType(expression: string, bindings: Map<string, string>): string | undefined {
  const call = expression.match(/^annotool\.(\w+)\s*\(/);
  if (call) return SCRIPT_COMMANDS.find((command) => command.name === call[1])?.returns;
  const path = expression.trim().match(/^([a-zA-Z_]\w*)((?:\[[\w]+\]|\.[a-zA-Z_]\w*)*)$/);
  if (!path) return undefined;
  let type = bindings.get(path[1]);
  for (const part of path[2].matchAll(/\[\w+\]|\.([a-zA-Z_]\w*)/g)) {
    type = part[1]
      ? Object.entries(fields(type)).find(([name]) => name === part[1])?.[1]
      : elementType(type);
  }
  return type;
}

/** Lightweight hints for straight-line assignments and ipairs/pairs loops.
 * This is not a Lua type checker: dynamic calls and arbitrary table construction
 * are left unknown. Strings/comments must already have been masked by the lexer.
 */
export function luaMemberCompletions(code: string, receiver: string): Completion[] {
  const bindings = new Map<string, string>();
  const declarations =
    /(?<![\w.])(?:local\s+)?([a-zA-Z_]\w*)\s*=(?!=)\s*([^\n;]+)|\bfor\s+[a-zA-Z_]\w*\s*,\s*([a-zA-Z_]\w*)\s+in\s+i?pairs\s*\(([\s\S]*?)\)\s*do\b/g;
  for (const match of code.matchAll(declarations)) {
    const name = match[1] ?? match[3];
    const type = match[1]
      ? expressionType(match[2].trim(), bindings)
      : elementType(expressionType(match[4].trim(), bindings));
    if (type !== undefined) bindings.set(name, type);
    else bindings.delete(name);
  }
  const members = new Map<string, Completion>();
  for (const [label, detail] of Object.entries(fields(expressionType(receiver, bindings)))) {
    members.set(label, { label, type: "property", detail });
  }
  // User-defined members (e.g. shape.attributes.sequence) are suggested only
  // when already present on the same receiver in this document.
  const escaped = receiver.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const match of code.matchAll(new RegExp(`(?<![\\w.])${escaped}\\.([a-zA-Z_]\\w*)`, "g"))) {
    if (!members.has(match[1])) members.set(match[1], { label: match[1], type: "property" });
  }
  return [...members.values()];
}
