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
  it("completes annotation members after a dot on an ipairs item", () => {
    const doc =
      "local shapes = annotool.annotations({imagePath = image.path})\nfor _, shape in ipairs(shapes) do\nshape.";
    const result = complete(doc)!;
    expect(result.from).toBe(doc.length);
    expect(result.options.map((option) => option.label)).toEqual(
      expect.arrayContaining(["id", "type", "labelId", "points", "attributes", "frameIndex"]),
    );
  });
  it.each([
    [
      "local images = annotool.images()\nfor _, image in ipairs(images) do\nimage.",
      ["path", "name"],
    ],
    [
      "for _, item in ipairs(annotool.annotations({imagePath = image.path})) do\nitem.",
      ["attributes", "points"],
    ],
    [
      "local entries = annotool.annotations({imagePath = image.path})\nlocal item = entries[1]\nlocal alias = item\nalias.",
      ["attributes", "labelId"],
    ],
    ["local entries = annotool.annotations({imagePath = image.path})\nentries[1].", ["points"]],
    [
      'local label = annotool.label({name = "car"})\nlabel.',
      ["name", "color", "shapeType", "shortcut"],
    ],
    ["local size = annotool.size({imagePath = image.path})\nsize.", ["width", "height"]],
    ["shape.attributes.sequence = 1\nshape.attributes.", ["sequence"]],
    [
      "local shapes = annotool.annotations({imagePath = image.path})\nfor _, s in pairs(shapes) do\ns.at",
      ["attributes"],
    ],
  ])("suggests members for %s", (doc, names) => {
    const result = complete(doc)!;
    expect(result.options.map((option) => option.label)).toEqual(expect.arrayContaining(names));
    expect(result.from).toBe(doc.lastIndexOf(".") + 1);
    expect(result.validFor).toEqual(/^\w*$/);
  });
  it("does not invent members for unknown values or reuse name candidates after a dot", () => {
    expect(complete("local shape = 1\nshape.")).toBeNull();
    expect(
      complete(
        "local label = annotool.label({})\nlocal values = label.toString\nfor _, value in ipairs(values) do\nvalue.",
      ),
    ).toBeNull();
    expect(
      complete(
        "local shapes = annotool.annotations({})\nlocal shape = shapes[1]\nshape = other()\nshape.",
      ),
    ).toBeNull();
    expect(complete("local shape = annotool.unknown()\nshape.")).toBeNull();
    expect(complete("local values = {}\nfor _, item in ipairs(values) do\nitem.")).toBeNull();
    expect(complete('local message = "shape.fake = 1"\n-- shape.ghost = 1\nshape.')).toBeNull();
    expect(complete("local shape = 1\nshap")!.validFor).toEqual(/^\w*$/);
    expect(
      complete("shape.attributes.sequence = 1\nshape.")!.options.map((option) => option.label),
    ).toEqual(["attributes"]);
    expect(
      complete("shape.id = 1\nshape.id\nshape.")!.options.map((option) => option.label),
    ).toEqual(["id"]);
  });
  it("does not treat comparisons and another object's field writes as variable assignments", () => {
    const doc =
      "local shape = annotool.annotations({})\nlocal item = shape[1]\nif item == nil then\nend\nother.item = 1\nitem.";
    expect(complete(doc)!.options.map((option) => option.label)).toContain("attributes");
  });
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
