import { useState } from "react";
import { ArrowLeft, Award, CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/Button";
import { tr } from "@/i18n/tr";

// Before a real assessment attempt or its free sample: what to expect.
export function OwnedIntro({
  owned,
  minutes,
  error,
  starting,
  onBack,
  onStart,
}: {
  owned: { mode: "certified" | "sample"; testName: string | null; level?: string | null };
  minutes: number | null;
  error: string | null;
  starting: boolean;
  onBack: () => void;
  onStart: () => void;
}) {
  const [ready, setReady] = useState(false);
  const real = owned.mode === "certified";
  const test = owned.testName ?? tr("your test");
  const level = owned.level ?? null;
  const rules = real && level
    ? [
        tr("Questions at {{level}} in all four skills. A pass needs 70% overall and at least 50% in each skill.", { level }),
        tr("Pass it for a {{level}} certificate, valid for a year. If you don't pass, you can take a new level test 7 days later.", { level }),
        tr("You have one attempt. It's used up as soon as the test starts."),
        tr("It's strictly proctored: you show an ID and your room first, and your camera, microphone and screen are watched throughout."),
        tr("The test moves on with the timer: there is no Skip and no Back."),
      ]
    : real
    ? [
        tr("This attempt counts: your score report and certificate come from it."),
        tr("You have one attempt. It's used up as soon as the test starts."),
        tr("It's strictly proctored: you show an ID and your room first, and your camera, microphone and screen are watched throughout."),
        minutes
          ? tr("Use a computer in a quiet room, alone, with nothing else open. Allow about {{n}} minutes.", { n: minutes + 15 })
          : tr("Use a computer in a quiet room, alone, with nothing else open."),
        tr("The test moves on with the timer: there is no Skip and no Back."),
        tr("Afterwards you see your score report. The questions and answers aren't shown, so they stay secret."),
        tr("Your certificate arrives once scoring and the proctoring checks are done, usually within the hour."),
      ]
    : [
        tr("A short version of {{test}}: two questions from each part.", { test }),
        tr("It runs exactly like the real test, with the same checks, so you know what to expect."),
        tr("It's free and doesn't count. When you finish, your real test opens."),
      ];
  return (
    <div className="max-w-2xl mx-auto w-full flex flex-col gap-4">
      <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm font-semibold text-ink hover:text-navy cursor-pointer">
        <ArrowLeft size={16} /> {tr("Assessment")}
      </button>
      <div className="bg-surface border border-rule rounded-card p-6 sm:p-8 flex flex-col gap-5">
        <div className="flex items-start gap-4">
          <span className="h-12 w-12 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center shrink-0">
            {real ? <Award size={24} /> : <ShieldCheck size={24} />}
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{real ? tr("Your real test") : tr("Free sample")}</p>
            <h1 className="font-display font-bold text-2xl text-ink">{test}</h1>
          </div>
        </div>
        <ul className="flex flex-col gap-2.5 text-sm text-ink">
          {rules.map((r) => (
            <li key={r} className="flex items-start gap-2.5">
              <CheckCircle2 size={16} className="text-navy-deep shrink-0 mt-0.5" />
              {r}
            </li>
          ))}
        </ul>
        {real && (
          <label className="flex items-start gap-2.5 text-sm text-ink bg-paper-warm rounded-input px-4 py-3 cursor-pointer">
            <input type="checkbox" checked={ready} onChange={(e) => setReady(e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy" />
            {tr("I'm ready, and I understand this is my one attempt.")}
          </label>
        )}
        {error && <p className="text-sm text-error">{error}</p>}
        <Button onClick={onStart} disabled={(real && !ready) || starting} className="w-full">
          {starting ? tr("Starting…") : real ? tr("Start my real test") : tr("Start the sample")}
        </Button>
      </div>
    </div>
  );
}

// After a real attempt (scored and checked before its result shows) or a sample.
export function OwnedFinished({ mode, onDone }: { mode: "certified" | "sample"; onDone: () => void }) {
  return (
    <div className="max-w-lg w-full mx-auto bg-surface border border-rule rounded-card shadow-sm p-8 flex flex-col gap-4 items-center text-center">
      <div className="h-14 w-14 rounded-full bg-navy text-lime flex items-center justify-center">
        <CheckCircle2 size={32} />
      </div>
      <h1 className="font-display font-bold text-2xl text-ink">{mode === "certified" ? tr("Test finished") : tr("Sample finished")}</h1>
      <p className="text-sm text-muted">
        {mode === "certified"
          ? tr("We're scoring your answers and checking the proctoring record. Your score report and certificate will be on the Assessment page, usually within the hour, and we'll email you.")
          : tr("Your real test is now open on the Assessment page, whenever you're ready.")}
      </p>
      <Button onClick={onDone} className="w-full">
        {tr("Go to Assessment")}
      </Button>
    </div>
  );
}
