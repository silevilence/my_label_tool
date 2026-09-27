/** Host-only machine settings; not part of ProjectConfig or plugin contracts. */
export interface TextReadConfig {
  mode: string;
  values: Record<string, string>;
  timeoutMs: number;
}
export interface TextReadMode {
  id: string;
  name: string;
  fields: { key: string; label: string; kind: "string" | "stringArray"; required: boolean }[];
  selfCheck: string;
}
export interface TextReadCheck {
  config: TextReadConfig;
  ok: boolean;
  message: string;
}
export interface TextReadSettings {
  config: TextReadConfig;
  modes: TextReadMode[];
  lastCheck: TextReadCheck | null;
  startupError: string | null;
}
export interface TextReadPlan {
  executable: string | null;
  arguments: string[];
}
