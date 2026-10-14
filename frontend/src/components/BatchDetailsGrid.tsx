import { DELIVERY_MODE_LABEL, EXAM_FOCUS_LABEL, type DeliveryMode, type ExamFocus } from "@/api/details";

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm text-ink">{value}</p>
    </div>
  );
}

// Everything recorded about a batch, for the Org Admin's and a Manager's
// batch views.
export function BatchDetailsGrid({
  batch,
  learnerCount,
  managedBy,
}: {
  batch: {
    description: string | null;
    department: string | null;
    location: string | null;
    deliveryMode: DeliveryMode | null;
    examFocus: ExamFocus | null;
    startDate: string | null;
    durationMonths: number | null;
    startCefr: string | null;
    targetCefr: string | null;
    targetCutScore: number | string | null;
    weeklyMinutesGoal: number | null;
    capacity: number | null;
    defaultLicenseMonths: number | null;
    autoReminders: boolean;
  };
  learnerCount: number;
  managedBy: string;
}) {
  const b = batch;
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted mb-2">Batch details</p>
      <div className="border border-rule rounded-input px-4 py-3 flex flex-col gap-4">
        {b.description && <p className="text-sm text-ink whitespace-pre-line">{b.description}</p>}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          <Item label="Managed by" value={managedBy} />
          <Item label="Learners" value={b.capacity ? `${learnerCount} of ${b.capacity}${learnerCount >= b.capacity ? " (full)" : ""}` : learnerCount} />
          <Item label="Department" value={b.department ?? "—"} />
          <Item label="Location" value={b.location ?? "—"} />
          <Item label="Delivery" value={b.deliveryMode ? DELIVERY_MODE_LABEL[b.deliveryMode] : "—"} />
          <Item label="Exam or focus" value={b.examFocus ? EXAM_FOCUS_LABEL[b.examFocus] : "—"} />
          <Item label="Level goal" value={b.startCefr || b.targetCefr ? `${b.startCefr ?? "?"} → ${b.targetCefr ?? "?"}` : "—"} />
          <Item label="Target cut score" value={b.targetCutScore != null ? `${b.targetCutScore}%` : "—"} />
          <Item label="Start date" value={b.startDate ? fmt(b.startDate) : "—"} />
          <Item label="Duration" value={b.durationMonths ? `${b.durationMonths} month${b.durationMonths === 1 ? "" : "s"}` : "—"} />
          <Item label="Practice goal" value={b.weeklyMinutesGoal ? `${b.weeklyMinutesGoal} min a week` : "—"} />
          <Item
            label="License months per new learner"
            value={b.defaultLicenseMonths != null ? `${b.defaultLicenseMonths} month${b.defaultLicenseMonths === 1 ? "" : "s"}` : "—"}
          />
          <Item label="Practice reminders" value={b.autoReminders ? "On" : "Off"} />
        </div>
      </div>
    </div>
  );
}
