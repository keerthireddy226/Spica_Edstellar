import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, CheckCircle2, Lock, Target } from "lucide-react";
import { getReadiness, type Readiness } from "@/api/assessment";
import { getPriceList } from "@/api/payments";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

const day = (iso: string) => new Date(iso).toLocaleDateString(document.documentElement.lang || undefined, { day: "numeric", month: "short", year: "numeric" });
const linkBtn = "inline-flex items-center gap-2 px-4 py-2 rounded-pill text-sm font-semibold";

// My journey's last step: practice leads to the final assessment, the only
// test that gives a certificate. Mock tests predict the level it will show;
// readiness is advice, the final assessment opens by its own rule.
export function FinalAssessmentCard() {
  const [r, setR] = useState<Readiness | null>(null);
  const [canBuy, setCanBuy] = useState(true);
  useEffect(() => {
    getReadiness()
      .then(setR)
      .catch(() => setR(null));
    getPriceList()
      .then((p) => setCanBuy(p.canBuy))
      .catch(() => {});
  }, []);
  if (!r) return null;

  const share = r.predicted && r.goalScore ? Math.min(100, Math.round((r.predicted.score / r.goalScore) * 100)) : 0;
  const f = r.final;
  return (
    <section className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
          <Award size={20} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{tr("Last step")}</p>
          <h2 className="font-display font-bold text-lg text-ink">{tr("Final assessment: certify your level")}</h2>
          <p className="text-sm text-muted">{tr("Practice and mock tests prepare you. Your final assessment, one strictly proctored real test, gives your certificate.")}</p>
        </div>
      </div>

      {r.certificate && (
        <div className="flex items-center gap-3 flex-wrap rounded-input border border-success/40 bg-success/5 px-4 py-3">
          <CheckCircle2 size={18} className="text-success shrink-0" />
          <span className="text-sm text-ink flex-1">
            {r.certificate.score !== null
              ? tr("Certified {{level}} · Spica score {{score}}", { level: r.certificate.level, score: r.certificate.score })
              : tr("Certified {{level}}", { level: r.certificate.level })}
            {r.certificate.validUntil ? ` · ${tr("valid until {{date}}", { date: day(r.certificate.validUntil) })}` : ""}
          </span>
          <Link to={`/certificate/${r.certificate.code}`} className="text-sm font-semibold text-navy-deep hover:underline">
            {tr("Certificate")}
          </Link>
        </div>
      )}

      {/* What the mock tests predict, against the goal. */}
      <div className="flex flex-col gap-2">
        {r.predicted ? (
          <>
            <div className="flex items-baseline justify-between gap-3 flex-wrap text-sm">
              <span className="text-ink">
                {tr("Predicted from your last mock tests:")} <b>{tr("Spica score {{score}} · {{level}}", { score: r.predicted.score, level: r.predicted.level })}</b>
              </span>
              {r.goal && r.goalScore !== null && (
                <span className="text-muted flex items-center gap-1">
                  <Target size={14} /> {tr("Goal {{level}}: {{score}} or more", { level: r.goal, score: r.goalScore })}
                </span>
              )}
            </div>
            {r.goalScore !== null && (
              <div className="h-2 rounded-full bg-paper-warm overflow-hidden" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
                <div className={`h-full rounded-full ${r.ready ? "bg-success" : "bg-navy"}`} style={{ width: `${share}%` }} />
              </div>
            )}
            <p className="text-sm text-ink">
              {r.ready
                ? tr("Your mock tests reach your goal. You're ready for your final assessment.")
                : r.goalScore !== null
                  ? tr("About {{n}} points to go. Keep practising, and take mock tests to check.", { n: r.goalScore - r.predicted.score })
                  : tr("Set a goal level in your profile to see how close you are.")}
            </p>
          </>
        ) : (
          <p className="text-sm text-ink">{tr("Take a mock test to see your predicted level, the level your final assessment is likely to show.")}</p>
        )}
      </div>

      {/* The final assessment itself. */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-paper-warm rounded-input px-4 py-3">
        {f ? (
          <>
            <span className="text-sm text-ink flex items-center gap-2">
              {f.unlock.state === "open" && !f.chooseTest ? <Award size={16} className="text-success shrink-0" /> : <Lock size={16} className="text-muted shrink-0" />}
              {f.chooseTest
                ? tr("Your plan includes a final assessment. Choose its test.")
                : f.unlock.state === "open"
                  ? tr("Your final assessment ({{test}}) is open.", { test: f.testName ?? tr("your test") })
                  : f.unlock.state === "mock_needed"
                    ? tr("Your final assessment opens after a mock test of that test, or on {{date}}.", { date: day(f.unlock.opensOn) })
                    : f.unlock.state === "sample_needed"
                      ? tr("Take the free sample, then your final assessment opens.")
                      : tr("Your final assessment is in My tests.")}
            </span>
            <Link to={ROUTES.MY_TESTS} className={`${linkBtn} bg-navy text-white`}>
              {f.chooseTest ? tr("Choose your test") : f.unlock.state === "open" ? tr("Take my final assessment") : tr("Go to My tests")}
            </Link>
          </>
        ) : canBuy ? (
          <>
            <span className="text-sm text-ink">{tr("Every paid plan includes one final assessment with a certificate.")}</span>
            <Link to={ROUTES.SPICA_PLANS} className={`${linkBtn} bg-navy text-white`}>
              {tr("Get a final assessment")}
            </Link>
          </>
        ) : (
          <span className="text-sm text-ink">{tr("Your organization gives you your final assessment. It shows in My tests.")}</span>
        )}
      </div>
    </section>
  );
}
