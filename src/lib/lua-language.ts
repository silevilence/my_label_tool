import { StreamLanguage } from "@codemirror/language";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { keywords, functions, constants } from "./lua-builtins";

const builtins = new Set([...functions, ...constants]);
// Retain the lexer for strings/comments, but classify names using Lua 5.4 and
// the same supported host libraries as completion (legacy mode targets 5.1).
export const LUA_LANGUAGE = StreamLanguage.define({
  ...lua,
  token(stream, state) {
    const style = lua.token(stream, state);
    if (style === "variable" || style === "builtin" || style === "keyword") {
      const word = stream.current();
      return keywords.includes(word) ? "keyword" : builtins.has(word) ? "builtin" : "variable";
    }
    return style;
  },
});
