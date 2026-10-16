import { useState } from "react";
import { SystemCheck } from "@/components/pretest/SystemCheck";
import { TestDemo } from "@/components/pretest/TestDemo";
import { TestConsent } from "@/components/pretest/TestConsent";
import type { PreTestKind } from "@/api/proctoring";
import { demoHidden, deviceNeedsFor } from "@/lib/systemCheck";

// Everything before a test starts: the device check, the demo (which the
// learner can skip or switch off), then consent to what the test collects.
// Runs before the session is created, so none of it uses up an attempt.
export function PreTestFlow({
  kind,
  minutes,
  onReady,
  onBack,
}: {
  // A test product id ("writing", "placement", ...).
  kind: PreTestKind;
  minutes?: string | null;
  onReady: () => void;
  onBack?: () => void;
}) {
  const needs = deviceNeedsFor(kind);
  const [stage, setStage] = useState<"check" | "demo" | "consent">("check");

  if (stage === "check") {
    return <SystemCheck needs={needs} onBack={onBack} onPassed={() => setStage(demoHidden() ? "consent" : "demo")} />;
  }
  if (stage === "demo") return <TestDemo kind={kind} needs={needs} minutes={minutes} onDone={() => setStage("consent")} />;
  return <TestConsent kind={kind} onBack={onBack} onAgreed={onReady} />;
}
