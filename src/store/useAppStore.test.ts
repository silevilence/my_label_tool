import { describe, expect, it } from "vitest";
import { useAppStore } from "./useAppStore";

describe("app store", () => {
  it("tracks readiness", () => {
    useAppStore.getState().setReady(false);
    expect(useAppStore.getState().isReady).toBe(false);

    useAppStore.getState().setReady(true);
    expect(useAppStore.getState().isReady).toBe(true);
  });
});
