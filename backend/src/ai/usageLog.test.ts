import { describe, expect, it } from "vitest";
import { costUsd, currentAiContext, noteAiSession, withAiContext } from "./usageLog.js";

describe("costUsd", () => {
  it("prices Flash-Lite and Flash per million tokens (Flash-Lite matched before Flash)", () => {
    expect(costUsd("gemini-3.5-flash-lite", 1_000_000, 0)).toBeCloseTo(0.3);
    expect(costUsd("gemini-3.5-flash-lite", 0, 1_000_000)).toBeCloseTo(2.5);
    expect(costUsd("gemini-3.5-flash", 1_000_000, 1_000_000)).toBeCloseTo(10.5);
  });
  it("returns null for a model without a price", () => {
    expect(costUsd("some-other-model", 1000, 1000)).toBeNull();
  });
});

describe("AI call context", () => {
  it("carries purpose and session through async calls, inner values winning", async () => {
    await withAiContext({ purpose: "report" }, async () => {
      await Promise.resolve();
      expect(currentAiContext().purpose).toBe("report");
      await withAiContext({ purpose: "grading", sessionId: "s1" }, async () => {
        expect(currentAiContext()).toMatchObject({ purpose: "grading", sessionId: "s1" });
      });
      expect(currentAiContext().sessionId).toBeUndefined();
    });
  });
  it("noteAiSession tags the rest of the current flow", async () => {
    await withAiContext({}, async () => {
      noteAiSession("s2");
      await Promise.resolve();
      expect(currentAiContext().sessionId).toBe("s2");
    });
  });
});
