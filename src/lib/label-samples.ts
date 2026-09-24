import type { LabelConfig } from "../types/annotation";
import { LABEL_SAMPLE_ZH_CN as text } from "../i18n/label-sample.zh-CN";

export function sampleFileStem(name: string): string {
  // Windows disallows control characters, separators, device names and trailing dots/spaces.
  let stem = Array.from(name.trim(), (char) =>
    char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? "_" : char,
  )
    .join("")
    .replace(/[. ]+$/u, "");
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(stem)) stem = `_${stem}`;
  return stem;
}

export function sampleNameError(labels: readonly Pick<LabelConfig, "name">[]): string {
  const names = new Map<string, string>();
  for (const { name } of labels) {
    const stem = sampleFileStem(name);
    if (!stem || stem.length > 200) return text.invalidName(name);
    const key = stem.toLowerCase();
    const previous = names.get(key);
    if (previous !== undefined) return text.conflict([previous, name]);
    names.set(key, name);
  }
  return "";
}
