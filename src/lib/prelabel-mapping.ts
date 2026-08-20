import { newAnnotationId } from "./app-utils";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ProjectConfig } from "./importers";
import type {
  PrelabelClassMapping,
  PrelabelDetection,
  PrelabelMappingsByModel,
  ResolvedPrelabelClassMapping,
} from "../types/prelabel";

export function resolvePrelabelClassMappings(
  modelId: string,
  classNames: string[],
  labels: LabelConfig[],
  mappingsByModel: PrelabelMappingsByModel,
): ResolvedPrelabelClassMapping[] {
  const savedByIndex = new Map(
    (mappingsByModel[modelId] ?? []).map((mapping) => [mapping.classIndex, mapping]),
  );
  const labelIds = new Set(labels.map((label) => label.id));

  return classNames.map((className, classIndex) => {
    const saved = savedByIndex.get(classIndex);
    if (saved?.className === className) {
      if (saved.action === "exclude") {
        return { classIndex, className, excluded: true, source: "explicit-exclude" };
      }
      if (saved.labelId && labelIds.has(saved.labelId)) {
        return {
          classIndex,
          className,
          labelId: saved.labelId,
          excluded: false,
          source: "explicit",
        };
      }
    }

    const exact = labels.filter((label) => label.name === className);
    if (exact.length === 1) {
      return {
        classIndex,
        className,
        labelId: exact[0].id,
        excluded: false,
        source: "auto-exact",
      };
    }

    const foldedName = asciiFold(className);
    const folded = labels.filter((label) => asciiFold(label.name) === foldedName);
    if (folded.length === 1) {
      return {
        classIndex,
        className,
        labelId: folded[0].id,
        excluded: false,
        source: "auto-ascii-case-insensitive",
      };
    }

    return { classIndex, className, excluded: false, source: "unmatched" };
  });
}

export function mapPrelabelDetections(
  detections: PrelabelDetection[],
  mappings: ResolvedPrelabelClassMapping[],
  createId: () => string = newAnnotationId,
): AnnotationShape[] {
  const mappingByIndex = new Map(mappings.map((mapping) => [mapping.classIndex, mapping]));
  return detections.flatMap((detection) => {
    const mapping = mappingByIndex.get(detection.classIndex);
    if (!mapping?.labelId || mapping.excluded) {
      return [];
    }
    return [
      {
        id: createId(),
        type: "rect" as const,
        labelId: mapping.labelId,
        points: [...detection.points],
        attributes: { confidence: detection.confidence },
        frameIndex: 0,
      },
    ];
  });
}

export function createLabelForPrelabelClass(
  labels: LabelConfig[],
  className: string,
  color: string,
): LabelConfig {
  const base = className
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const prefix = base || "label";
  const ids = new Set(labels.map((label) => label.id));
  let id = prefix;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${prefix}-${suffix}`;
    suffix += 1;
  }
  return { id, name: className.trim(), color, shapeType: "rect" };
}

export function updateProjectPrelabelMappings(
  config: ProjectConfig,
  modelId: string,
  mappings: PrelabelClassMapping[],
  labels: LabelConfig[],
): ProjectConfig {
  return {
    ...config,
    labels,
    prelabelMappings: {
      ...config.prelabelMappings,
      [modelId]: mappings,
    },
  };
}

function asciiFold(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : character;
  }).join("");
}
