import { describe, expect, it, vi } from "vitest";
import {
  RecoveryWriter,
  relativeImagePath,
  validAutosaveSettings,
  validateRecovery,
  type RecoveryContext,
  type RecoveryStatus,
} from "./recovery";
import type { RecoverySnapshot, RecoveryWrite } from "../types/recovery";

const label = { id: "l", name: "标签", color: "#ffffff", shapeType: "any" as const };
const shape = { id: "s", type: "rect" as const, labelId: "l", points: [1, 2, 3, 4] };
function fixture() {
  const context: RecoveryContext = {
    folder: "C:/project",
    annotations: { "C:/project/a.png": [shape], "C:/project/b.png": [shape] },
    metadata: {
      labels: [label],
      projectConfig: null,
      configPath: "",
      selectedPath: "C:/project/a.png",
    },
  };
  let status: RecoveryStatus | undefined;
  const write = vi.fn(
    async (_folder: string, update: RecoveryWrite) => update.expectedRevision + 1,
  );
  const writer = new RecoveryWriter(
    () => context,
    write,
    (next) => {
      status = next;
    },
  );
  writer.initialize(0, false);
  return { writer, write, context, status: () => status! };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("incremental recovery queue", () => {
  it("creates a full baseline once then saves only the departed dirty image including empty annotations", async () => {
    const f = fixture();
    await f.writer.save();
    expect(Object.keys(f.write.mock.calls[0][1].changes)).toEqual(["a.png", "b.png"]);
    f.context.annotations = {
      ...f.context.annotations,
      "C:/project/a.png": [],
      "C:/project/b.png": [],
    };
    f.writer.mark(["C:/project/a.png", "C:/project/b.png"]);
    await f.writer.save(["C:/project/a.png"]);
    expect(f.write.mock.calls[1][1]).toMatchObject({ reset: false, changes: { "a.png": [] } });
    expect(Object.keys(f.write.mock.calls[1][1].changes)).toEqual(["a.png"]);
    expect(f.writer.hasChanges).toBe(true);
    await f.writer.save();
    expect(Object.keys(f.write.mock.calls[2][1].changes)).toEqual(["b.png"]);
    await f.writer.save();
    expect(f.write).toHaveBeenCalledTimes(3);
    expect(f.status().dirty).toBe(false);
  });
  it("does not acknowledge edits made while an older snapshot is being written", async () => {
    const f = fixture();
    await f.writer.save();
    const gate = deferred<number>();
    f.write.mockReturnValueOnce(gate.promise);
    f.writer.mark(["C:/project/a.png"]);
    const saving = f.writer.save();
    await Promise.resolve();
    f.context.annotations = { ...f.context.annotations, "C:/project/a.png": [] };
    f.writer.mark(["C:/project/a.png"]);
    expect(f.writer.isSaving).toBe(true);
    gate.resolve(2);
    await saving;
    expect(f.writer.hasChanges).toBe(true);
    await f.writer.save();
    expect(f.write.mock.calls[2][1].changes).toEqual({ "a.png": [] });
  });
  it("coalesces rapid switch requests without dropping earlier departed images", async () => {
    const f = fixture();
    await f.writer.save();
    f.writer.mark(["C:/project/a.png", "C:/project/b.png"]);
    const first = f.writer.save(["C:/project/a.png"]);
    expect(f.writer.save(["C:/project/b.png"])).toBe(first);
    await first;
    expect(f.write.mock.calls[1][1].changes).toHaveProperty("a.png");
    expect(f.write.mock.calls[1][1].changes).toHaveProperty("b.png");
    expect(f.writer.hasChanges).toBe(false);
  });
  it("queues manual save after autosave and captures edits made while waiting", async () => {
    const f = fixture();
    await f.writer.save();
    const gate = deferred<number>();
    f.write.mockReturnValueOnce(gate.promise);
    f.writer.mark(["C:/project/a.png"]);
    const saving = f.writer.save();
    await Promise.resolve();
    const action = vi.fn(async () => true);
    const manual = f.writer.manual(action, Boolean);
    f.context.annotations = { ...f.context.annotations, "C:/project/b.png": [] };
    f.writer.mark(["C:/project/b.png"]);
    expect(action).not.toHaveBeenCalled();
    gate.resolve(2);
    await saving;
    await manual;
    expect(action).toHaveBeenCalledOnce();
    expect(f.write.mock.calls[2][1].changes).toEqual({ "b.png": [] });
    expect(f.writer.hasChanges).toBe(false);
  });
  it("retains failed changes, retries on the same revision and keeps the queue usable", async () => {
    const f = fixture();
    await f.writer.save();
    f.writer.mark(["C:/project/a.png"]);
    f.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(f.writer.save()).rejects.toThrow("disk full");
    expect(f.status()).toMatchObject({ saving: false, dirty: true, error: "Error: disk full" });
    await f.writer.save();
    expect(f.write.mock.calls[2][1].expectedRevision).toBe(1);
    expect(f.status()).toMatchObject({ dirty: false, error: "" });
  });
  it("keeps metadata and changed annotations in one commit and preserves late metadata changes", async () => {
    const f = fixture();
    await f.writer.save();
    f.writer.mark(["C:/project/a.png", "C:/project/b.png"]);
    f.writer.markMetadata();
    const gate = deferred<number>();
    f.write.mockReturnValueOnce(gate.promise);
    const pending = f.writer.save(["C:/project/a.png"]);
    await Promise.resolve();
    f.writer.markMetadata();
    gate.resolve(2);
    await pending;
    expect(Object.keys(f.write.mock.calls[1][1].changes)).toHaveLength(2);
    expect(f.writer.hasChanges).toBe(true);
    await f.writer.save();
    expect(f.write.mock.calls[2][1].changes).toEqual({});
    expect(f.writer.hasChanges).toBe(false);
  });
  it("writes removal tombstones and resumes existing copies without a full baseline", async () => {
    const f = fixture();
    f.writer.initialize(8, true, "previous");
    delete f.context.annotations["C:/project/a.png"];
    f.writer.mark(["C:/project/a.png"]);
    await f.writer.save();
    expect(f.write.mock.calls[0][1]).toMatchObject({
      expectedRevision: 8,
      reset: false,
      changes: { "a.png": null },
    });
  });
  it("does not save cancelled manual exports or empty workspaces", async () => {
    const f = fixture();
    f.writer.mark([]);
    await f.writer.manual(async () => false, Boolean);
    expect(f.write).not.toHaveBeenCalled();
    f.context.folder = "";
    await f.writer.save();
    expect(f.write).not.toHaveBeenCalled();
  });
  it("handles requests arriving during a write as a following commit", async () => {
    const f = fixture();
    await f.writer.save();
    const gate = deferred<number>();
    f.write.mockReturnValueOnce(gate.promise);
    f.writer.mark(["C:/project/a.png"]);
    const saving = f.writer.save();
    await Promise.resolve();
    f.writer.mark(["C:/project/b.png"]);
    f.writer.save(["C:/project/b.png"]);
    gate.resolve(2);
    await saving;
    expect(f.write).toHaveBeenCalledTimes(3);
  });
});

describe("recovery validation", () => {
  const snapshot = (): RecoverySnapshot => ({
    revision: 1,
    metadata: {
      labels: [label],
      projectConfig: null,
      configPath: "",
      selectedPath: "",
      savedAt: "2026-11-07T00:00:00Z",
    },
    annotations: { "a.png": [shape] },
  });
  it("validates complete geometry and preserves attributes and frame numbers", () => {
    const copy = snapshot();
    copy.annotations["a.png"] = [
      {
        ...shape,
        type: "polygon",
        points: [1, 2, 3, 4, 5, 6],
        attributes: { track: "42" },
        frameIndex: 7,
      },
      { ...shape, id: "point", type: "point", points: [4, 5] },
    ];
    expect(validateRecovery(copy).annotations).toEqual(copy.annotations);
  });
  it.each([
    (s: RecoverySnapshot) => {
      s.revision = 0;
    },
    (s: RecoverySnapshot) => {
      s.metadata.savedAt = "bad";
    },
    (s: RecoverySnapshot) => {
      s.annotations["a.png"] = [{ ...shape, labelId: "missing" }];
    },
    (s: RecoverySnapshot) => {
      s.annotations["a.png"] = [shape, shape];
    },
    (s: RecoverySnapshot) => {
      s.annotations["a.png"] = [{ ...shape, frameIndex: -1 }];
    },
    (s: RecoverySnapshot) => {
      s.annotations["../outside"] = [];
    },
    (s: RecoverySnapshot) => {
      s.annotations["a.png"] = [{ ...shape, points: [0, 0, -1, 2] }];
    },
  ])("rejects damaged copies instead of normalizing away data", (damage) => {
    const s = snapshot();
    damage(s);
    expect(() => validateRecovery(s)).toThrow();
  });
  it("normalizes Windows project roots but rejects outside and traversal paths", () => {
    expect(relativeImagePath("C:\\Project\\", "c:/project/sub/a.png")).toBe("sub/a.png");
    for (const path of ["D:/outside.png", "C:/project/../a", "C:/project/a//b", "C:/project/a:b"])
      expect(() => relativeImagePath("C:/project", path)).toThrow();
  });
  it("checks modes and bounded integer intervals", () => {
    expect(validAutosaveSettings({ mode: "off", intervalSeconds: 60 })).toBe(true);
    for (const intervalSeconds of [0, 9, 10.5, 3601, NaN])
      expect(validAutosaveSettings({ mode: "interval", intervalSeconds })).toBe(false);
    expect(validAutosaveSettings({ mode: "switch", intervalSeconds: 10 })).toBe(true);
  });
});
