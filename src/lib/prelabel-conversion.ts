import { PRELABEL_ZH_CN as text } from "../i18n/prelabel.zh-CN";
import type {
  PtConversionEvent,
  PtConversionParameters,
  PtConversionPlan,
} from "../types/prelabel";

export const DEFAULT_PT_CONVERSION_PARAMETERS: PtConversionParameters = {
  imgsz: 640,
  simplify: false,
};

const MAX_VISIBLE_OUTPUT_LINES = 2_000;

export type PtConversionSessionStatus = "confirming" | "running" | "cancelling" | "failed";

export interface PtConversionSession {
  conversionId: string;
  parameters: PtConversionParameters;
  status: PtConversionSessionStatus;
  output: string[];
  plan: PtConversionPlan | null;
  error: string;
}

export type PtConversionSessionAction =
  | { type: "start" }
  | { type: "preview"; plan: PtConversionPlan }
  | { type: "event"; event: PtConversionEvent }
  | { type: "cancel" }
  | { type: "fail"; error: string };

export function createPtConversionSession(
  conversionId: string,
  parameters: PtConversionParameters = DEFAULT_PT_CONVERSION_PARAMETERS,
): PtConversionSession {
  return {
    conversionId,
    parameters: { ...parameters },
    status: "confirming",
    output: [],
    plan: null,
    error: "",
  };
}

export function reducePtConversionSession(
  session: PtConversionSession,
  action: PtConversionSessionAction,
): PtConversionSession {
  if (action.type === "start") {
    return { ...session, status: "running", output: [], error: "" };
  }
  if (action.type === "preview") {
    return { ...session, plan: action.plan, error: "" };
  }
  if (action.type === "cancel") {
    return { ...session, status: "cancelling" };
  }
  if (action.type === "fail") {
    return { ...session, status: "failed", error: action.error };
  }
  if (action.event.conversionId !== session.conversionId) {
    return session;
  }
  if (action.event.event === "started") {
    return {
      ...session,
      plan: session.plan
        ? {
            ...session.plan,
            command: action.event.command,
            timeoutSeconds: action.event.timeoutSeconds,
          }
        : session.plan,
    };
  }
  return {
    ...session,
    output: [...session.output, action.event.line].slice(-MAX_VISIBLE_OUTPUT_LINES),
  };
}

export function validatePtConversionParameters(parameters: PtConversionParameters): string | null {
  return Number.isSafeInteger(parameters.imgsz) &&
    parameters.imgsz > 0 &&
    parameters.imgsz % 32 === 0
    ? null
    : text.ptImgSizeInvalid;
}

export function isPtConversionCancelledResult(reason: unknown): boolean {
  return String(reason) === text.ptCancelledResult;
}
