import { JobQueuePanel } from "@/components/JobQueuePanel";
import { AtRiskOrganizations } from "@/components/AtRiskOrganizations";
import { PageHeader } from "@/components/staff/StaffKit";

import { tr } from "@/i18n/tr";
// Super Admin: how the platform itself is running.
export function SystemPage() {
  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title={tr("System")} subtitle={tr("Background jobs (emails, reminders, reports, webhooks) and organizations whose health is slipping.")} />
      <div className="grid lg:grid-cols-2 gap-4 items-start">
        <JobQueuePanel />
        <AtRiskOrganizations />
      </div>
    </div>
  );
}
