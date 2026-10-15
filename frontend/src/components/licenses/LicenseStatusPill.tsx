import { formatShortDate, type LearnerAccess } from "@/api/licenses";

import { tr } from "@/i18n/tr";
const EXPIRING_SOON_MS = 7 * 86400000;

export function LicenseStatusPill({ license }: { license: LearnerAccess }) {
  const endsSoon =
    license.status === "active" && license.accessEndsAt && new Date(license.accessEndsAt).getTime() - Date.now() < EXPIRING_SOON_MS;
  const { label, cls } =
    license.status === "active"
      ? endsSoon
        ? { label: `Ends ${formatShortDate(license.accessEndsAt)}`, cls: "bg-warning/15 text-navy-deep" }
        : { label: tr("Active · until {{formatShortDate}}", { formatShortDate: formatShortDate(license.accessEndsAt) }), cls: "bg-success/15 text-success" }
      : license.status === "grace"
        ? { label: tr("Grace · until {{formatShortDate}}", { formatShortDate: formatShortDate(license.graceEndsAt) }), cls: "bg-warning/15 text-navy-deep" }
        : license.status === "expired"
          ? { label: `Expired ${formatShortDate(license.accessEndsAt)}`, cls: "bg-error/15 text-error" }
          : { label: tr("No license"), cls: "bg-muted/15 text-muted" };
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill whitespace-nowrap ${cls}`}>{label}</span>
      {license.queuedMonths > 0 && (
        <span className="text-[11px] text-muted whitespace-nowrap">+{tr("{{queuedMonths}} queued", { queuedMonths: license.queuedMonths })}</span>
      )}
    </span>
  );
}
