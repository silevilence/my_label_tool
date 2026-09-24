import numbering from "../../../examples/scripts/numbering.lua?raw";
import catalog from "../../../examples/scripts/catalog.json";
import { SCRIPT_ZH_CN as text } from "../../i18n/script.zh-CN";

const sources = import.meta.glob<string>("../../../examples/scripts/*.lua", {
  query: "?raw",
  import: "default",
  eager: true,
});
export const BUILTIN_SCRIPTS = catalog.map((entry) => ({
  id: `builtin:${entry.id}`,
  ...text.examples[entry.id as keyof typeof text.examples],
  source: sources[`../../../examples/scripts/${entry.id}.lua`],
  includeDimensions: entry.includeDimensions,
}));
export const DEFAULT_SCRIPT_SOURCE = numbering;
