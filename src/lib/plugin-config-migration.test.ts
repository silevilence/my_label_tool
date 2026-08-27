import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "./importers";
import { mergePluginConfigMigration } from "./plugin-config-migration";

function project(imageFolder: string, exportedAt: string): ProjectConfig {
  return {
    schemaVersion: 1,
    format: "json",
    annotationPath: `${imageFolder}/annotations.json`,
    exportedAt,
    imageFolder,
    labels: [],
    template: { id: "project-config", name: "项目临时配置" },
    exportOptions: { format: "json" },
    pluginConfigs: [
      { pluginId: "dev.test.plugin", configVersion: 1, config: { project: imageFolder } },
    ],
  };
}

describe("plugin config migration state merge", () => {
  it("merges into the same project snapshot", () => {
    const opened = project("A", "1");
    const currentAfterSave = project("A", "2");
    const merged = mergePluginConfigMigration(currentAfterSave, opened, {
      configs: [{ pluginId: "dev.test.plugin", configVersion: 2, config: { migrated: true } }],
      pendingPluginIds: [],
      unavailablePluginIds: [],
      issues: [],
    });

    expect(merged?.pluginConfigs?.[0]).toMatchObject({ configVersion: 2 });
  });

  it("does not let a late project A result overwrite project B", () => {
    const openedA = project("A", "1");
    const currentB = project("B", "2");
    const merged = mergePluginConfigMigration(currentB, openedA, {
      configs: [{ pluginId: "dev.test.plugin", configVersion: 2, config: { project: "A" } }],
      pendingPluginIds: [],
      unavailablePluginIds: [],
      issues: [],
    });

    expect(merged).toBe(currentB);
    expect(merged?.pluginConfigs?.[0].config).toEqual({ project: "B" });
  });
});
