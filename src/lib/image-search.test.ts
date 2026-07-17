import { describe, expect, it } from "vitest";
import type { AnnotationShape, LabelConfig } from "../types/annotation";
import type { ImageFile } from "./tauri-api";
import {
  getSearchCompletions,
  getSearchHighlights,
  parseSearchQuery,
  searchImages,
  type SearchIndex,
} from "./image-search";

const labels: LabelConfig[] = [
  { id: "person", name: "person", color: "#fff", shapeType: "rect" },
  { id: "car", name: "car", color: "#000", shapeType: "rect" },
];

const images: ImageFile[] = [
  { path: "a.jpg", name: "person-big.jpg", size: 2 * 1024 * 1024 },
  { path: "b.jpg", name: "car-small.jpg", size: 512 * 1024 },
  { path: "c.jpg", name: "bad-bus.jpg", size: 64 },
];

const annotationsByImage: Record<string, AnnotationShape[]> = {
  "a.jpg": [{ id: "a", type: "rect", labelId: "person", points: [0, 0, 1, 1] }],
  "b.jpg": [{ id: "b", type: "rect", labelId: "car", points: [0, 0, 1, 1] }],
  "c.jpg": [{ id: "c", type: "rect", labelId: "car", points: [0, 0, 1, 1] }],
};

const index: SearchIndex = {
  annotationsByImage,
  labelById: new Map(labels.map((label) => [label.id, label])),
  classIndexByLabelId: new Map(labels.map((label, classIndex) => [label.id, classIndex])),
};

describe("image search", () => {
  it("keeps bare words as filename contains with implicit and", () => {
    expect(searchImages(images, "person big", index).map((image) => image.name)).toEqual([
      "person-big.jpg",
    ]);
  });

  it("evaluates boolean operators left-to-right unless grouped", () => {
    expect(searchImages(images, "person or car -bad", index).map((image) => image.name)).toEqual([
      "person-big.jpg",
      "car-small.jpg",
    ]);
    expect(searchImages(images, "person or (car -bad)", index).map((image) => image.name)).toEqual([
      "person-big.jpg",
      "car-small.jpg",
    ]);
  });

  it("matches tag, class and size qualifiers", () => {
    expect(
      searchImages(images, "@tag(person) @size(>1MB)", index).map((image) => image.name),
    ).toEqual(["person-big.jpg"]);
    expect(
      searchImages(images, "@class(1) @size(<=512KB)", index).map((image) => image.name),
    ).toEqual(["car-small.jpg", "bad-bus.jpg"]);
  });

  it("rejects malformed queries", () => {
    expect(() => parseSearchQuery("@size(big)")).toThrow("文件大小表达式无效");
    expect(() => parseSearchQuery("@nope(x)")).toThrow("未知限定符");
    expect(() => parseSearchQuery("(person")).toThrow("左括号缺少右括号");
  });

  it("suggests qualifiers, tags and class labels", () => {
    expect(getSearchCompletions("@c", 2, labels)[0]).toMatchObject({
      value: "@class(",
      label: "class",
    });
    expect(getSearchCompletions("@tag(pe", 7, labels)[0]).toMatchObject({
      value: "@tag(person)",
      label: "person",
    });
    expect(getSearchCompletions("@class(1", 8, labels)[0]).toMatchObject({
      value: "@class(1)",
      label: "1 car",
    });
  });

  it("splits highlight tokens for syntax coloring", () => {
    expect(getSearchHighlights("@tag(person) or -bad").map((token) => token.kind)).toEqual([
      "qualifier",
      "paren",
      "value",
      "paren",
      "text",
      "operator",
      "text",
      "operator",
      "text",
    ]);
  });
});
