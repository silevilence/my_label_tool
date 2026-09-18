import { expect, it } from "vitest";
import { parseProjectSettings, validFrameInterval } from "./project-settings";
import { DEFAULT_PROJECT_SETTINGS } from "./defaults/video";
import Ajv from "ajv";
import schema from "../../docs/project-settings.schema.json";
import Ajv2020 from "ajv/dist/2020";
import projectSchema from "../../docs/project-config.schema.json";
import { parseProjectConfig } from "./importers";

it("defaults missing extraction settings without changing older project formats", () => {
  expect(parseProjectSettings('{"schemaVersion":1}')).toEqual(DEFAULT_PROJECT_SETTINGS);
  expect(
    parseProjectSettings('{"schemaVersion":1,"videoExtraction":{"frameInterval":12}}')
      .videoExtraction.frameInterval,
  ).toBe(12);
});
it.each([0, -1, 1.5, Infinity, NaN, 1_000_001])("rejects invalid frame interval %s", (value) => {
  expect(validFrameInterval(value)).toBe(false);
  expect(() =>
    parseProjectSettings(
      JSON.stringify({ schemaVersion: 1, videoExtraction: { frameInterval: value } }),
    ),
  ).toThrow();
});
it.each([
  "null",
  "[]",
  '{"schemaVersion":2}',
  '{"schemaVersion":1,"videoExtraction":null}',
  '{"schemaVersion":1,"videoExtraction":{}}',
])("rejects malformed settings %s", (value) => {
  expect(() => parseProjectSettings(value)).toThrow();
});
it("accepts interval boundaries", () => {
  expect(validFrameInterval(1)).toBe(true);
  expect(validFrameInterval(1_000_000)).toBe(true);
});
it("keeps the published host schema aligned with parsing", () => {
  const validate = new Ajv().compile(schema);
  for (const frameInterval of [1, 30, 1_000_000, 0, -1, 1.2, 1_000_001]) {
    expect(validate({ schemaVersion: 1, videoExtraction: { frameInterval } })).toBe(
      validFrameInterval(frameInterval),
    );
  }
  expect(validate(DEFAULT_PROJECT_SETTINGS)).toBe(true);
});
it("round-trips both modes and rejects invalid FPS or mode values", () => {
  const validate = new Ajv().compile(schema);
  for (const mode of ["fps", "interval"]) {
    const value = { schemaVersion: 1, videoExtraction: { mode, fps: 2.5, frameInterval: 12 } };
    expect(parseProjectSettings(JSON.stringify(value))).toEqual(value);
    expect(validate(value)).toBe(true);
  }
  for (const fps of [0, -1, 1001, null, "5"]) {
    const value = { schemaVersion: 1, videoExtraction: { mode: "fps", fps, frameInterval: 30 } };
    expect(validate(value)).toBe(false);
    expect(() => parseProjectSettings(JSON.stringify(value))).toThrow();
  }
  expect(() =>
    parseProjectSettings(
      '{"schemaVersion":1,"videoExtraction":{"mode":"unknown","frameInterval":30}}',
    ),
  ).toThrow();
});
it("validates settings inside the project file while accepting legacy projects", () => {
  const validate = new Ajv2020().compile(projectSchema);
  const project = {
    schemaVersion: 1,
    format: "json",
    annotationPath: "annotations.json",
    exportedAt: "",
    imageFolder: "C:/test",
    labels: [],
  };
  expect(validate(project)).toBe(true);
  expect(parseProjectConfig(JSON.stringify(project)).settings).toBeUndefined();
  const configured = { ...project, settings: DEFAULT_PROJECT_SETTINGS };
  expect(validate(configured)).toBe(true);
  expect(parseProjectConfig(JSON.stringify(configured)).settings).toEqual(DEFAULT_PROJECT_SETTINGS);
  const bad = {
    ...project,
    settings: { schemaVersion: 1, videoExtraction: { mode: "fps", fps: 0, frameInterval: 30 } },
  };
  expect(validate(bad)).toBe(false);
  expect(() => parseProjectConfig(JSON.stringify(bad))).toThrow();
});
