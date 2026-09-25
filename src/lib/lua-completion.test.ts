import { describe, expect, it } from "vitest";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { LUA_LANGUAGE } from "./lua-language";
import { luaCompletions } from "./lua-completion";
import {
  parseScriptCommands,
  SCRIPT_COMMANDS,
  SCRIPT_COMMAND_DOCUMENTATION,
} from "./script-commands";
import catalog from "../../examples/scripts/catalog.json";

function complete(doc: string, explicit = false, readOnly = false) {
  return luaCompletions(
    new CompletionContext(
      EditorState.create({
        doc,
        extensions: [LUA_LANGUAGE, EditorState.readOnly.of(readOnly)],
      }),
      doc.length,
      explicit,
    ),
  );
}
describe("Lua completions", () => {
  it("classifies Lua 5.4 keywords and supported library names", () => {
    const state = EditorState.create({
      doc: 'goto finish\nmath.tointeger(1)\nutf8.len("中")',
      extensions: [LUA_LANGUAGE],
    });
    const tokens: Record<string, string> = {};
    syntaxTree(state).iterate({
      enter(node) {
        if (!node.type.isTop) tokens[state.sliceDoc(node.from, node.to)] = node.name;
      },
    });
    expect(tokens.goto).toBe("keyword");
    expect(tokens["math.tointeger"]).toBe("variableName.standard");
    expect(tokens["utf8.len"]).toBe("variableName.standard");
    expect(tokens['"中"']).toBe("string");
  });
  it("uses every registered command with its signature and shared description", () => {
    const result = complete("annotool.im")!;
    expect(result.from).toBe(0);
    for (const command of SCRIPT_COMMANDS) {
      expect(result.options).toContainEqual(
        expect.objectContaining({
          label: `annotool.${command.name}`,
          detail: `${command.parameters} → ${command.returns}`,
        }),
      );
      expect(catalog.some((entry) => entry.command === command.name)).toBe(true);
      expect(SCRIPT_COMMAND_DOCUMENTATION).toContain(command.description);
    }
  });
  it("offers locals, function parameters, loop variables and supported standard libraries", () => {
    const result = complete(
      "local first, second = 1, 2\nlocal function work(arg)\nfor index, item in ipairs({}) do\n lo",
    )!;
    const names = result.options.map((option) => option.label);
    for (const name of [
      "first",
      "second",
      "work",
      "arg",
      "index",
      "item",
      "local",
      "math.floor",
      "table.unpack",
    ])
      expect(names).toContain(name);
    expect(names).not.toContain("io.open");
  });
  it("ignores strings/comments and does not complete in read-only documents", () => {
    expect(complete("-- annotool.im")).toBeNull();
    expect(complete('local a = "annotool.im')).toBeNull();
    expect(complete("")).toBeNull();
    expect(complete("", true)).not.toBeNull();
    expect(complete("a", true, true)).toBeNull();
    const names = complete('-- local ghost = 1\nlocal s = "local fake"\n f')!.options.map(
      (option) => option.label,
    );
    expect(names).not.toContain("ghost");
    expect(names).not.toContain("fake");
  });
  it("rejects malformed registries and reads additions without frontend command lists", () => {
    expect(() => parseScriptCommands("")).toThrow();
    expect(() => parseScriptCommands("pub const COMMANDS: &[Command] = &[\n];")).toThrow();
    expect(() =>
      parseScriptCommands(
        'pub const COMMANDS: &[Command] = &[Command { name: "new", run: new, }\n];',
      ),
    ).toThrow();
    expect(
      parseScriptCommands(
        'pub const COMMANDS: &[Command] = &[Command { name: "new", parameters: "{}", returns: "true", errors: "", run: new, }\n];',
      )[0].name,
    ).toBe("new");
  });
});
