import { useState, type FormEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { planErrorMessage } from "@/api/plans";
import type { CefrLevel } from "@/api/orgAdmin";
import { EXAM_FOCUS_LABEL, type BatchDetails, type ExamFocus } from "@/api/details";

const CEFR: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-muted";

function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={`flex flex-col gap-1.5 ${wide ? "sm:col-span-2" : ""}`}>
      <label className={labelClass}>{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold text-ink mb-1">{title}</legend>
      <div className="grid sm:grid-cols-2 gap-3">{children}</div>
    </fieldset>
  );
}

const num = (s: string) => (s.trim() ? Number(s) : null);
const str = (n: number | null | undefined) => (n == null ? "" : String(n));

// Create or edit a batch: what it's for, its schedule and goals, and how it
// runs. Used by both the Org Admin and Managers; `extra` holds role-specific
// fields such as the Org Admin's fixed licenses.
export function BatchFormModal({
  title,
  submitLabel,
  initial,
  extra,
  note,
  onSubmit,
  onClose,
}: {
  title: string;
  submitLabel: string;
  initial?: Partial<BatchDetails>;
  extra?: ReactNode;
  note?: string;
  onSubmit: (d: BatchDetails) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [examFocus, setExamFocus] = useState<ExamFocus | "">(initial?.examFocus ?? "");
  const [startDate, setStartDate] = useState(initial?.startDate ? initial.startDate.slice(0, 10) : "");
  const [durationMonths, setDurationMonths] = useState(str(initial?.durationMonths));
  const [startCefr, setStartCefr] = useState<CefrLevel | "">(initial?.startCefr ?? "");
  const [targetCefr, setTargetCefr] = useState<CefrLevel | "">(initial?.targetCefr ?? "");
  const [targetCutScore, setTargetCutScore] = useState(str(initial?.targetCutScore));
  const [weeklyMinutesGoal, setWeeklyMinutesGoal] = useState(str(initial?.weeklyMinutesGoal));
  const [capacity, setCapacity] = useState(str(initial?.capacity));
  const [defaultLicenseMonths, setDefaultLicenseMonths] = useState(str(initial?.defaultLicenseMonths));
  const [autoReminders, setAutoReminders] = useState(initial?.autoReminders ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (startCefr && targetCefr && CEFR.indexOf(targetCefr) <= CEFR.indexOf(startCefr)) {
      setError("The goal level must be above the starting level.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || null,
        department: department.trim() || null,
        location: location.trim() || null,
        examFocus: examFocus || null,
        startDate: startDate || null,
        durationMonths: num(durationMonths),
        startCefr: startCefr || null,
        targetCefr: targetCefr || null,
        targetCutScore: num(targetCutScore),
        weeklyMinutesGoal: num(weeklyMinutesGoal),
        capacity: num(capacity),
        defaultLicenseMonths: num(defaultLicenseMonths),
        autoReminders,
      });
    } catch (err) {
      setError(
        planErrorMessage(err) ??
          (err instanceof ApiError && err.message === "insufficient_unreserved"
            ? "Not enough unreserved licenses for that many fixed licenses."
            : err instanceof ApiError && err.message === "validation_error"
              ? "Some values are out of range. Check the numbers and try again."
              : "Couldn't save the batch."),
      );
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule shrink-0">
          <h2 className="font-display font-bold text-lg text-ink">{title}</h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 flex flex-col gap-6 overflow-y-auto">
          <Section title="About the batch">
            <Field label="Batch name" wide>
              <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Support team — November intake" className={inputClass} />
            </Field>
            <Field label="Description" wide>
              <textarea
                rows={2}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Who this batch is for and what it should achieve"
                className={inputClass}
              />
            </Field>
            <Field label="Department or team">
              <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Customer Support" className={inputClass} />
            </Field>
            <Field label="Location or site">
              <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Hyderabad office" className={inputClass} />
            </Field>
            <Field label="Exam or focus" wide>
              <select value={examFocus} onChange={(e) => setExamFocus(e.target.value as ExamFocus | "")} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {(Object.keys(EXAM_FOCUS_LABEL) as ExamFocus[]).map((m) => (
                  <option key={m} value={m}>
                    {EXAM_FOCUS_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Schedule and goals">
            <Field label="Start date">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Duration (months)">
              <input type="number" min={1} max={36} value={durationMonths} onChange={(e) => setDurationMonths(e.target.value)} placeholder="e.g. 3" className={inputClass} />
            </Field>
            <Field label="Starting level">
              <select value={startCefr} onChange={(e) => setStartCefr(e.target.value as CefrLevel | "")} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Goal level">
              <select value={targetCefr} onChange={(e) => setTargetCefr(e.target.value as CefrLevel | "")} className={`${inputClass} cursor-pointer`}>
                <option value="">Not set</option>
                {CEFR.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </Field>
            <Field label="Target cut score %">
              <input type="number" min={0} max={100} value={targetCutScore} onChange={(e) => setTargetCutScore(e.target.value)} placeholder="e.g. 60" className={inputClass} />
            </Field>
            <Field label="Practice goal (minutes a week)">
              <input
                type="number"
                min={10}
                max={2000}
                value={weeklyMinutesGoal}
                onChange={(e) => setWeeklyMinutesGoal(e.target.value)}
                placeholder="e.g. 120"
                className={inputClass}
              />
            </Field>
          </Section>

          <Section title="Seats and licenses">
            <Field label="Capacity (most learners)" hint="Leave empty for no limit.">
              <input type="number" min={1} max={10000} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="No limit" className={inputClass} />
            </Field>
            <Field label="License months per new learner" hint="Pre-filled when inviting learners into this batch.">
              <input
                type="number"
                min={0}
                max={24}
                value={defaultLicenseMonths}
                onChange={(e) => setDefaultLicenseMonths(e.target.value)}
                placeholder="e.g. 3"
                className={inputClass}
              />
            </Field>
            {extra}
            <label className="flex items-center gap-2 text-sm text-ink cursor-pointer sm:col-span-2">
              <input type="checkbox" checked={autoReminders} onChange={(e) => setAutoReminders(e.target.checked)} className="h-4 w-4 accent-navy" />
              Send learners automatic practice reminders
            </label>
          </Section>

          {note && <p className="text-xs text-muted">{note}</p>}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving} className="flex-1">
              {saving ? "Saving…" : submitLabel}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
