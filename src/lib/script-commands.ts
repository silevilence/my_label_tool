import registry from "../../src-tauri/script-host/src/commands.rs?raw";
import catalog from "../../examples/scripts/catalog.json";
import { SCRIPT_ZH_CN as text } from "../i18n/script.zh-CN";

export interface ScriptCommand {
  name: string;
  parameters: string;
  returns: string;
  errors: string;
  description: string;
}

// Consume the host registry directly, including signature changes. Fail closed on
// an unfamiliar registry layout instead of silently shipping stale completions.
export function parseScriptCommands(source: string): ScriptCommand[] {
  const section = source.match(/pub const COMMANDS: &\[Command\] = &\[([\s\S]*?)\n\];/)?.[1];
  if (!section) throw new Error(text.invalidCommandRegistry);
  const blocks = [...section.matchAll(/Command\s*\{([^}]+)\}/g)];
  // Parameter signatures contain braces, so delimit entries by their handler.
  const entries = [...section.matchAll(/Command\s*\{([\s\S]*?run:\s*\w+,\s*)\}/g)];
  if (!entries.length || entries.length !== blocks.length)
    throw new Error(text.invalidCommandRegistry);
  return entries.map(([, body]) => {
    const field = (name: string) => {
      const value = body.match(new RegExp(`${name}:\\s*"([^"\\n]*)"`))?.[1];
      if (value === undefined) throw new Error(text.invalidCommandRegistry);
      return value;
    };
    const name = field("name");
    const example = catalog.find((entry) => entry.command === name);
    const description = example
      ? text.examples[example.id as keyof typeof text.examples].description
      : "";
    return {
      name,
      parameters: field("parameters"),
      returns: field("returns"),
      errors: field("errors"),
      description,
    };
  });
}

export const SCRIPT_COMMANDS = parseScriptCommands(registry);
export const SCRIPT_COMMAND_DOCUMENTATION = SCRIPT_COMMANDS.map(
  (command) =>
    `annotool.${command.name}(${command.parameters}) → ${command.returns}\n${command.description}\n${command.errors}`,
).join("\n\n");
