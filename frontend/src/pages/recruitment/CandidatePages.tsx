import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Briefcase, CheckCircle2, TimerOff } from "lucide-react";
import { Button } from "@/components/Button";
import { useAuth } from "@/hooks/useAuth";
import { refreshBranding } from "@/components/AppShell/useBranding";
import { CandidateFinished, CandidatePanel, CandidateShell } from "@/components/recruitment/CandidateShell";
import { TEST_MINUTES } from "@/components/recruitment/testKinds";
import { CandidateChecklist } from "@/components/recruitment/CandidateChecklist";
import { PlacementTest } from "@/pages/PlacementTest";
import { PracticeTests } from "@/pages/PracticeTests";
import { TestFocusBar, TestFocusProvider, type TestFocus } from "@/components/AppShell/testFocus";
import { startExamSession } from "@/api/practiceTests";
import { getApplyInfo, getCandidateAssessment, getInvite, sendApplyCode, startInvite, verifyApplyCode, type ApplyInfo, type CandidateAssessment, type InviteInfo } from "@/api/recruitment";
import { ApiError } from "@/lib/api";
import { tr } from "@/i18n/tr";
import { QuickPreTest } from "@/components/pretest/QuickPreTest";
import { VoiceSection } from "@/components/VoiceSection";
import type { PreTestKind } from "@/api/proctoring";

// While the invitation or assessment loads: the same frame, not a blank page.
function CandidateLoading() {
  return (
    <CandidateShell>
      <div className="w-full max-w-lg bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col items-center gap-4" aria-busy="true">
        <span className="h-14 w-14 rounded-2xl bg-paper-warm animate-pulse" />
        <span className="h-5 w-48 rounded bg-paper-warm animate-pulse" />
        <span className="h-4 w-64 rounded bg-paper-warm animate-pulse" />
        <p className="sr-only">{tr("Loading…")}</p>
      </div>
    </CandidateShell>
  );
}

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
            ? info?.admissions
              ? tr("This invitation has expired. Ask the admissions office for a new link.")
              : tr("This invitation has expired. Ask the recruiter for a new link.")
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
  if (!info) return <CandidateLoading />;
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
              : info.admissions
                ? tr("Ask the admissions office for a new link.")
                : tr("Ask the recruiter for a new link.")
          }
        />
      </CandidateShell>
    );
  }
  return (
    <CandidateShell org={info.organization.name}>
      <CandidatePanel
        wide
        icon={<Briefcase size={26} />}
        title={info.firstName ? tr("Hello {{name}}", { name: info.firstName }) : tr("Your English assessment")}
        subtitle={tr("{{org}} invited you to an English assessment for {{job}}.", { org: info.organization.name, job: info.job.title })}
      >
        <CandidateChecklist testKind={info.testKind} proctoring={info.proctoring} expiresAt={info.expiresAt} admissions={info.admissions} orgName={info.organization.name} />
        {error && <p className="text-sm text-error text-center">{error}</p>}
        <Button onClick={start} disabled={busy} className="w-full max-w-md self-center">
          {busy ? tr("Starting...") : tr("Start the assessment")}
        </Button>
        <p className="text-xs text-muted text-center">{tr("Before the test you'll see exactly what is monitored and agree to it.")}</p>
      </CandidatePanel>
    </CandidateShell>
  );
}

// A job's public link (posted on job websites): the applicant gives their
// name and email, confirms the email with a code, and starts the test.
export function ApplyByLink() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [info, setInfo] = useState<ApplyInfo | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApplyInfo(slug)
      .then(setInfo)
      .catch(() => setNotFound(true));
  }, [slug]);

  const reason = (err: unknown) => {
    const c = err instanceof ApiError ? err.message : "";
    return c === "wrong_code"
      ? tr("That code isn't right, or it has expired. Check the email, or ask for a new code.")
      : c === "already_completed"
        ? tr("You've already completed this assessment.")
        : c === "link_full" || c === "link_closed"
          ? tr("This link isn't taking new applicants any more.")
          : c === "not_taking_applications"
            ? tr("This assessment can't be started right now. Please contact the employer.")
            : c === "too_many_attempts"
              ? tr("Too many tries. Wait a few minutes and try again.")
              : c === "invite_expired"
                ? tr("Your earlier invitation for this job has expired. Ask the recruiter for a new link.")
                : tr("Something went wrong. Try again.");
  };

  async function askCode() {
    setBusy(true);
    setError(null);
    try {
      await sendApplyCode(slug, { email: email.trim(), firstName: first.trim(), lastName: last.trim() });
      setCodeSent(true);
    } catch (err) {
      setError(reason(err));
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      await verifyApplyCode(slug, { email: email.trim(), code: code.trim() });
      await refresh();
      refreshBranding();
      navigate("/candidate", { replace: true });
    } catch (err) {
      setError(reason(err));
      setBusy(false);
    }
  }

  if (notFound) {
    return (
      <CandidateShell>
        <CandidatePanel icon={<TimerOff size={26} />} title={tr("Link not valid")} subtitle={tr("This link isn't valid. Check that you opened the whole link.")} />
      </CandidateShell>
    );
  }
  if (!info) return <CandidateLoading />;
  if (info.state !== "open") {
    return (
      <CandidateShell org={info.organization.name}>
        <CandidatePanel
          icon={<TimerOff size={26} />}
          title={tr("Applications are closed")}
          subtitle={tr("{{org}} isn't taking new applicants through this link for {{job}} any more.", { org: info.organization.name, job: info.job.title })}
        />
      </CandidateShell>
    );
  }
  const field = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  return (
    <CandidateShell org={info.organization.name}>
      <CandidatePanel
        wide
        icon={<Briefcase size={26} />}
        title={tr("English assessment for {{job}}", { job: info.job.title })}
        subtitle={tr("{{org}} asks applicants for {{job}} to take this English assessment.", { org: info.organization.name, job: info.job.title })}
      >
        <CandidateChecklist testKind={info.testKind} proctoring={info.proctoring} admissions={info.admissions} orgName={info.organization.name} />
        {!codeSent ? (
          <div className="flex flex-col gap-3 w-full max-w-md self-center">
            <div className="grid grid-cols-2 gap-3">
              <input value={first} onChange={(e) => setFirst(e.target.value)} placeholder={tr("First name")} aria-label={tr("First name")} className={field} />
              <input value={last} onChange={(e) => setLast(e.target.value)} placeholder={tr("Last name")} aria-label={tr("Last name")} className={field} />
            </div>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={tr("Email")} aria-label={tr("Email")} className={field} />
            {error && <p className="text-sm text-error text-center">{error}</p>}
            <Button onClick={askCode} disabled={busy || !validEmail || !first.trim()}>
              {busy ? tr("Sending...") : tr("Email me a code")}
            </Button>
            <p className="text-xs text-muted text-center">{tr("We send a 6-digit code to confirm your email. Your result goes to {{org}}.", { org: info.organization.name })}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 w-full max-w-md self-center">
            <p className="text-sm text-ink text-center">{tr("We sent a 6-digit code to {{email}}. Enter it to start.", { email: email.trim() })}</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              aria-label={tr("Code")}
              className={`${field} text-center tracking-[0.4em] font-mono text-lg`}
            />
            {error && <p className="text-sm text-error text-center">{error}</p>}
            <Button onClick={start} disabled={busy || code.length !== 6}>
              {busy ? tr("Starting...") : tr("Start the assessment")}
            </Button>
            <button type="button" onClick={() => { setCodeSent(false); setCode(""); setError(null); }} className="text-xs text-muted hover:text-ink underline cursor-pointer">
              {tr("Change the email or send a new code")}
            </button>
          </div>
        )}
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
  if (!a) return <CandidateLoading />;
  if (a.status === "completed") return <CandidateFinished />;
  if (a.status === "expired") {
    return (
      <CandidateShell org={a.organization}>
        <CandidatePanel icon={<TimerOff size={26} />} title={tr("This invitation has expired")} subtitle={a.admissions ? tr("Ask the admissions office for a new link.") : tr("Ask the recruiter for a new link.")} />
      </CandidateShell>
    );
  }
  if (started && a.testKind === "placement") return <PlacementTest />;
  if (started && searchParams.get("session")) return <CandidateTestPage />;
  // Not started yet: the guide (the first time), then the device check with
  // the agreement, as for practice and mock tests; the organization's other
  // checks (ID, room scan, voice sample, screen) follow inside the test.
  return (
    <div className="app-surface min-h-screen px-4 sm:px-6 py-10">
      <QuickPreTest
        kind={a.testKind as PreTestKind}
        mode="mock"
        minutes={TEST_MINUTES[a.testKind]}
        onBack={() => window.history.back()}
        onReady={() => !busy && begin()}
        // Listening questions are recorded in two voices: the candidate picks one.
        extra={a.testKind !== "writing" ? <VoiceSection /> : undefined}
      />
    </div>
  );
}

// The test itself, with the same top bar as a learner's timed test: the
// test's name and Finish test (the page has no app header around it).
function CandidateTestPage() {
  const [focus, setFocus] = useState<TestFocus | null>(null);
  return (
    <div className="app-surface min-h-screen flex flex-col">
      {focus && <TestFocusBar focus={focus} />}
      <div className="flex-1 px-4 sm:px-6 py-6">
        <TestFocusProvider value={setFocus}>
          <PracticeTests />
        </TestFocusProvider>
      </div>
    </div>
  );
}
