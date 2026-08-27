import { describe, expect, it } from "vitest";
import protocolSchema from "../../docs/plugin-protocol.schema.json";
import {
  PLUGIN_PROTOCOL_ERROR_CODES,
  PLUGIN_PROTOCOL_MESSAGE_TYPES,
  PLUGIN_PROTOCOL_VERSION,
  type PluginConfigMigrationParams,
  type PluginConfigMigrationResult,
  type PluginHelloParams,
  type PluginHelloResult,
  type PluginHostRequest,
  type PluginProtocolMessage,
} from "./plugin";

describe("plugin protocol contract", () => {
  it("keeps TypeScript and JSON Schema versions and discriminators aligned", () => {
    const schemaTypes = protocolSchema.oneOf.map(({ $ref }) => $ref.replace("#/$defs/", ""));
    expect(schemaTypes).toEqual([...PLUGIN_PROTOCOL_MESSAGE_TYPES]);
    expect(protocolSchema.$defs.request.properties.v.const).toBe(PLUGIN_PROTOCOL_VERSION);
    expect(protocolSchema.$defs.helloParams.properties.protocolVersion.const).toBe(
      PLUGIN_PROTOCOL_VERSION,
    );
    expect(protocolSchema.$defs.helloResult.properties.protocolVersion.const).toBe(
      PLUGIN_PROTOCOL_VERSION,
    );
  });

  it("defines the incremental config migration method contract", () => {
    const params: PluginConfigMigrationParams = {
      fromVersion: 1,
      toVersion: 2,
      config: { opaque: true },
    };
    const result: PluginConfigMigrationResult = {
      configVersion: 2,
      config: { opaque: "still opaque" },
    };

    expect(protocolSchema.$defs.configMigrationParams.required).toEqual([
      "fromVersion",
      "toVersion",
      "config",
    ]);
    expect(protocolSchema.$defs.configMigrationResult.required).toEqual([
      "configVersion",
      "config",
    ]);
    expect(params.toVersion).toBe(result.configVersion);
  });

  it("keeps all ten standard error codes aligned with the Schema", () => {
    expect(protocolSchema.$defs.errorCode.enum).toEqual([...PLUGIN_PROTOCOL_ERROR_CODES]);
    expect(PLUGIN_PROTOCOL_ERROR_CODES).toHaveLength(10);
  });

  it("models the four message unions and hello payloads", () => {
    const messages: PluginProtocolMessage[] = [
      { v: 1, id: "1", type: "request", method: "hello", params: {} },
      { v: 1, id: "1", type: "response", result: {} },
      { v: 1, id: "1", type: "event", event: "progress", payload: {} },
      { v: 1, id: null, type: "control", action: "heartbeat" },
    ];
    const helloParams: PluginHelloParams = {
      protocolVersion: 1,
      hostApiVersion: 1,
      supportedVersions: { hostApi: [1], exporter: [1], prelabel: [1] },
    };
    const helloResult: PluginHelloResult = {
      protocolVersion: 1,
      capabilities: { exporter: true },
    };

    expect(messages.map(({ type }) => type)).toEqual([...PLUGIN_PROTOCOL_MESSAGE_TYPES]);
    expect(helloParams.supportedVersions.hostApi).toEqual([1]);
    expect(helloResult.capabilities?.prelabel).toBeUndefined();
  });

  it("keeps reverse file proxy request contracts aligned with Schema", () => {
    const requests: PluginHostRequest[] = [
      { v: 1, id: "read-1", type: "request", method: "fs.read", params: { path: "C:/data/a.txt" } },
      {
        v: 1,
        id: "write-1",
        type: "request",
        method: "fs.write",
        params: { path: "C:/data/b.txt", contentUtf8: "saved" },
      },
    ];

    expect(requests.map(({ method }) => method)).toEqual(["fs.read", "fs.write"]);
    expect(protocolSchema.$defs.fsReadParams.required).toEqual(["path"]);
    expect(protocolSchema.$defs.fsWriteParams.required).toEqual(["path", "contentUtf8"]);
    expect(protocolSchema.$defs.fsReadResult.required).toEqual(["contentUtf8"]);
    expect(protocolSchema.$defs.fsWriteResult.required).toEqual(["writtenBytes"]);
  });

  it("keeps response exclusivity, progress percent, and cancel id constraints in Schema", () => {
    const progressSchema = protocolSchema.$defs.event.oneOf[0] as {
      properties: { payload: { properties: { percent: { type: string } } } };
    };
    expect(protocolSchema.$defs.response.oneOf).toHaveLength(2);
    expect(protocolSchema.$defs.response.oneOf[0].not.required).toEqual(["error"]);
    expect(protocolSchema.$defs.response.oneOf[1].not.required).toEqual(["result"]);
    expect(progressSchema.properties.payload.properties.percent.type).toBe("number");
    expect(protocolSchema.$defs.control.oneOf[0].properties.id).toEqual({
      type: "string",
      minLength: 1,
    });
  });
});
