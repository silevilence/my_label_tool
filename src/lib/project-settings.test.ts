import { expect, it } from "vitest";
import { parseProjectSettings, validFrameInterval } from "./project-settings";
import { DEFAULT_PROJECT_SETTINGS } from "./defaults/video";
import Ajv from "ajv";
import schema from "../../docs/project-settings.schema.json";

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
