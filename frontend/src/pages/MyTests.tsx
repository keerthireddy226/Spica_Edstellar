import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Award, CalendarClock, ClipboardCheck, FileText, Lock, PlayCircle, ShieldCheck } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { Button } from "@/components/Button";
import { PracticeTests } from "@/pages/PracticeTests";
import { getMyTests, type AttemptStatus, type OwnedTest } from "@/api/assessment";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// My tests: the real assessment attempts the learner owns. Each opens by the
// unlock rule (after a mock test or in the last 7 days for preparation; after
// the free sample for assessment only), and shows its result and certificate.

const day = (iso: string) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" });

const STATUS: Record<AttemptStatus, { label: () => string; cls: string }> = {
  in_progress: { label: () => tr("In progress"), cls: "text-navy-deep" },
  scoring: { label: () => tr("Being scored"), cls: "text-warning" },
  under_review: { label: () => tr("Under review"), cls: "text-warning" },
  certified: { label: () => tr("Certified"), cls: "text-success" },
  not_passed: { label: () => tr("Not passed"), cls: "text-error" },
  void: { label: () => tr("Not valid"), cls: "text-error" },
};

const takeLink = (t: OwnedTest, mode: "certified" | "sample", sessionId?: string) =>
  `${ROUTES.MY_TESTS_TAKE}?entitlement=${t.id}&mode=${mode}${sessionId ? `&session=${sessionId}` : ""}`;

function TestCard({ t }: { t: OwnedTest }) {
  const { t: tx } = useTranslation();
  const navigate = useNavigate();
  const u = t.unlock;
  const open = t.attempts.find((a) => a.status === "in_progress");
  return (
    <section className="bg-surface border border-rule rounded-card p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t.kind === "prep" ? tr("Preparation + assessment") : t.kind === "level" ? tr("Level test") : tr("Assessment")}
          </p>
          <h2 className="font-display font-bold text-xl text-ink">{t.testName ?? t.name}</h2>
          <p className="text-sm text-muted flex items-center gap-1.5 mt-0.5">
            <CalendarClock size={14} /> {u.state === "expired" ? tr("Ended {{date}}", { date: day(t.endsAt) }) : tr("Available until {{date}}", { date: day(t.endsAt) })}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-paper-warm text-ink whitespace-nowrap">
          {t.attemptsLeft === 1 ? tr("1 attempt left") : tr("{{n}} attempts left", { n: t.attemptsLeft })}
        </span>
      </div>

      {open ? (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-navy/10 border border-navy/20 rounded-input px-4 py-3">
          <span className="text-sm text-ink">{tr("Your real test is in progress. Its clock keeps running.")}</span>
          <Button onClick={() => navigate(takeLink(t, "certified", open.sessionId))} className="flex items-center gap-2 !py-2">
            <PlayCircle size={16} /> {tr("Resume")}
          </Button>
        </div>
      ) : u.state === "open" ? (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-success/10 border border-success/30 rounded-input px-4 py-3">
          <span className="text-sm text-ink flex items-center gap-2">
            <Award size={16} className="text-success shrink-0" /> {tr("Your real test is open. Take it when you're ready.")}
          </span>
          <Button onClick={() => navigate(takeLink(t, "certified"))} className="flex items-center gap-2 !py-2">
            <PlayCircle size={16} /> {tr("Start my real test")}
          </Button>
        </div>
      ) : u.state === "mock_needed" ? (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-paper-warm rounded-input px-4 py-3">
          <span className="text-sm text-ink flex items-center gap-2">
            <Lock size={16} className="text-muted shrink-0" /> {tr("Opens after your first mock test, or on {{date}}.", { date: day(u.opensOn) })}
          </span>
          <Button variant="secondary" onClick={() => navigate(ROUTES.MOCK_EXAMS)} className="!py-2">
            {tr("Go to mock tests")}
          </Button>
        </div>
      ) : u.state === "sample_needed" ? (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-paper-warm rounded-input px-4 py-3">
          <span className="text-sm text-ink flex items-center gap-2">
            <ShieldCheck size={16} className="text-navy-deep shrink-0" /> {tr("Take the free sample first: a short version of the test with the same checks.")}
          </span>
          <Button onClick={() => navigate(takeLink(t, "sample"))} className="!py-2">
            {tr("Start the free sample")}
          </Button>
        </div>
      ) : u.state === "retake_wait" ? (
        <div className="flex items-center gap-2 bg-paper-warm rounded-input px-4 py-3 text-sm text-ink">
          <Lock size={16} className="text-muted shrink-0" /> {tr("You can take a new level test from {{date}}, 7 days after the last one.", { date: day(u.opensOn) })}
        </div>
      ) : u.state === "expired" && !t.attempts.length ? (
        <p className="text-sm text-muted">{tr("This purchase ended before the test was taken.")}</p>
      ) : null}

      {t.kind === "assessment" && t.samplesDone > 0 && (u.state === "open" || u.state === "used") && (
        <Link to={takeLink(t, "sample")} className="self-start text-sm font-semibold text-navy-deep hover:underline">
          {tr("Take the free sample again")}
        </Link>
      )}

      {t.attempts.length > 0 && (
        <div className="flex flex-col border border-rule rounded-xl overflow-hidden">
          {t.attempts.map((a) => (
            <div key={a.sessionId} className="flex items-center gap-3 flex-wrap px-4 py-3 border-t border-rule first:border-t-0 text-sm">
              <span className="text-muted w-28 shrink-0">{day(a.startedAt)}</span>
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-pill border border-current ${STATUS[a.status].cls}`}>{STATUS[a.status].label()}</span>
              {a.status === "certified" && a.spicaScore !== null && (
                <span className="font-display font-semibold text-ink">{tr("Spica score {{score}} · {{level}}", { score: a.spicaScore, level: a.level ?? "—" })}</span>
              )}
              {a.levelResult && a.status !== "in_progress" && (
                <span className="text-xs text-ink">
                  {tr("{{n}}% overall", { n: a.levelResult.overallPercent ?? 0 })}
                  {Object.entries(a.levelResult.skillPercents)
                    .filter(([, v]) => typeof v === "number")
                    .map(([k, v]) => ` · ${tx(`skills.${k}`)} ${v}%`)
                    .join("")}
                </span>
              )}
              <span className="flex-1" />
              {a.status === "certified" && (
                <>
                  <Link to={`/practice-tests/report/${a.sessionId}`} className="flex items-center gap-1.5 font-semibold text-navy-deep hover:underline">
                    <FileText size={15} /> {tr("Score report")}
                  </Link>
                  {a.certificateCode && (
                    <Link to={`/certificate/${a.certificateCode}`} className="flex items-center gap-1.5 font-semibold text-navy-deep hover:underline">
                      <Award size={15} /> {tr("Certificate")}
                    </Link>
                  )}
                </>
              )}
              {a.status === "scoring" && <span className="text-xs text-muted">{tr("Your certificate arrives once scoring and the proctoring checks are done.")}</span>}
              {a.status === "under_review" && <span className="text-xs text-muted">{tr("A reviewer is checking the proctoring record. We'll email you when it's done.")}</span>}
              {a.status === "void" && <span className="text-xs text-muted">{tr("The proctoring review found a problem, so this attempt doesn't count.")}</span>}
              {a.status === "not_passed" && (
                <span className="text-xs text-muted">{tr("A pass needs 70% overall and at least 50% in each skill.")}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function MyTests() {
  const [tests, setTests] = useState<OwnedTest[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    getMyTests()
      .then((r) => setTests(r.tests))
      .catch(() => setError(true));
  }, []);
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("Your results")}
        title={tr("My tests")}
        subtitle={tr("Your real tests: take each one when it opens, then find your score report and certificate here.")}
        icon={ClipboardCheck}
      />
      {error ? (
        <p className="text-sm text-error">{tr("Could not load your tests.")}</p>
      ) : tests === null ? (
        <p className="text-sm text-muted">{tr("Loading…")}</p>
      ) : tests.length === 0 ? (
        <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-3 items-start">
          <h2 className="font-display font-bold text-lg text-ink">{tr("You don't have a real test yet")}</h2>
          <p className="text-sm text-muted">{tr("A real test gives you a Spica score, a score report and a certificate valid for a year.")}</p>
          <Link to={ROUTES.PLANS} className="text-sm font-semibold text-navy-deep hover:underline">
            {tr("See plans")}
          </Link>
        </div>
      ) : (
        tests.map((t) => <TestCard key={t.id} t={t} />)
      )}
    </div>
  );
}

// Taking a real test or its sample: the test runner, set up for the purchase.
export function TakeOwnedTest() {
  const [params] = useSearchParams();
  const entitlementId = params.get("entitlement") ?? "";
  const mode = params.get("mode") === "sample" ? "sample" : "certified";
  const [test, setTest] = useState<OwnedTest | null | undefined>(undefined);
  useEffect(() => {
    getMyTests()
      .then((r) => setTest(r.tests.find((t) => t.id === entitlementId) ?? null))
      .catch(() => setTest(null));
  }, [entitlementId]);
  if (test === undefined) return null;
  if (!test) return <p className="text-sm text-error">{tr("This test isn't available.")}</p>;
  // A real test that isn't open (and not being resumed) goes back to My tests, which says why.
  const resuming = !!params.get("session") || test.attempts.some((a) => a.status === "in_progress");
  if (mode === "certified" && test.unlock.state !== "open" && !resuming) return <Navigate to={ROUTES.MY_TESTS} replace />;
  return <PracticeTests owned={{ entitlementId: test.id, mode, testTypeId: test.testTypeId, testName: test.testName, level: test.kind === "level" ? test.level : null }} />;
}
