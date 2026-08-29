import { describe, expect, it } from "vitest";
import type { LabelTemplate } from "../types/annotation";
import type { PluginLabelPreset } from "../types/plugin";
import {
  getSelectedPluginPresetRefreshImpact,
  mergePluginLabelPresets,
} from "./plugin-label-presets";

const builtIn: LabelTemplate = {
  id: "builtin",
  name: "内置",
  labels: [{ id: "object", name: "目标", color: "#38bdf8", shapeType: "rect" }],
};

function preset(name: string, labelName = "汽车"): PluginLabelPreset {
  return {
    pluginId: "dev.acme.labels",
    pluginName: "交通标签",
    template: {
      id: "dev.acme.labels.traffic",
      name,
      labels: [
        {
          id: "dev.acme.labels.car",
          name: labelName,
          color: "#f97316",
          shapeType: "rect",
        },
      ],
    },
  };
}

describe("mergePluginLabelPresets", () => {
  it("adds source metadata and replaces available data after an update", () => {
    const first = mergePluginLabelPresets([builtIn], new Set(), [preset("交通 v1")]);
    const updated = mergePluginLabelPresets(
      first.templates,
      first.pluginTemplateIds,
      [preset("交通 v2", "小汽车")],
    );

    expect(updated.templates.map((item) => item.name)).toEqual(["内置", "交通 v2"]);
    expect(updated.sourceByTemplateId.get("dev.acme.labels.traffic")).toBe("交通标签");
    expect(updated.templates[1].labels[0].name).toBe("小汽车");
  });

  it("removes only previous plugin templates when disabled or uninstalled", () => {
    const first = mergePluginLabelPresets([builtIn], new Set(), [preset("交通")]);
    const loadedSnapshot = structuredClone(first.templates[1]);
    const removed = mergePluginLabelPresets(first.templates, first.pluginTemplateIds, []);

    expect(removed.templates).toEqual([builtIn]);
    expect(loadedSnapshot.labels[0].name).toBe("汽车");
  });

  it("does not overwrite an existing template with a colliding id", () => {
    const existing = { ...builtIn, id: "dev.acme.labels.traffic" };
    const result = mergePluginLabelPresets([existing], new Set(), [preset("交通")]);

    expect(result.templates).toEqual([existing]);
    expect(result.collisions).toEqual(["dev.acme.labels.traffic"]);
    expect(result.pluginTemplateIds.size).toBe(0);
  });

  it("reports update and removal without touching the loaded template snapshot", () => {
    const loadedSnapshot = structuredClone(preset("交通 v1").template);
    expect(
      getSelectedPluginPresetRefreshImpact(
        [preset("交通 v1")],
        [preset("交通 v2")],
        loadedSnapshot.id,
      ),
    ).toBe("updated");
    expect(getSelectedPluginPresetRefreshImpact([preset("交通 v1")], [], loadedSnapshot.id)).toBe(
      "removed",
    );
    expect(loadedSnapshot.name).toBe("交通 v1");
  });
});
