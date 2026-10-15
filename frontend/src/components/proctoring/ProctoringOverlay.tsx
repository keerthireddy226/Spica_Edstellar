import { useEffect, useRef } from "react";
import { AlertTriangle, MessageSquareWarning, ShieldCheck, ShieldX, X } from "lucide-react";
import { Button } from "@/components/Button";
import type { ProctorWarning, ProctoringState } from "@/hooks/useProctoring";
import { tr } from "@/i18n/tr";

const WARNING_TEXT: Record<ProctorWarning, () => string> = {
  tab_hidden: () => tr("You left the test window. Stay on this tab until you finish; this is recorded."),
  paste_blocked: () => tr("Pasting is turned off during this test. Type your answer."),
  copy_blocked: () => tr("Copying is turned off during this test."),
  fullscreen_exit: () => tr("This test runs in full screen. Return to full screen to continue."),
  multi_monitor: () => tr("A second screen is connected. Disconnect it for this test."),
  no_face: () => tr("We can't see your face. Sit in front of the camera."),
  multiple_people: () => tr("Someone else is in view. Only you should be visible during the test."),
  phone: () => tr("A phone is in view. Put it away until you finish."),
  camera_off: () => tr("Your camera turned off. Turn it back on to continue being monitored."),
  second_tab: () => tr("This test is open in another tab or window. Close the other one."),
  offline: () => tr("You're offline. Your answers are saved once you reconnect."),
};

function SelfView({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted className="h-16 w-20 rounded-lg object-cover bg-ink" />;
}

// What a proctored learner sees on top of the test: that monitoring is on,
// any warning, a proctor's message, and the end screen if the proctor
// ended the session.
export function ProctoringOverlay({ proctor, onFinish }: { proctor: ProctoringState; onFinish: () => void }) {
  const { setup, warning, message, terminated } = proctor;
  if (!setup?.proctored) return null;

  if (terminated) {
    return (
      <div className="fixed inset-0 z-[60] bg-ink/70 flex items-center justify-center px-4">
        <div className="bg-surface border border-rule rounded-card shadow-lg p-6 max-w-sm w-full flex flex-col items-center gap-4 text-center">
          <span className="h-12 w-12 rounded-full bg-error/15 text-error flex items-center justify-center">
            <ShieldX size={26} />
          </span>
          <h2 className="font-display font-bold text-lg text-ink">{tr("The proctor ended this test")}</h2>
          {proctor.terminateReason && <p className="text-sm text-muted">{proctor.terminateReason}</p>}
          <p className="text-xs text-muted">{tr("Your answers so far are saved and will be reviewed.")}</p>
          <Button onClick={onFinish} className="w-full">
            {tr("See my result")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {warning && (
        <div role="alert" className="fixed top-3 inset-x-3 z-[55] mx-auto max-w-xl bg-warning/95 text-navy-deep rounded-card shadow-md px-4 py-3 flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <p className="text-sm font-medium flex-1">{WARNING_TEXT[warning]()}</p>
          {warning === "fullscreen_exit" ? (
            <button onClick={proctor.enterFullscreen} className="text-sm font-semibold underline cursor-pointer shrink-0">
              {tr("Full screen")}
            </button>
          ) : (
            <button onClick={proctor.dismissWarning} aria-label={tr("Dismiss")} className="shrink-0 cursor-pointer">
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {message && (
        <div className="fixed inset-0 z-[58] bg-ink/50 flex items-center justify-center px-4">
          <div className="bg-surface border border-rule rounded-card shadow-lg p-6 max-w-sm w-full flex flex-col gap-4">
            <div className="flex items-center gap-2 text-navy-deep">
              <MessageSquareWarning size={20} />
              <h2 className="font-display font-bold text-lg">{tr("Message from your proctor")}</h2>
            </div>
            <p className="text-sm text-ink whitespace-pre-line">{message}</p>
            <Button onClick={proctor.ackMessage}>{tr("OK")}</Button>
          </div>
        </div>
      )}

      <div className="fixed bottom-3 right-3 z-50 bg-surface/95 border border-rule rounded-card shadow-md p-2 flex items-center gap-2">
        {proctor.cameraStream && <SelfView stream={proctor.cameraStream} />}
        <div className="flex flex-col pr-1">
          <span className="flex items-center gap-1 text-xs font-semibold text-success">
            <ShieldCheck size={14} /> {tr("Proctored")}
          </span>
          <span className="text-[11px] text-muted">{proctor.cameraStream ? tr("Camera on") : tr("Activity monitored")}</span>
        </div>
      </div>
    </>
  );
}
