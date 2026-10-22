import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Award, BookOpen, CalendarClock, ClipboardCheck, FileText, Lock, PlayCircle, ShieldCheck, Target } from "lucide-react";
import { LearnerHero } from "@/components/learner/LearnerHero";
import { Button } from "@/components/Button";
import { PracticeTests } from "@/pages/PracticeTests";
import { chooseFinalTest, getMyTests, type AttemptStatus, type OwnedTest } from "@/api/assessment";
import { formatAmount, getPriceList, type PricedProduct, type ShopCurrency } from "@/api/payments";
import { Checkout } from "@/components/plans/ProductShop";
import { linkedInAddUrl } from "@/lib/linkedin";
import { fileAppeal } from "@/api/quality";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";
import { PageError, SectionLoading } from "@/components/learner/PageStates";

// Assessment (once "My tests"): the real assessment attempts the learner owns. Each opens by the
// unlock rule (after a mock test or in the last 7 days for preparation; after
// the free sample for assessment only), and shows its result and certificate.

const day = (iso: string) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" });

const STATUS: Record<AttemptStatus, { label: () => string; cls: string }> = {
  in_progress: { label: () => tr("In progress"), cls: "text-navy-deep" },
  scoring: { label: () => tr("Being scored"), cls: "text-warning" },
  under_review: { label: () => tr("Under review"), cls: "text-warning" },
  certified: { label: () => tr("Certified"), cls: "text-success" },
  passed: { label: () => tr("Passed"), cls: "text-success" },
  not_passed: { label: () => tr("Not passed"), cls: "text-error" },
  void: { label: () => tr("Not valid"), cls: "text-error" },
};

// Appeal a real test's result (once, within two weeks), and where the appeal is.
function AppealLine({ sessionId, appeal, canAppeal }: { sessionId: string; appeal: OwnedTest["attempts"][number]["appeal"]; canAppeal: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (appeal) {
    const label = { open: tr("Appeal sent: we'll reply by email."), upheld: tr("Appeal answered: the result stands."), changed: tr("Appeal answered: your result was re-marked."), new_attempt: tr("Appeal answered: you can take the test again.") }[appeal.status];
    return (
      <span className="basis-full text-xs text-muted">
        {label}
        {appeal.note ? ` ${appeal.note}` : ""}
      </span>
    );
  }
  if (!canAppeal || state === "sent") return state === "sent" ? <span className="basis-full text-xs text-success">{tr("Appeal sent: we'll reply by email.")}</span> : null;
  return open ? (
    <div className="basis-full flex flex-col gap-2">
      <textarea
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={tr("What went wrong? For example a question that didn't load, or audio you couldn't hear.")}
        className="rounded-input border border-rule bg-surface px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-2">
        <Button
          disabled={reason.trim().length < 10 || state === "sending"}
          onClick={async () => {
            setState("sending");
            try {
              await fileAppeal(sessionId, reason.trim());
              setState("sent");
            } catch {
              setState("error");
            }
          }}
          className="!py-1.5 !text-sm"
        >
          {tr("Send appeal")}
        </Button>
        <button onClick={() => setOpen(false)} className="text-sm text-muted hover:underline cursor-pointer">
          {tr("Cancel")}
        </button>
        {state === "error" && <span className="text-xs text-error">{tr("The appeal couldn't be sent.")}</span>}
      </div>
    </div>
  ) : (
    <button onClick={() => setOpen(true)} className="basis-full text-left text-xs font-semibold text-navy-deep hover:underline cursor-pointer">
      {tr("Appeal this result")}
    </button>
  );
}

const takeLink = (t: OwnedTest, mode: "certified" | "sample", sessionId?: string) =>
  `${ROUTES.MY_TESTS_TAKE}?entitlement=${t.id}&mode=${mode}${sessionId ? `&session=${sessionId}` : ""}`;

type Shop = { products: PricedProduct[]; currency: ShopCurrency } | null;

// What a learner can do with a final assessment certificate: add it to
// LinkedIn and, buying for themselves, keep it valid longer or order a printed copy.
function CertificateExtras({ a, testName, shop }: { a: OwnedTest["attempts"][number]; testName: string; shop: Shop }) {
  const [buying, setBuying] = useState<PricedProduct | null>(null);
  if (!a.certificateCode || !a.certificateId) return null;
  const extra = (kind: PricedProduct["kind"]) => shop?.products.find((p) => p.kind === kind) ?? null;
  const offers = [!a.lifetime ? extra("cert_extend") : null, !a.lifetime ? extra("cert_lifetime") : null, extra("cert_print")].filter((p): p is PricedProduct => !!p);
  const label = (p: PricedProduct) =>
    p.kind === "cert_extend" ? tr("Keep it valid 12 more months") : p.kind === "cert_lifetime" ? tr("Make it valid for life") : tr("Order a printed copy");
  return (
    <div className="basis-full flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs pl-0 sm:pl-[7.75rem]">
      <a
        href={linkedInAddUrl({
          name: `${testName}: ${a.level ?? ""}${a.spicaScore !== null ? `, Spica score ${a.spicaScore}` : ""}`,
          code: a.certificateCode,
          issuedAt: a.issuedAt ?? a.startedAt,
          validUntil: a.validUntil,
          verifyUrl: `${window.location.origin}/certificate/${a.certificateCode}`,
        })}
        target="_blank"
        rel="noopener"
        className="font-semibold text-navy-deep hover:underline"
      >
        {tr("Add to LinkedIn")}
      </a>
      {a.lifetime && <span className="text-muted">{tr("Valid for life")}</span>}
      {offers.map((p) => (
        <button key={p.id} onClick={() => setBuying(p)} className="font-semibold text-navy-deep hover:underline cursor-pointer">
          {label(p)} · {formatAmount(p.amount, p.currency)}
        </button>
      ))}
      {buying && shop && <Checkout product={buying} currency={shop.currency} certificateId={a.certificateId} onClose={() => setBuying(null)} />}
    </div>
  );
}

// The final assessment included with Full access: the learner picks its test first.
function ChooseTest({ t, onChosen }: { t: OwnedTest; onChosen: () => void }) {
  const [testTypeId, setTestTypeId] = useState(t.choices[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function choose() {
    setBusy(true);
    setError(false);
    try {
      await chooseFinalTest(t.id, testTypeId);
      onChosen();
    } catch {
      setError(true);
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3 bg-paper-warm rounded-input px-4 py-3">
      <p className="text-sm text-ink">
        {tr("Choose the test for your final assessment. It opens after a mock test of that test, or in the last 7 days of your access. You can't change it later.")}
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <select value={testTypeId} onChange={(e) => setTestTypeId(e.target.value)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink cursor-pointer">
          {t.choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button onClick={choose} disabled={!testTypeId || busy} className="!py-2">
          {tr("Choose this test")}
        </Button>
      </div>
      {error && <p className="text-sm text-error">{tr("Couldn't save your choice. Try again.")}</p>}
    </div>
  );
}

function TestCard({ t, onChanged, shop }: { t: OwnedTest; onChanged: () => void; shop: Shop }) {
  const { t: tx } = useTranslation();
  const navigate = useNavigate();
  const u = t.unlock;
  const open = t.attempts.find((a) => a.status === "in_progress");
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {t.kind === "prep"
              ? tr("Preparation + assessment")
              : t.kind === "level"
                ? tr("Level test")
                : t.kind === "final"
                  ? t.testName
                    ? tr("Final assessment · included with Full access")
                    : tr("Included with Full access")
                  : tr("Assessment")}
          </p>
          <h2 className="font-display font-bold text-xl text-ink">
            {t.kind === "level" && t.level ? tr("Level {{level}} test", { level: t.level }) : t.kind === "final" && !t.testName ? tr("Final assessment") : (t.testName ?? t.name)}
          </h2>
          <p className="text-sm text-muted flex items-center gap-1.5 mt-0.5">
            <CalendarClock size={14} /> {u.state === "expired" ? tr("Ended {{date}}", { date: day(t.endsAt) }) : tr("Available until {{date}}", { date: day(t.endsAt) })}
          </p>
        </div>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-pill bg-paper-warm border border-rule text-ink whitespace-nowrap">
          {t.attemptsLeft === 1 ? tr("1 attempt left") : tr("{{n}} attempts left", { n: t.attemptsLeft })}
        </span>
      </div>

      {t.chooseTest && u.state !== "expired" ? (
        <ChooseTest t={t} onChosen={onChanged} />
      ) : open ? (
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
          <Lock size={16} className="text-muted shrink-0" /> {tr("You can take a new level test from {{date}}.", { date: day(u.opensOn) })}
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
              {a.levelResult && a.levelResult.passed !== null && a.status !== "in_progress" && (
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
              {a.status === "scoring" && (
                <span className="text-xs text-muted">
                  {a.levelResult
                    ? tr("Your result shows once every answer is scored.")
                    : tr("Your certificate arrives once scoring and the proctoring checks are done.")}
                </span>
              )}
              {a.status === "under_review" && <span className="text-xs text-muted">{tr("A reviewer is checking the proctoring record. We'll email you when it's done.")}</span>}
              {a.status === "void" && <span className="text-xs text-muted">{tr("The proctoring review found a problem, so this attempt doesn't count.")}</span>}
              {a.status === "passed" && <span className="text-xs text-muted">{tr("You showed this level. Your certificate comes from your final assessment.")}</span>}
              {a.status === "not_passed" && (
                <span className="text-xs text-muted">{tr("A pass needs 70% overall and at least 50% in each skill. A retake of this level is half price.")}</span>
              )}
              {a.status === "passed" && <span className="text-xs text-muted">{tr("The next level's test is 25% off.")}</span>}
              <AppealLine sessionId={a.sessionId} appeal={a.appeal} canAppeal={a.canAppeal && a.status !== "in_progress"} />
              {a.status === "certified" && <CertificateExtras a={a} testName={t.testName ?? t.name} shop={shop} />}
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
  // Whether the learner buys their own tests (individuals) or their organization gives them.
  const [canBuy, setCanBuy] = useState(true);
  const [shop, setShop] = useState<Shop>(null);
  function load() {
    setError(false);
    getMyTests()
      .then((r) => setTests(r.tests))
      .catch(() => setError(true));
  }
  useEffect(() => {
    load();
    getPriceList()
      .then((r) => {
        setCanBuy(r.canBuy);
        if (r.canBuy) setShop({ products: r.products, currency: r.currency });
      })
      .catch(() => {});
  }, []);
  return (
    <div className="w-full flex flex-col gap-6">
      <LearnerHero
        eyebrow={tr("Your results")}
        title={tr("Assessment")}
        subtitle={tr("Your final assessments: real tests that end your preparation. Take each one when it opens, then find your score report and certificate here.")}
        icon={ClipboardCheck}
      />
      {error ? (
        <PageError message={tr("Could not load your tests.")} onRetry={load} />
      ) : tests === null ? (
        <SectionLoading rows={2} />
      ) : tests.length === 0 ? (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-7 flex flex-col gap-5">
          <div className="flex items-start gap-4">
            <span className="h-12 w-12 rounded-2xl bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
              <Award size={24} />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="font-display font-bold text-lg text-ink">{tr("No final assessment yet")}</h2>
              <p className="text-sm text-muted">
                {tr("Your final assessment is a real test: strictly proctored, with a Spica score, a score report and a certificate valid for a year.")}
              </p>
            </div>
          </div>
          <ul className="grid sm:grid-cols-2 gap-3">
            {(
              [
                [BookOpen, tr("With Preparation + real test + certificate, it opens after your first mock test, or in the last 7 days of your preparation.")],
                [Award, tr("Full access includes one: choose its test here, then it opens after a mock test of that test.")],
                [ShieldCheck, tr("With Real test + certificate, it opens after a free sample.")],
                [Target, tr("A level test checks one level (A1 to C2). It gives no certificate.")],
              ] as const
            ).map(([Icon, text]) => (
              <li key={text} className="flex items-start gap-3 rounded-input bg-paper-warm/60 border border-rule px-4 py-3 text-sm text-ink">
                <Icon size={17} className="text-navy-deep shrink-0 mt-0.5" />
                {text}
              </li>
            ))}
          </ul>
          {canBuy ? (
            <Link to={ROUTES.SPICA_PLANS} className="self-start inline-flex items-center gap-1.5 rounded-pill bg-navy text-white px-5 py-2.5 text-sm font-semibold hover:opacity-90">
              {tr("Get a final assessment")} <ArrowRight size={15} />
            </Link>
          ) : (
            <p className="text-sm text-muted">{tr("Your organization gives you your tests. When it does, your final assessment shows here.")}</p>
          )}
        </div>
      ) : (
        tests.map((t) => <TestCard key={t.id} t={t} onChanged={load} shop={shop} />)
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
  // A real test that isn't open (and not being resumed) goes back to Assessment, which says why.
  const resuming = !!params.get("session") || test.attempts.some((a) => a.status === "in_progress");
  // A final assessment's test is chosen on Assessment first.
  if (!test.testTypeId || (mode === "certified" && test.unlock.state !== "open" && !resuming)) return <Navigate to={ROUTES.MY_TESTS} replace />;
  return <PracticeTests owned={{ entitlementId: test.id, mode, testTypeId: test.testTypeId, testName: test.kind === "level" && test.level ? tr("Level {{level}} test", { level: test.level }) : test.testName, level: test.kind === "level" ? test.level : null }} />;
}
