import { describe, expect, it } from "vitest";
import {
  DEFAULT_PT_CONVERSION_PARAMETERS,
  createPtConversionSession,
  isPtConversionCancelledResult,
  reducePtConversionSession,
  validatePtConversionParameters,
} from "./prelabel-conversion";
import type { PtConversionPlan } from "../types/prelabel";

describe("PT conversion session", () => {
  it("stores the exact command plan returned by the backend", () => {
    const session = reducePtConversionSession(createPtConversionSession("conversion-1"), {
      type: "preview",
      plan: plan(),
    });

    expect(session.plan).toEqual(plan());
  });

  it("accepts only a positive imgsz that is a multiple of 32", () => {
    expect(validatePtConversionParameters({ imgsz: 0, simplify: false })).toContain("32");
    expect(validatePtConversionParameters({ imgsz: 641, simplify: false })).toContain("32");
    expect(validatePtConversionParameters({ imgsz: 1280, simplify: true })).toBeNull();
  });

  it("distinguishes a confirmed cancellation from process-tree termination failures", () => {
    expect(isPtConversionCancelledResult("模型转换已中止")).toBe(true);
    expect(isPtConversionCancelledResult("终止模型转换进程树失败")).toBe(false);
  });

  it("tracks streamed output and cancellation without accepting another task's events", () => {
    const confirming = createPtConversionSession("conversion-1");
    const running = reducePtConversionSession(confirming, { type: "start" });
    const ignored = reducePtConversionSession(running, {
      type: "event",
      event: { event: "output", conversionId: "conversion-2", line: "ignore" },
    });
    const withOutput = reducePtConversionSession(ignored, {
      type: "event",
      event: { event: "output", conversionId: "conversion-1", line: "Downloading 20%" },
    });
    const cancelling = reducePtConversionSession(withOutput, { type: "cancel" });

    expect(confirming.status).toBe("confirming");
    expect(running.status).toBe("running");
    expect(ignored.output).toEqual([]);
    expect(cancelling).toMatchObject({
      status: "cancelling",
      output: ["Downloading 20%"],
    });
  });

  it("records the backend command contract and exposes failures", () => {
    const session = reducePtConversionSession(createPtConversionSession("conversion-1"), {
      type: "preview",
      plan: plan(),
    });
    const started = reducePtConversionSession(session, {
      type: "event",
      event: {
        event: "started",
        conversionId: "conversion-1",
        command: "uvx --from ultralytics yolo export",
        timeoutSeconds: 1_200,
      },
    });
    const failed = reducePtConversionSession(started, {
      type: "fail",
      error: "network unavailable",
    });

    expect(started).toMatchObject({
      plan: {
        command: "uvx --from ultralytics yolo export",
        timeoutSeconds: 1_200,
      },
    });
    expect(failed).toMatchObject({ status: "failed", error: "network unavailable" });
  });

  it("bounds visible output", () => {
    let session = createPtConversionSession("conversion-1");
    for (let index = 0; index <= 2_000; index += 1) {
      session = reducePtConversionSession(session, {
        type: "event",
        event: { event: "output", conversionId: "conversion-1", line: `line-${index}` },
      });
    }

    expect(session.output).toHaveLength(2_000);
    expect(session.output[0]).toBe("line-1");
  });
});

function plan(): PtConversionPlan {
  return {
    parameters: DEFAULT_PT_CONVERSION_PARAMETERS,
    method: "uvx-yolo",
    executable: "uvx",
    command: "uvx --from ultralytics yolo export",
    timeoutSeconds: 1_200,
  };
}
