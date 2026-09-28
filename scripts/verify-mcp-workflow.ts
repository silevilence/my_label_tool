// Explicit local acceptance only. Never invokes a model or edits a user's existing project.
// 1. node --experimental-strip-types scripts/verify-mcp-workflow.ts --prepare
// 2. Open the printed fixture folder in the desktop application and load its project config.
// 3. Set MCP_VERIFY_WORKSPACE to that folder, run this script, approve the on-screen request,
//    and select the fixture's export/ directory for the export permission.
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

if (process.argv.includes("--prepare")) {
  const folder = await mkdtemp(join(tmpdir(), "my-label-mcp-acceptance-"));
  await mkdir(join(folder, "export"));
  await cp(resolve("src-tauri/icons/icon.png"), join(folder, "mcp-fixture.png"));
  await cp(resolve("src-tauri/icons/icon.png"), join(folder, "mcp-second.png"));
  const labels = [{ id: "mcp-person", name: "MCP 验收", color: "#38bdf8", shapeType: "rect" }];
  const annotationPath = join(folder, "annotations.json");
  await writeFile(annotationPath, JSON.stringify({ labels, images: [] }));
  await writeFile(
    join(folder, "my-label-tool.project.json"),
    JSON.stringify({
      schemaVersion: 1,
      format: "json",
      annotationPath,
      imageFolder: folder,
      exportedAt: new Date().toISOString(),
      labels,
      template: { id: "project-config", name: "项目临时配置" },
      exportOptions: { format: "json" },
    }),
  );
  console.log(folder);
} else {
  const folder = process.env.MCP_VERIFY_WORKSPACE;
  assert.ok(folder && resolve(folder).startsWith(join(tmpdir(), "my-label-mcp-acceptance-")));
  const config = JSON.parse(
    await readFile(
      process.env.MCP_CONFIG ?? join(process.env.APPDATA ?? "", "com.mylabeltool.app", "mcp.json"),
      "utf8",
    ),
  );
  assert.ok(config.address === "127.0.0.1" || config.address === "::1");
  const address = config.address.includes(":") ? `[${config.address}]` : config.address;
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://${address}:${config.port}/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${config.token}` } } },
  );
  const client = new Client({ name: "MCP 本机端到端验收", version: "1.0.0" });
  async function call(
    name: string,
    args: Record<string, unknown> = {},
    errorCode?: string,
  ): Promise<Record<string, unknown>> {
    const result = await client.callTool({ name, arguments: args });
    const body = result.structuredContent as Record<string, unknown>;
    if (errorCode) {
      assert.equal(result.isError, true);
      assert.equal(body.code, errorCode);
    } else assert.notEqual(result.isError, true, JSON.stringify(body));
    return body;
  }
  const sleep = () => new Promise((r) => setTimeout(r, 1000));
  try {
    await client.connect(transport);
    const project = await call("project_read");
    const images = project.images as { id: string; name: string }[];
    assert.deepEqual(images.map((i) => i.name).sort(), ["mcp-fixture.png", "mcp-second.png"]);
    assert.deepEqual(
      (project.labels as { id: string }[]).map((l) => l.id),
      ["mcp-person"],
    );
    const projectId = project.projectId,
      imageId = images.find((i) => i.name === "mcp-fixture.png")!.id;
    const before = await call("annotations_read", { projectId, imageId });
    assert.equal((before.annotations as unknown[]).length, 0, "Use a fresh fixture for each run");
    await call("control_request", { projectId, permissions: ["annotations", "save", "export"] });
    console.log("请在桌面批准 MCP 验收请求，并选择验收目录内的 export 文件夹。");
    let control = await call("control_status");
    const deadline = Date.now() + 60_000;
    while (control.mode === "pending" && Date.now() < deadline) {
      await sleep();
      control = await call("control_status");
    }
    assert.equal(control.mode, "mcp");
    const leaseId = control.leaseId;
    const base = () => ({ projectId, leaseId, expectedRevision: project.revision });
    const annotation = {
      id: "mcp-e2e-box",
      type: "rect",
      labelId: "mcp-person",
      points: [20, 20, 80, 50],
    };
    await call(
      "annotations_apply",
      {
        ...base(),
        changes: [
          { imageId, operation: "add", annotation: { ...annotation, points: [1, 2, -3, 4] } },
        ],
      },
      "INVALID_ARGUMENT",
    );
    let result = await call("annotations_apply", {
      ...base(),
      changes: [{ imageId, operation: "add", annotation }],
    });
    await call(
      "annotations_apply",
      { ...base(), changes: [{ imageId, operation: "delete", annotationId: annotation.id }] },
      "CONFLICT",
    );
    project.revision = result.revision;
    result = await call("annotations_apply", {
      ...base(),
      changes: [
        { imageId, operation: "update", annotation: { ...annotation, points: [30, 25, 80, 50] } },
        { imageId, operation: "delete", annotationId: annotation.id },
        { imageId, operation: "add", annotation },
      ],
    });
    project.revision = result.revision;
    const read = await call("annotations_read", { projectId, imageId });
    assert.deepEqual((read.annotations as { points: number[] }[])[0].points, annotation.points);
    for (const name of ["project_save", "project_export"]) {
      const task = await call(name, {
        ...base(),
        ...(name === "project_export" ? { format: "coco" } : {}),
      });
      let state = await call("task_status", { taskId: task.taskId });
      const deadline = Date.now() + 60_000;
      while (state.status === "running" && Date.now() < deadline) {
        await sleep();
        state = await call("task_status", { taskId: task.taskId });
      }
      assert.equal(state.status, "completed", JSON.stringify(state));
      project.revision = (state.result as { revision: number }).revision;
    }
    const native = JSON.parse(await readFile(join(folder, "annotations.json"), "utf8"));
    const coco = JSON.parse(
      await readFile(join(folder, "export", "annotations.coco.json"), "utf8"),
    );
    assert.equal(native.images[0].annotations.length, 1);
    assert.equal(coco.annotations.length, 1);
    assert.deepEqual(coco.annotations[0].bbox, annotation.points);
    await call("control_release", { leaseId });
    await call(
      "annotations_apply",
      { ...base(), changes: [{ imageId, operation: "delete", annotationId: annotation.id }] },
      "CONTROL_REVOKED",
    );
    console.log(
      JSON.stringify({
        passed: true,
        tools: (await client.listTools()).tools.length,
        checks: [
          "read",
          "invalid-coordinates",
          "revision-conflict",
          "atomic-add-update-delete",
          "save",
          "coco-export",
          "revoke",
        ],
      }),
    );
    await transport.terminateSession();
  } finally {
    await client.close();
  }
}
