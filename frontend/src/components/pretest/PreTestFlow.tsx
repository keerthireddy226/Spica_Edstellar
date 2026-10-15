import { useState } from "react";
import { SystemCheck } from "@/components/pretest/SystemCheck";
import { TestDemo } from "@/components/pretest/TestDemo";
import { demoHidden, deviceNeedsFor } from "@/lib/systemCheck";

// Everything before a test starts: the device check, then the demo (which
// the learner can skip or switch off). Runs before the session is created,
// so a failed check never uses up an attempt.
export function PreTestFlow({
  kind,
  minutes,
  allowRemembered = true,
  onReady,
  onBack,
}: {
  // A test product id ("writing", "placement", ...).
  kind: string;
  minutes?: string | null;
  allowRemembered?: boolean;
  onReady: () => void;
  onBack?: () => void;
}) {
  const needs = deviceNeedsFor(kind);
  const [stage, setStage] = useState<"check" | "demo">("check");

  if (stage === "check") {
    return <SystemCheck needs={needs} allowRemembered={allowRemembered} onBack={onBack} onPassed={() => (demoHidden() ? onReady() : setStage("demo"))} />;
  }
  return <TestDemo kind={kind} needs={needs} minutes={minutes} onDone={onReady} />;
}
