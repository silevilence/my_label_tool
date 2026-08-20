import { describe, expect, it } from "vitest";
import {
  createLabelForPrelabelClass,
  mapPrelabelDetections,
  resolvePrelabelClassMappings,
  updateProjectPrelabelMappings,
} from "./prelabel-mapping";
import type { ProjectConfig } from "./importers";
import type { LabelConfig } from "../types/annotation";
import type { PrelabelClassMapping } from "../types/prelabel";

const labels: LabelConfig[] = [
  { id: "person-exact", name: "Person", color: "#fff", shapeType: "rect" },
  { id: "person-upper", name: "PERSON", color: "#000", shapeType: "rect" },
  { id: "car", name: "car", color: "#f00", shapeType: "any" },
  { id: "cat-accent", name: "ÉCOLE", color: "#0f0", shapeType: "rect" },
];

describe("prelabel class mapping", () => {
  it("prefers exact names and only falls back to unambiguous ASCII case folding", () => {
    const resolved = resolvePrelabelClassMappings(
      "model-1",
      ["Person", "person", "CAR", "école", "missing"],
      labels,
      {},
    );

    expect(resolved.map((entry) => entry.labelId)).toEqual([
      "person-exact",
      undefined,
      "car",
      undefined,
      undefined,
    ]);
    expect(resolved.map((entry) => entry.source)).toEqual([
      "auto-exact",
      "unmatched",
      "auto-ascii-case-insensitive",
      "unmatched",
      "unmatched",
    ]);
  });

  it("supports binding, creating, excluding, and skipping unresolved classes", () => {
    const mappings: PrelabelClassMapping[] = [
      { classIndex: 0, className: "human", action: "bind", labelId: "person-exact" },
      { classIndex: 1, className: "bike", action: "create", labelId: "bike" },
      { classIndex: 2, className: "ignore", action: "exclude" },
    ];
    const nextLabels = [
      ...labels,
      { id: "bike", name: "bike", color: "#123456", shapeType: "rect" as const },
    ];
    const resolved = resolvePrelabelClassMappings(
      "model-1",
      ["human", "bike", "ignore", "unknown"],
      nextLabels,
      { "model-1": mappings },
    );
    const annotations = mapPrelabelDetections(
      [
        { classIndex: 0, confidence: 0.9, points: [1, 2, 30, 40] },
        { classIndex: 1, confidence: 0.8, points: [5, 6, 10, 12] },
        { classIndex: 2, confidence: 0.7, points: [1, 1, 2, 2] },
        { classIndex: 3, confidence: 0.6, points: [2, 2, 3, 3] },
      ],
      resolved,
      (() => {
        let index = 0;
        return () => `annotation-${++index}`;
      })(),
    );

    expect(annotations).toEqual([
      {
        id: "annotation-1",
        type: "rect",
        labelId: "person-exact",
        points: [1, 2, 30, 40],
        attributes: { confidence: 0.9 },
        frameIndex: 0,
      },
      {
        id: "annotation-2",
        type: "rect",
        labelId: "bike",
        points: [5, 6, 10, 12],
        attributes: { confidence: 0.8 },
        frameIndex: 0,
      },
    ]);
  });

  it("invalidates stale model snapshots and missing label ids", () => {
    const resolved = resolvePrelabelClassMappings("model-1", ["renamed"], labels, {
      "model-1": [
        { classIndex: 0, className: "old-name", action: "bind", labelId: "missing-label" },
      ],
    });

    expect(resolved[0]).toMatchObject({ classIndex: 0, source: "unmatched" });
  });

  it("creates a unique rectangular label from a model class", () => {
    expect(createLabelForPrelabelClass(labels, "car", "#abcdef")).toEqual({
      id: "car-2",
      name: "car",
      color: "#abcdef",
      shapeType: "rect",
    });
  });

  it("updates one model mapping without dropping other project mappings", () => {
    const config: ProjectConfig = {
      schemaVersion: 1,
      format: "json",
      annotationPath: "annotations.json",
      exportedAt: "2026-08-20T00:00:00.000Z",
      imageFolder: "images",
      labels,
      template: { id: "project-config", name: "项目临时配置" },
      exportOptions: { format: "json" },
      prelabelMappings: {
        other: [{ classIndex: 0, className: "car", action: "exclude" }],
      },
    };
    const mappings: PrelabelClassMapping[] = [
      { classIndex: 0, className: "person", action: "bind", labelId: "person-exact" },
    ];

    const updated = updateProjectPrelabelMappings(config, "model-1", mappings, labels);

    expect(updated.prelabelMappings).toEqual({
      other: [{ classIndex: 0, className: "car", action: "exclude" }],
      "model-1": mappings,
    });
    expect(updated.labels).toBe(labels);
    expect(config.prelabelMappings).not.toHaveProperty("model-1");
  });
});
