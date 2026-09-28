// Run: node --experimental-strip-types scripts/verify-mcp-client.ts
// Uses the local desktop config. Never prints or transmits the token off loopback.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const file = process.env.MCP_CONFIG ?? join(process.env.APPDATA ?? "", "com.mylabeltool.app", "mcp.json");
const config = JSON.parse(await readFile(file, "utf8")) as { address: string; port: number; token: string };
assert.ok(config.address === "127.0.0.1" || config.address === "::1");
const address = config.address.includes(":") ? `[${config.address}]` : config.address;
const url = new URL(`http://${address}:${config.port}/mcp`);
const client = new Client({ name: "my-label-tool-sdk-verification", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } });
try {
  await client.connect(transport);
  const tools = await client.listTools();
  assert.ok(tools.tools.some(tool => tool.name === "app_state"));
  const state = await client.callTool({ name: "app_state", arguments: {} });
  assert.notEqual(state.isError, true);
  await client.ping();
  console.log(JSON.stringify({ client: "official TypeScript SDK", server: client.getServerVersion(), tools: tools.tools.map(t => t.name), state, passed: true }, null, 2));
  await transport.terminateSession();
} finally { await client.close(); }
