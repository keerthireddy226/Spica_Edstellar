import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, Camera, CheckCircle2, Clock, IdCard, Lock, Mic, MonitorUp, ShieldCheck, TimerOff } from "lucide-react";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { refreshBranding } from "@/components/AppShell/useBranding";
import { CandidateFinished, CandidatePanel, CandidateShell } from "@/components/recruitment/CandidateShell";
import { TEST_KIND_LABEL, TEST_MINUTES } from "@/components/recruitment/testKinds";
import { PlacementTest } from "@/pages/PlacementTest";
import { PracticeTests } from "@/pages/PracticeTests";
import { startExamSession } from "@/api/practiceTests";
import { getCandidateAssessment, getInvite, startInvite, type CandidateAssessment, type InviteInfo } from "@/api/recruitment";
import { ApiError } from "@/lib/api";
import { tr } from "@/i18n/tr";
import { PreTestFlow } from "@/components/pretest/PreTestFlow";

// The emailed link: what the assessment is, then signing the candidate in.
export function AssessInvite() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getInvite(token)
      .then(setInfo)
      .catch(() => setError(tr("This link isn't valid. Check that you opened the whole link from the email.")));
  }, [token]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await startInvite(token);
      await refresh();
      refreshBranding();
      navigate("/candidate", { replace: true });
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      setError(
        code === "already_completed"
          ? tr("You've already completed this assessment.")
          : code === "invite_expired" || code === "job_closed"
            ? tr("This invitation has expired. Ask the recruiter for a new link.")
            : tr("Could not start the assessment. Try again."),
      );
      setBusy(false);
    }
  }

  if (error && !info) {
    return (
      <CandidateShell>
        <CandidatePanel icon={<TimerOff size={26} />} title={tr("Link not valid")} subtitle={error} />
      </CandidateShell>
    );
  }
  if (!info) return null;
  if (info.status === "completed" || info.status === "expired") {
    return (
      <CandidateShell org={info.organization.name}>
        <CandidatePanel
          icon={info.status === "completed" ? <CheckCircle2 size={26} /> : <TimerOff size={26} />}
          title={info.status === "completed" ? tr("Assessment completed") : tr("This invitation has expired")}
          subtitle={
            info.status === "completed"
              ? tr("Thank you. {{org}} has your results.", {
                  org: info.organization.name,
                })
              : tr("Ask the recruiter for a new link.")
          }
        />
      </CandidateShell>
    );
  }
  const needs: [boolean, ReactNode, string][] = [
    [info.proctoring.camera, <Camera key="c" size={16} />, tr("A camera: you're visible during the test")],
    [info.proctoring.microphone, <Mic key="m" size={16} />, tr("A microphone, in a quiet room")],
    [info.proctoring.screen, <MonitorUp key="s" size={16} />, tr("A computer: you'll share your entire screen")],
    [info.proctoring.idDocument, <IdCard key="i" size={16} />, tr("Your passport or national ID card")],
    [info.proctoring.secureBrowser, <Lock key="l" size={16} />, tr("Safe Exam Browser, as your recruiter instructed")],
  ];
  return (
    <CandidateShell org={info.organization.name}>
      <CandidatePanel
        icon={<Briefcase size={26} />}
        title={info.firstName ? tr("Hello {{name}}", { name: info.firstName }) : tr("Your English assessment")}
        subtitle={tr("{{org}} invited you to an English assessment for {{job}}.", { org: info.organization.name, job: info.job.title })}
      >
        <div className="bg-paper-warm rounded-input p-4 flex flex-col gap-1.5 text-sm text-ink">
          <p className="font-semibold">{TEST_KIND_LABEL[info.testKind]()}</p>
          <p className="flex items-center gap-1.5 text-muted">
            <Clock size={14} />{" "}
            {tr("About {{m}} minutes. Do it in one sitting.", {
              m: TEST_MINUTES[info.testKind],
            })}
          </p>
          <p className="text-xs text-muted">
            {tr("The link works until {{date}}.", {
              date: new Date(info.expiresAt).toLocaleDateString(),
            })}
          </p>
        </div>
        {needs.some(([on]) => on) && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("You'll need")}</p>
            {needs
              .filter(([on]) => on)
              .map(([, icon, text]) => (
                <p key={text} className="flex items-center gap-2 text-sm text-ink">
                  <span className="text-navy-deep">{icon}</span> {text}
                </p>
              ))}
          </div>
        )}
        {error && <p className="text-sm text-error text-center">{error}</p>}
        <Button onClick={start} disabled={busy}>
          {busy ? tr("Starting...") : tr("Start the assessment")}
        </Button>
        <p className="text-xs text-muted text-center">{tr("Before the test you'll see exactly what is monitored and agree to it.")}</p>
      </CandidatePanel>
    </CandidateShell>
  );
}

// The signed-in candidate: a short briefing, then the test itself.
export function CandidateAssessmentPage() {
  const [a, setA] = useState<CandidateAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [busy, setBusy] = useState(false);
  // "I'm ready" opens the device check and demo; the test starts after them.
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    getCandidateAssessment()
      .then((x) => {
        setA(x);
        // Coming back to a test already under way goes straight back in.
        if (x.sessionId) {
          setSearchParams({ session: x.sessionId }, { replace: true });
          setStarted(true);
        }
      })
      .catch(() => setError(tr("Your assessment couldn't be loaded. Open the link from your email again.")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function begin() {
    if (!a) return;
    setBusy(true);
    try {
      if (a.testKind !== "placement" && a.examId) {
        const s = await startExamSession(a.examId);
        setSearchParams({ session: s.sessionId }, { replace: true });
      }
      setStarted(true);
    } catch {
      setError(tr("Could not start the test. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <CandidateShell>
        <CandidatePanel icon={<TimerOff size={26} />} title={tr("Something went wrong")} subtitle={error} />
      </CandidateShell>
    );
  }
  if (!a) return null;
  if (a.status === "completed") return <CandidateFinished />;
  if (a.status === "expired") {
    return (
      <CandidateShell org={a.organization}>
        <CandidatePanel icon={<TimerOff size={26} />} title={tr("This invitation has expired")} subtitle={tr("Ask the recruiter for a new link.")} />
      </CandidateShell>
    );
  }
  if (preparing && !started) {
    return (
      <div className="app-surface min-h-screen px-4 sm:px-6 py-10">
        {/* One attempt only: always a fresh check, never a remembered one. */}
        <PreTestFlow kind={a.testKind} minutes={TEST_MINUTES[a.testKind]} allowRemembered={false} onBack={() => setPreparing(false)} onReady={() => !busy && begin()} />
      </div>
    );
  }
  if (started && a.testKind === "placement") return <PlacementTest />;
  if (started && searchParams.get("session")) {
    return (
      <div className="app-surface min-h-screen px-4 sm:px-6 py-6">
        <PracticeTests />
      </div>
    );
  }
  return (
    <CandidateShell org={a.organization}>
      <CandidatePanel
        icon={<ShieldCheck size={26} />}
        title={tr("Before you start")}
        subtitle={tr("{{job}} · {{test}}", {
          job: a.jobTitle,
          test: TEST_KIND_LABEL[a.testKind](),
        })}
      >
        <ul className="flex flex-col gap-2 text-sm text-ink">
          {[
            tr("Sit in a quiet, well-lit room, alone."),
            tr("Use headphones only if your recruiter allows them; keep your speakers at a normal volume."),
            tr("Keep this tab open until the end. Leaving it is recorded."),
            tr("You have one attempt. Your answers save as you go, so a dropped connection doesn't lose them."),
          ].map((t) => (
            <li key={t} className="flex items-start gap-2">
              <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> {t}
            </li>
          ))}
        </ul>
        <Button onClick={() => setPreparing(true)} disabled={busy}>
          {busy ? tr("Starting...") : tr("I'm ready")}
        </Button>
      </CandidatePanel>
    </CandidateShell>
  );
}
