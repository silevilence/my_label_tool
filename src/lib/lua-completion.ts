import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { SCRIPT_COMMANDS } from "./script-commands";

import { keywords, functions, constants } from "./lua-builtins";

export function luaCompletions(context: CompletionContext): CompletionResult | null {
  if (context.state.readOnly) return null;
  const node = syntaxTree(context.state).resolveInner(context.pos, -1);
  if (/string|comment/i.test(node.name)) return null;
  const word = context.matchBefore(/[\w.]*/);
  if (!word || (!word.text && !context.explicit)) return null;
  // Mask strings/comments before discovering local declarations and parameters.
  const chars = context.state.sliceDoc(0, context.pos).split("");
  syntaxTree(context.state).iterate({
    to: context.pos,
    enter: (part) => {
      if (/string|comment/i.test(part.name)) {
        for (let i = part.from; i < Math.min(part.to, chars.length); i++) chars[i] = " ";
      }
    },
  });
  const code = chars.join("");
  const locals = new Set<string>();
  for (const match of code.matchAll(
    /\blocal\s+(?:function\s+)?([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)|\bfor\s+([a-zA-Z_]\w*(?:\s*,\s*[a-zA-Z_]\w*)*)\s*(?:=|in\b)/g,
  )) {
    for (const name of (match[1] ?? match[2] ?? match[3]).split(",").map((value) => value.trim())) {
      if (/^[a-zA-Z_]\w*$/.test(name)) locals.add(name);
    }
  }
  for (const match of code.matchAll(/\bfunction\s*[\w.:]*\s*\(([^)]*)\)/g)) {
    for (const name of match[1].split(",").map((value) => value.trim())) {
      if (/^[a-zA-Z_]\w*$/.test(name)) locals.add(name);
    }
  }
  const options: Completion[] = [
    ...keywords.map((label) => ({ label, type: "keyword" })),
    ...functions.map((label) => ({ label, type: "function" })),
    ...constants.map((label) => ({ label, type: "constant" })),
    ...[...locals].map((label) => ({ label, type: "variable", boost: 1 })),
    ...SCRIPT_COMMANDS.map((command) => ({
      label: `annotool.${command.name}`,
      type: "function",
      detail: `${command.parameters} → ${command.returns}`,
      info: `${command.description}\n${command.errors}`,
    })),
  ];
  return { from: word.from, options, validFor: /^[\w.]*$/ };
}
