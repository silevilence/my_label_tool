import type { AcpConfig } from "../../types/acp";

export const DEFAULT_ACP_CONFIG: AcpConfig = { executable: "", args: ["acp"], timeoutSeconds: 120 };
export const ACP_CONFIG_STORAGE_KEY = "my-label-tool.acp-agent.v1";
