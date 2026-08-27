import type { ProjectConfig } from "./importers";
import type { PluginConfigMigrationReport } from "../types/plugin";

export function mergePluginConfigMigration(
  current: ProjectConfig | null,
  opened: ProjectConfig,
  report: PluginConfigMigrationReport,
): ProjectConfig | null {
  if (!current || !sameProjectSnapshot(current, opened)) {
    return current;
  }
  return { ...current, pluginConfigs: report.configs };
}

function sameProjectSnapshot(left: ProjectConfig, right: ProjectConfig): boolean {
  return left.schemaVersion === right.schemaVersion && left.imageFolder === right.imageFolder;
}
