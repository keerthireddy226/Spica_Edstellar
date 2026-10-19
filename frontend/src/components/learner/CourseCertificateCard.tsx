import { useEffect, useState } from "react";
import { Award, CheckCircle2, Clock, FileUp, Trophy, X } from "lucide-react";
import { Button } from "@/components/Button";
import { Confetti } from "@/components/Confetti";
import { ApiError } from "@/lib/api";
import {
  formatDay,
  getCertificateStatus,
  requestCertificate,
  saveVersantResult,
  versantProofUrl,
  type CertificateStatus,
  type Level,
  type SkillName,
  type SkillResult,
} from "@/api/certificates";
import { tr } from "@/i18n/tr";

const LEVELS: Level[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const SKILLS: SkillName[] = ["listening", "speaking", "reading", "writing"];
const SKILL_LABEL: Record<SkillName, () => string> = {
  listening: () => tr("Listening"),
  speaking: () => tr("Speaking"),
  reading: () => tr("Reading"),
  writing: () => tr("Writing"),
};
const MAX_PROOF_MB = 3;

// My journey: the learner's real Versant result (goal → achieved) and their
// course certificate: what's left before they can ask for one, the request
// (to their org admin, or the Spica team for individuals) and the certificate.
export function CourseCertificateCard() {
  const [s, setS] = useState<CertificateStatus | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const load = () =>
    getCertificateStatus()
      .then(setS)
      .catch(() => setS(null));
  useEffect(() => {
    load();
  }, []);
  if (!s) return null;

  const who = s.reviewer === "org" ? tr("your organization's admin") : tr("the Spica team");
  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await requestCertificate();
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.message === "already_pending" ? tr("Your request is already with {{who}}.", { who }) : tr("Couldn't send your request. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const v = s.versant;
  return (
    <section className="relative bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      {celebrate && <Confetti />}
      <h2 className="font-display font-bold text-base text-ink flex items-center gap-2">
        <Award size={17} className="text-accent" /> {tr("Your result and certificate")}
      </h2>

      {/* The real Versant result. */}
      {v ? (
        <div className={`rounded-card border p-4 flex flex-col gap-2 ${s.versantGoalReached ? "border-success/40 bg-success/5" : "border-rule bg-paper-warm/60"}`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {s.versantGoalReached && <Trophy size={18} className="text-success" />}
            <span className="text-sm text-ink">
              {s.goal ? (
                <>
                  {tr("Goal")} <b>{s.goal}</b> → {tr("Achieved")} <b>{v.overallLevel}</b>
                </>
              ) : (
                <>
                  {tr("Achieved")} <b>{v.overallLevel}</b>
                </>
              )}
              <span className="text-muted">
                {" · "}
                {tr("Versant test, {{date}}", { date: formatDay(v.takenOn) })}
                {v.overallScore ? ` · ${tr("score {{n}}", { n: v.overallScore })}` : ""}
              </span>
            </span>
          </div>
          {Object.keys(v.skills).length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {SKILLS.filter((k) => v.skills[k]?.level || v.skills[k]?.score).map((k) => (
                <span key={k} className="px-2.5 py-1 rounded-pill bg-surface border border-rule text-ink">
                  {SKILL_LABEL[k]()}: <b>{v.skills[k]?.level ?? "—"}</b>
                  {v.skills[k]?.score ? ` (${v.skills[k]?.score})` : ""}
                </span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {v.hasProof && (
              <a href={versantProofUrl(v.id)} target="_blank" rel="noreferrer" className="font-semibold text-navy hover:underline">
                {tr("Your score report")}
              </a>
            )}
            <span className="text-muted">{v.verifiedAt ? tr("Checked by {{who}}", { who }) : tr("Checked by {{who}} when your certificate is issued", { who })}</span>
            <button onClick={() => setAdding(true)} className="font-semibold text-navy hover:underline cursor-pointer">
              {tr("Add a newer result")}
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-rule p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <p className="flex-1 text-sm text-ink">
            {tr("Took the real Versant test? Add your result to see how it compares with your goal")}
            {s.goal ? ` (${s.goal})` : ""}.
          </p>
          <Button variant="secondary" onClick={() => setAdding(true)} className="shrink-0">
            {tr("Add my Versant result")}
          </Button>
        </div>
      )}

      {/* The certificate. */}
      <CertificateState s={s} who={who} busy={busy} onApply={apply} />
      {error && <p className="text-sm text-error">{error}</p>}

      {adding && (
        <VersantResultForm
          onClose={() => setAdding(false)}
          onSaved={async (reached) => {
            setAdding(false);
            await load();
            if (reached) setCelebrate(true);
          }}
          goal={s.goal}
        />
      )}
    </section>
  );
}

function CertificateState({ s, who, busy, onApply }: { s: CertificateStatus; who: string; busy: boolean; onApply: () => void }) {
  if (s.certificate && s.request?.status !== "pending") {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-card bg-navy/5 border border-navy/15 p-4">
        <CheckCircle2 size={20} className="text-success shrink-0" />
        <p className="flex-1 text-sm text-ink">
          {tr("Your certificate of completion was issued on {{date}}.", { date: formatDay(s.certificate.issuedAt) })}
          <span className="block text-xs text-muted font-mono">{s.certificate.code}</span>
        </p>
        <a href={`/certificate/${s.certificate.code}`} target="_blank" rel="noreferrer" className="shrink-0">
          <Button>{tr("View and download")}</Button>
        </a>
      </div>
    );
  }
  if (s.request?.status === "pending") {
    return (
      <p className="flex items-center gap-2 text-sm text-ink rounded-card bg-warning/10 border border-warning/25 p-4">
        <Clock size={18} className="text-warning shrink-0" />
        {tr("You asked for your certificate on {{date}}. It's with {{who}}; we'll let you know when it's issued.", { date: formatDay(s.request.createdAt), who })}
      </p>
    );
  }
  const declined = s.request?.status === "declined" ? s.request : null;
  if (s.eligible) {
    return (
      <div className="flex flex-col gap-2">
        {declined && <p className="text-sm text-error">{tr("Your last request was declined: {{note}}", { note: declined.note ?? "" })}</p>}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-card bg-success/5 border border-success/30 p-4">
          <p className="flex-1 text-sm text-ink">
            {tr("You've completed the course. Ask for your certificate of completion: {{who}} checks it and issues it.", { who })}
            <span className="block text-xs text-muted">
              {tr("{{from}} to {{to}} · level {{level}}", { from: formatDay(s.period.from), to: formatDay(s.period.to), level: s.level ?? "—" })}
              {s.goal ? ` · ${tr("goal {{goal}}", { goal: s.goal })}` : ""}
            </span>
          </p>
          <Button onClick={onApply} disabled={busy} className="shrink-0">
            {busy ? tr("Sending…") : tr("Ask for my certificate")}
          </Button>
        </div>
      </div>
    );
  }
  // Not yet: what's left.
  const practiceLeft = Math.max(0, s.practice.total - s.practice.done);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-rule p-4">
      <p className="text-sm text-ink font-semibold">{tr("Certificate of completion")}</p>
      <p className="text-sm text-muted">
        {tr("You can ask for it when you've finished every practice test and taken a mock exam, or when your access ends.")}
      </p>
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-muted">
          <span>{tr("Practice tests: {{done}} of {{total}}", { done: s.practice.done, total: s.practice.total })}</span>
          <span>{tr("Mock exams: {{n}}", { n: s.mocks })}</span>
        </div>
        <div className="h-2 rounded-pill bg-rule overflow-hidden">
          <div className="h-full rounded-pill bg-navy" style={{ width: `${Math.round((s.practice.done / Math.max(1, s.practice.total)) * 100)}%` }} />
        </div>
        <p className="text-xs text-muted">
          {[
            practiceLeft ? tr("{{n}} practice tests left", { n: practiceLeft }) : null,
            s.mocks === 0 ? tr("a mock exam") : null,
            s.access.endsAt ? tr("or after your access ends on {{date}}", { date: formatDay(s.access.endsAt) }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </div>
  );
}

function VersantResultForm({ goal, onClose, onSaved }: { goal: Level | null; onClose: () => void; onSaved: (goalReached: boolean) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [takenOn, setTakenOn] = useState(today);
  const [overall, setOverall] = useState<Level | "">("");
  const [score, setScore] = useState("");
  const [skills, setSkills] = useState<Partial<Record<SkillName, { level: Level | ""; score: string }>>>({});
  const [proof, setProof] = useState<{ name: string; data: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pickFile(file: File | undefined) {
    setError(null);
    if (!file) return setProof(null);
    if (file.size > MAX_PROOF_MB * 1024 * 1024) return setError(tr("The file is too big. Use one under {{n}} MB.", { n: MAX_PROOF_MB }));
    const reader = new FileReader();
    reader.onload = () => setProof({ name: file.name, data: String(reader.result) });
    reader.readAsDataURL(file);
  }

  const num = (x: string) => (x.trim() ? Number(x) : undefined);
  const scoreOk = (x: string) => !x.trim() || (/^\d+$/.test(x.trim()) && Number(x) >= 10 && Number(x) <= 90);

  async function save() {
    if (!overall) return setError(tr("Choose your overall level."));
    if (![score, ...Object.values(skills).map((x) => x?.score ?? "")].every(scoreOk)) return setError(tr("Versant scores are between 10 and 90."));
    setSaving(true);
    setError(null);
    const skillBody: Partial<Record<SkillName, SkillResult>> = {};
    for (const k of SKILLS) {
      const x = skills[k];
      if (!x || (!x.level && !x.score.trim())) continue;
      skillBody[k] = { ...(x.level ? { level: x.level } : {}), ...(num(x.score) ? { score: num(x.score) } : {}) };
    }
    try {
      await saveVersantResult({ takenOn, overallLevel: overall, overallScore: num(score) ?? null, skills: skillBody, proofBase64: proof?.data ?? null });
      onSaved(!!goal && LEVELS.indexOf(overall) >= LEVELS.indexOf(goal));
    } catch (err) {
      const code = err instanceof ApiError ? err.message : "";
      setError(
        code === "bad_proof" || code === "proof_too_large"
          ? tr("The score report must be an image or a PDF under {{n}} MB.", { n: MAX_PROOF_MB })
          : code === "future_date"
            ? tr("The test date can't be in the future.")
            : tr("Couldn't save your result. Try again."),
      );
      setSaving(false);
    }
  }

  const inputClass = "rounded-input border border-rule bg-surface px-3 py-2 text-sm text-ink";
  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-3 sm:p-6" onClick={onClose}>
      <div className="bg-surface rounded-card shadow-xl w-full max-w-lg max-h-[92vh] overflow-y-auto p-5 flex flex-col gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="font-display font-bold text-lg text-ink">{tr("Your Versant result")}</h3>
            <p className="text-sm text-muted">{tr("From your official Versant score report.")}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-ink cursor-pointer" aria-label={tr("Close")}>
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {tr("Test date")}
            <input type="date" value={takenOn} max={today} onChange={(e) => setTakenOn(e.target.value)} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {tr("Overall level")}
            <select value={overall} onChange={(e) => setOverall(e.target.value as Level)} className={inputClass}>
              <option value="">{tr("Choose")}</option>
              {LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            {tr("Overall score (optional)")}
            <input inputMode="numeric" placeholder="10-90" value={score} onChange={(e) => setScore(e.target.value)} className={inputClass} />
          </label>
        </div>

        <details className="rounded-input border border-rule px-3 py-2">
          <summary className="text-sm font-semibold text-ink cursor-pointer">{tr("Each skill (optional)")}</summary>
          <div className="flex flex-col gap-2 mt-3">
            {SKILLS.map((k) => (
              <div key={k} className="grid grid-cols-[1fr_6rem_6rem] items-center gap-2">
                <span className="text-sm text-ink">{SKILL_LABEL[k]()}</span>
                <select
                  value={skills[k]?.level ?? ""}
                  onChange={(e) => setSkills({ ...skills, [k]: { level: e.target.value as Level, score: skills[k]?.score ?? "" } })}
                  className={inputClass}
                  aria-label={tr("{{skill}} level", { skill: SKILL_LABEL[k]() })}
                >
                  <option value="">—</option>
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
                <input
                  inputMode="numeric"
                  placeholder={tr("Score")}
                  value={skills[k]?.score ?? ""}
                  onChange={(e) => setSkills({ ...skills, [k]: { level: skills[k]?.level ?? "", score: e.target.value } })}
                  className={inputClass}
                  aria-label={tr("{{skill}} score", { skill: SKILL_LABEL[k]() })}
                />
              </div>
            ))}
          </div>
        </details>

        <label className="flex flex-col gap-1.5 rounded-input border border-dashed border-rule p-3 cursor-pointer">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <FileUp size={16} /> {proof ? proof.name : tr("Upload your score report")}
          </span>
          <span className="text-xs text-muted">{tr("A screenshot or the PDF, under {{n}} MB. It's needed for the result to go on your certificate.", { n: MAX_PROOF_MB })}</span>
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => pickFile(e.target.files?.[0])} />
        </label>

        {error && <p className="text-sm text-error">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? tr("Saving…") : tr("Save my result")}
          </Button>
        </div>
      </div>
    </div>
  );
}
