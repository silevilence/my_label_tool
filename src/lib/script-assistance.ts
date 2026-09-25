import type { AcpConfig } from "../types/acp";
import { ACP_ZH_CN as text } from "../i18n/acp.zh-CN";
import { SCRIPT_COMMAND_DOCUMENTATION } from "./script-commands";

export function parseAcpConfig(
  executable: string,
  argsJson: string,
  timeoutSeconds: number,
): AcpConfig {
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new Error(text.invalidConfig);
  }
  if (
    !executable.trim() ||
    executable.includes("\0") ||
    !Array.isArray(args) ||
    args.length > 64 ||
    args.some(
      (arg: unknown) => typeof arg !== "string" || arg.length > 8192 || arg.includes("\0"),
    ) ||
    !Number.isInteger(timeoutSeconds) ||
    timeoutSeconds < 1 ||
    timeoutSeconds > 600
  )
    throw new Error(text.invalidConfig);
  return { executable: executable.trim(), args: args as string[], timeoutSeconds };
}

/** Deliberately accepts no project, image, label, annotation, or filesystem object. */
export function createScriptPrompt(
  source: string,
  instruction: string,
  includeDimensions: boolean,
): string {
  if (!instruction.trim()) throw new Error(text.missingInstruction);
  const prompt = `${text.promptRules}\n${includeDimensions ? text.promptWithDimensions : text.promptWithoutDimensions}\n\n${SCRIPT_COMMAND_DOCUMENTATION}\n\n${text.promptInput}\n${JSON.stringify({ source, instruction: instruction.trim() })}`;
  if (new TextEncoder().encode(prompt).length > 512 * 1024) throw new Error(text.tooLarge);
  return prompt;
}

export function extractLuaDraft(reply: string): string {
  const blocks = [...reply.matchAll(/^```lua[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gim)];
  if (blocks.length !== 1 || !blocks[0][1].trim()) throw new Error(text.noLuaDraft);
  const source = blocks[0][1].replace(/\r\n?/g, "\n");
  if (new TextEncoder().encode(source).length > 512 * 1024) throw new Error(text.tooLarge);
  return source;
}

/** Linear prefix/suffix diff, with an explicit removed/added middle block. */
export function scriptDiff(
  before: string,
  after: string,
): { kind: "same" | "removed" | "added"; line: string }[] {
  const oldLines = before.replace(/\r\n?/g, "\n").split("\n");
  const newLines = after.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start])
    start++;
  let end = 0;
  while (
    end < oldLines.length - start &&
    end < newLines.length - start &&
    oldLines[oldLines.length - end - 1] === newLines[newLines.length - end - 1]
  )
    end++;
  return [
    ...oldLines.slice(0, start).map((line) => ({ kind: "same" as const, line })),
    ...oldLines
      .slice(start, oldLines.length - end)
      .map((line) => ({ kind: "removed" as const, line })),
    ...newLines
      .slice(start, newLines.length - end)
      .map((line) => ({ kind: "added" as const, line })),
    ...oldLines.slice(oldLines.length - end).map((line) => ({ kind: "same" as const, line })),
  ];
}
