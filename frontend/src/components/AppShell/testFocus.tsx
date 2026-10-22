import { createContext, useContext, useEffect, useState, type RefObject } from "react";
import { Flag, GraduationCap } from "lucide-react";
import { Button } from "@/components/Button";
import { ConfirmActionModal } from "@/components/ConfirmActionModal";
import type { DeliveryMode } from "@/api/proctoring";
import { tr } from "@/i18n/tr";

// A timed test in progress (mock, real test, free sample, level test) takes
// over the page: no menu or header to wander off through, only a slim bar
// with Finish test in the corner.
export interface TestFocus {
  mode: DeliveryMode;
  // false while the test can't be ended from the bar (proctoring steps, scoring).
  canFinish: boolean;
  // Hands in the answer on screen and finishes the test.
  finish: RefObject<() => Promise<void>>;
}

const SetFocus = createContext<(f: TestFocus | null) => void>(() => {});
export const TestFocusProvider = SetFocus.Provider;

// The test page calls this on every render; on is false outside a timed test.
export function useTestFocus(on: boolean, mode: DeliveryMode, canFinish: boolean, finish: RefObject<() => Promise<void>>) {
  const set = useContext(SetFocus);
  useEffect(() => {
    set(on ? { mode, canFinish, finish } : null);
  }, [set, on, mode, canFinish, finish]);
  useEffect(() => () => set(null), [set]);
}

export function TestFocusBar({ focus }: { focus: TestFocus }) {
  const [confirming, setConfirming] = useState(false);
  const [ending, setEnding] = useState(false);
  const end = async () => {
    setEnding(true);
    try {
      await focus.finish.current?.();
    } finally {
      setEnding(false);
      setConfirming(false);
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 bg-surface border-b border-rule print:hidden">
      <span className="flex items-center gap-2">
        <span className="h-8 w-8 rounded-input bg-navy text-lime flex items-center justify-center shrink-0">
          <GraduationCap size={20} strokeWidth={1.8} />
        </span>
        <span className="font-logo font-bold text-ink">{tr("Spica")}</span>
      </span>
      {focus.canFinish && (
        <Button variant="secondary" onClick={() => setConfirming(true)} className="flex items-center gap-2 !py-2">
          <Flag size={16} /> {tr("Finish test")}
        </Button>
      )}
      {confirming && (
        <ConfirmActionModal
          title={tr("Finish the test now?")}
          message={
            focus.mode === "certified"
              ? tr("Your answer on screen is handed in, and questions you haven't answered count as wrong. You can't come back to this test, and it uses your attempt.")
              : tr("Your answer on screen is handed in, and questions you haven't answered count as wrong. You can't come back to this test.")
          }
          confirmLabel={tr("Finish test")}
          destructive
          submitting={ending}
          onClose={() => !ending && setConfirming(false)}
          onConfirm={() => void end()}
        />
      )}
    </div>
  );
}
