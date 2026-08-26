import { describe, expect, it } from "vitest";
import manifestSchema from "../../docs/plugin-manifest.schema.json";
import { PLUGIN_MANIFEST_FIELDS, parsePluginManifest, type PluginManifest } from "./plugin";

const validPrelabelManifest = {
  schemaVersion: 1,
  id: "dev.acme.prelabel",
  name: "示例预打标",
  version: "1.2.3",
  apiVersion: { min: 1 },
  extensionKind: "prelabel",
  runtime: "process",
  entry: { command: "plugin/main.exe" },
  capabilities: { annotationTypes: ["rect"], batch: true },
};

describe("parsePluginManifest", () => {
  it.each([null, [], "manifest"])("rejects non-object manifest roots", (input) => {
    const result = parsePluginManifest(input);
    expect(result).toEqual({
      ok: false,
      errors: [expect.objectContaining({ field: "$", code: "INVALID_TYPE" })],
    });
  });

  it("normalizes optional fields for a valid code plugin", () => {
    const result = parsePluginManifest(validPrelabelManifest);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected: PluginManifest = {
      ...validPrelabelManifest,
      schemaVersion: 1,
      extensionKind: "prelabel",
      runtime: "process",
      entry: { command: "plugin/main.exe", args: [] },
      capabilities: {
        annotationTypes: ["rect"],
        batch: true,
        progress: false,
        cancel: false,
        configMigration: false,
        exporter: { apiVersion: { min: 1 } },
        prelabel: { apiVersion: { min: 1 } },
      },
      permissions: [],
      configVersion: 0,
    };
    expect(result.value).toEqual(expected);
  });

  it("collects field paths and codes for independent validation failures", () => {
    const result = parsePluginManifest({
      schemaVersion: 2,
      id: "Bad Id",
      name: "",
      version: "v1",
      extensionKind: "prelabel",
      runtime: "wasm",
      entry: { command: "../main.py" },
      capabilities: {
        annotationTypes: [],
        exporter: { apiVersion: { min: 0 } },
      },
      permissions: ["network", "network", "spawn"],
      configVersion: -1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ field, code }) => [field, code])).toEqual(
      expect.arrayContaining([
        ["schemaVersion", "UNSUPPORTED_VERSION"],
        ["id", "INVALID_FORMAT"],
        ["name", "INVALID_VALUE"],
        ["version", "INVALID_FORMAT"],
        ["apiVersion", "REQUIRED"],
        ["runtime", "UNSUPPORTED_RUNTIME"],
        ["entry.command", "INVALID_PATH"],
        ["capabilities.annotationTypes", "REQUIRED"],
        ["capabilities.exporter.apiVersion.min", "INVALID_VERSION"],
        ["permissions[1]", "DUPLICATE"],
        ["permissions[2]", "UNKNOWN_PERMISSION"],
        ["configVersion", "INVALID_VALUE"],
      ]),
    );
    expect(result.errors.every((error) => error.reason.length > 0)).toBe(true);
  });

  it.each([
    [{ ...validPrelabelManifest, entry: undefined }, "entry", "REQUIRED"],
    [
      { ...validPrelabelManifest, capabilities: { annotationTypes: undefined } },
      "capabilities.annotationTypes",
      "REQUIRED",
    ],
    [
      {
        schemaVersion: 1,
        id: "dev.acme.labels",
        name: "标签",
        version: "1.0.0",
        apiVersion: { min: 1 },
        extensionKind: "label-preset",
        runtime: "process",
        entry: { command: "main.exe" },
      },
      "runtime",
      "FORBIDDEN",
    ],
    [
      {
        schemaVersion: 1,
        id: "dev.acme.labels",
        name: "标签",
        version: "1.0.0",
        apiVersion: { min: 1 },
        extensionKind: "label-preset",
        entry: { command: "main.exe" },
      },
      "entry",
      "FORBIDDEN",
    ],
  ])("enforces extension-kind requirements", (input, field, code) => {
    const result = parsePluginManifest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field, code })]),
    );
  });

  it("ignores unknown top-level fields for forward compatibility", () => {
    const result = parsePluginManifest({ ...validPrelabelManifest, futureField: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect("futureField" in result.value).toBe(false);
  });

  it("normalizes a fully declared exporter manifest", () => {
    const result = parsePluginManifest({
      schemaVersion: 1,
      id: "dev.acme.exporter",
      name: "导出器",
      version: "2.0.0-beta.1+build.7",
      apiVersion: { min: 2 },
      extensionKind: "exporter",
      runtime: "process",
      entry: { command: "plugin/main.exe", args: ["--stdio"] },
      capabilities: {
        annotationTypes: ["rect", "polygon", "point"],
        batch: true,
        progress: true,
        cancel: true,
        configMigration: true,
        exporter: { apiVersion: { min: 3 } },
        prelabel: { apiVersion: { min: 4 } },
      },
      permissions: ["fs.read:%PROJECT%/images", "fs.write:%APP_DATA%\\exports"],
      configVersion: 7,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.entry?.args).toEqual(["--stdio"]);
    expect(result.value.capabilities.exporter.apiVersion.min).toBe(3);
    expect(result.value.configVersion).toBe(7);
  });

  it("reports required and primitive type errors without throwing", () => {
    const result = parsePluginManifest({
      id: 7,
      name: null,
      version: false,
      apiVersion: "1",
      extensionKind: 7,
      entry: "main.exe",
      capabilities: [],
      permissions: "network",
      configVersion: "1",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ field, code }) => [field, code])).toEqual(
      expect.arrayContaining([
        ["schemaVersion", "REQUIRED"],
        ["id", "INVALID_TYPE"],
        ["name", "INVALID_TYPE"],
        ["version", "INVALID_TYPE"],
        ["apiVersion", "INVALID_TYPE"],
        ["extensionKind", "INVALID_VALUE"],
        ["capabilities", "INVALID_TYPE"],
        ["permissions", "INVALID_TYPE"],
        ["configVersion", "INVALID_VALUE"],
      ]),
    );
  });

  it("collects nested capability and entry type errors", () => {
    const result = parsePluginManifest({
      ...validPrelabelManifest,
      entry: { command: 1, args: ["--ok", 2] },
      capabilities: {
        annotationTypes: ["rect", "rect", "ellipse"],
        batch: "yes",
        progress: 1,
        cancel: null,
        configMigration: [],
        exporter: "v1",
        prelabel: { apiVersion: {} },
      },
      permissions: [1],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map(({ field, code }) => [field, code])).toEqual(
      expect.arrayContaining([
        ["entry.command", "INVALID_TYPE"],
        ["entry.args[1]", "INVALID_TYPE"],
        ["capabilities.annotationTypes[1]", "DUPLICATE"],
        ["capabilities.annotationTypes[2]", "INVALID_VALUE"],
        ["capabilities.batch", "INVALID_TYPE"],
        ["capabilities.exporter", "INVALID_TYPE"],
        ["capabilities.prelabel.apiVersion.min", "INVALID_VERSION"],
        ["permissions[0]", "UNKNOWN_PERMISSION"],
      ]),
    );
  });

  it("rejects non-object entries and non-array command arguments", () => {
    const badEntry = parsePluginManifest({ ...validPrelabelManifest, entry: "main.exe" });
    const badArgs = parsePluginManifest({
      ...validPrelabelManifest,
      entry: { command: "main.exe", args: "--stdio" },
    });

    expect(badEntry).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ field: "entry", code: "INVALID_TYPE" }),
        ]),
      }),
    );
    expect(badArgs).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining([
          expect.objectContaining({ field: "entry.args", code: "INVALID_TYPE" }),
        ]),
      }),
    );
  });

  it.each([
    ["C:outside.exe", "entry.command", "INVALID_PATH"],
    ["./main.exe", "entry.command", "INVALID_PATH"],
    [".", "entry.command", "INVALID_PATH"],
  ])("rejects entry paths outside the package boundary", (command, field, code) => {
    const result = parsePluginManifest({
      ...validPrelabelManifest,
      entry: { command },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ field, code }));
  });

  it.each([
    ["1.0.0-01", "version", "INVALID_FORMAT"],
    [{ min: 1, max: 2 }, "apiVersion.max", "FORBIDDEN"],
    [{ min: 4_294_967_296 }, "apiVersion.min", "INVALID_VERSION"],
  ])("enforces exact bounded version contracts", (value, field, code) => {
    const input =
      field === "version"
        ? { ...validPrelabelManifest, version: value }
        : { ...validPrelabelManifest, apiVersion: value };
    const result = parsePluginManifest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(expect.objectContaining({ field, code }));
  });

  it.each(["fs.read:%HOME%/x", "fs.write:%PROJECT%/../secret", "fs.read:C:/tmp"])(
    "rejects permission targets outside known placeholders",
    (permission) => {
      const result = parsePluginManifest({
        ...validPrelabelManifest,
        permissions: [permission],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.errors).toContainEqual(
        expect.objectContaining({ field: "permissions[0]", code: "UNKNOWN_PERMISSION" }),
      );
    },
  );

  it("treats slash variants of the same permission target as duplicates", () => {
    const result = parsePluginManifest({
      ...validPrelabelManifest,
      permissions: ["fs.read:%PROJECT%/images", "fs.read:%PROJECT%\\images"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: "permissions[1]", code: "DUPLICATE" }),
    );
  });

  it("keeps the JSON Schema top-level field set aligned with the TypeScript contract", () => {
    expect(Object.keys(manifestSchema.properties).sort()).toEqual(
      [...PLUGIN_MANIFEST_FIELDS].sort(),
    );
  });

  it("keeps critical JSON Schema constraints aligned with parser semantics", () => {
    const versionPattern = new RegExp(manifestSchema.properties.version.pattern);
    const forbiddenEntryPattern = new RegExp(
      manifestSchema.properties.entry.properties.command.not.pattern,
    );
    const permissionPattern = new RegExp(
      (manifestSchema.properties.permissions.items.anyOf[1] as { pattern: string }).pattern,
    );

    expect(versionPattern.test("1.0.0-beta.1+build.7")).toBe(true);
    expect(versionPattern.test("1.0.0-01")).toBe(false);
    expect(forbiddenEntryPattern.test("C:outside.exe")).toBe(true);
    expect(forbiddenEntryPattern.test("plugin/main.exe")).toBe(false);
    expect(forbiddenEntryPattern.test("plugin//main.exe")).toBe(true);
    expect(new RegExp(manifestSchema.properties.name.pattern).test("   ")).toBe(false);
    expect(new RegExp(manifestSchema.properties.entry.properties.command.pattern).test("   ")).toBe(
      false,
    );
    expect(permissionPattern.test("fs.read:%PROJECT%/images")).toBe(true);
    expect(permissionPattern.test("fs.read:%HOME%/images")).toBe(false);
    expect(permissionPattern.test("fs.read:%PROJECT%/im\0ages")).toBe(false);
    expect(manifestSchema.$defs.apiVersion.additionalProperties).toBe(false);
    expect(manifestSchema.$defs.apiVersion.properties.min.maximum).toBe(4_294_967_295);
  });
});
