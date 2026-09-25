import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { SCRIPT_COMMANDS } from "./script-commands";

const keywords =
  "and break do else elseif end false for function goto if in local nil not or repeat return then true until while".split(
    " ",
  );
// Only libraries available in the offline script host are offered.
const functions =
  "assert error getmetatable ipairs next pairs pcall rawequal rawget rawlen rawset select setmetatable tonumber tostring type xpcall math.abs math.acos math.asin math.atan math.ceil math.cos math.deg math.exp math.floor math.fmod math.log math.max math.min math.modf math.rad math.random math.randomseed math.sin math.sqrt math.tan math.tointeger math.type math.ult string.byte string.char string.dump string.find string.format string.gmatch string.gsub string.len string.lower string.match string.pack string.packsize string.rep string.reverse string.sub string.unpack string.upper table.concat table.insert table.move table.pack table.remove table.sort table.unpack utf8.char utf8.codepoint utf8.codes utf8.len utf8.offset".split(
    " ",
  );
const constants =
  "_VERSION math.huge math.pi math.maxinteger math.mininteger utf8.charpattern annotool.API_VERSION".split(
    " ",
  );

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
