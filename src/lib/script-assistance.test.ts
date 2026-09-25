import { expect, it } from "vitest";
import {
  createScriptPrompt,
  extractLuaDraft,
  parseAcpConfig,
  scriptDiff,
} from "./script-assistance";

it("validates executable, argument array, and timeout without shell interpretation", () => {
  expect(parseAcpConfig(" agent.exe ", '["acp","a; echo ignored"]', 120)).toEqual({
    executable: "agent.exe",
    args: ["acp", "a; echo ignored"],
    timeoutSeconds: 120,
  });
  for (const args of [
    "bad",
    "{}",
    "[1]",
    '["\\u0000"]',
    JSON.stringify(Array(65).fill("x")),
    JSON.stringify(["x".repeat(8193)]),
  ])
    expect(() => parseAcpConfig("agent", args, 120)).toThrow();
  for (const timeout of [0, 601, NaN, 1.5])
    expect(() => parseAcpConfig("agent", "[]", timeout)).toThrow();
  expect(() => parseAcpConfig("", "[]", 120)).toThrow();
  expect(() => parseAcpConfig("a\0b", "[]", 120)).toThrow();
});
it("builds context solely from explicit source, instructions and shared command docs", () => {
  const prompt = createScriptPrompt("local x = 1", " count images ", false);
  expect(prompt).toContain('"source":"local x = 1"');
  expect(prompt).toContain('"instruction":"count images"');
  expect(prompt).toContain("annotool.images");
  expect(prompt).toContain("未带入图片尺寸");
  expect(createScriptPrompt("", "test", true)).toContain("已带入图片尺寸");
  expect(() => createScriptPrompt("", " ", false)).toThrow();
  expect(() => createScriptPrompt("中".repeat(200000), "test", false)).toThrow();
});
it("extracts one complete Lua block and rejects partial or ambiguous output", () => {
  expect(extractLuaDraft("Explanation\n```lua\r\nlocal x = 1\r\n```\n")).toBe("local x = 1\n");
  for (const response of [
    "local x=1",
    "```lua\nx=1",
    "```lua\n \n```",
    "```lua\nx=1\n```\n```lua\nx=2\n```",
    "```lua\n" + "a".repeat(512 * 1024 + 1) + "\n```",
  ])
    expect(() => extractLuaDraft(response)).toThrow();
});
it("diff preserves both versions including middle edits and trailing newlines", () => {
  for (const [before, after] of [
    ["a\nb\nc", "a\nd\nc"],
    ["same", "same"],
    ["", "new"],
    ["x\n", "x"],
    ["a", ""],
    ["a\r\nb", "a\nb\nc"],
  ]) {
    const diff = scriptDiff(before, after);
    expect(
      diff
        .filter((part) => part.kind !== "added")
        .map((part) => part.line)
        .join("\n"),
    ).toBe(before.replace(/\r\n?/g, "\n"));
    expect(
      diff
        .filter((part) => part.kind !== "removed")
        .map((part) => part.line)
        .join("\n"),
    ).toBe(after.replace(/\r\n?/g, "\n"));
  }
});
