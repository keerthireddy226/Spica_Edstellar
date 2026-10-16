
import { tr } from "@/i18n/tr";// How each audit action reads in a sentence: "<who> <verb> <target>".
export const AUDIT_VERBS: Record<string, string> = {
  "batch.created": tr("created batch"),
  "batch.updated": tr("edited batch"),
  "program.created": tr("created program"),
  "program.updated": tr("edited program"),
  "batch.deleted": tr("deleted batch"),
  "batch.completed": tr("marked batch complete"),
  "batch.archived": tr("archived batch"),
  "batch.reopened": tr("reopened batch"),
  "batch.cloned": tr("cloned batch"),
  "manager.invited": tr("invited Manager"),
  "manager.updated": tr("edited Manager"),
  "manager.deleted": tr("deleted Manager"),
  "manager.deactivated": tr("deactivated Manager"),
  "manager.reactivated": tr("reactivated Manager"),
  "manager.invite_resent": tr("resent the invite to Manager"),
  "learner.invited": tr("invited learner"),
  "learner.bulk_invited": tr("invited learners in bulk"),
  "learner.deleted": tr("deleted learner"),
  "learner.deactivated": tr("deactivated learner"),
  "learner.reactivated": tr("reactivated learner"),
  "learner.moved": tr("moved learner"),
  "learner.details_updated": tr("updated the employee details of learner"),
  "learner.invite_resent": tr("resent the invite to learner"),
  "learner.erased": tr("erased the data of learner"),
  "organization.updated": tr("edited the organization profile"),
  "organization.settings_updated": tr("changed organization settings"),
  "org_admin.handover": tr("handed the Org Admin role to"),
  "org_admin.replaced": tr("replaced the Org Admin with"),
  "org_admin.invite_resent": tr("resent the Org Admin's invite to"),
  "license.assign": tr("assigned licenses to"),
  "license.extend": tr("extended licenses for"),
  "license.reclaim": tr("returned unused licenses from"),
  "license.purchase": tr("bought licenses"),
  "license.credit": tr("added licenses (credit)"),
  "license.comp": tr("added complimentary licenses"),
  "license.budget": tr("set fixed licenses for"),
  "license.manager_allotment": tr("set the license pool of"),
  "license.request": tr("decided a license request"),
  "plan.tier_change": tr("changed the plan"),
  "plan.price_change": tr("changed the negotiated price"),
  "plan.pilot_started": tr("started a pilot"),
  "plan.pilot_ended": tr("ended the pilot"),
  "plan.enterprise_inquiry": tr("asked about Enterprise"),
  "api_key.created": tr("created API key"),
  "api_key.revoked": tr("revoked API key"),
  "webhook.created": tr("added webhook"),
  "webhook.deleted": tr("removed webhook"),
  "sso.updated": "changed single sign-on settings",
  "data.exported": tr("exported organization data"),
  "org_admin.viewed_as": tr("viewed the console of"),
  "organization.onboarded": tr("onboarded the organization"),
  "organization.deactivated": tr("deactivated the organization"),
  "organization.reactivated": tr("reactivated the organization"),
  "organization.owner_changed": tr("changed the owning Admin of"),
  "organization.contract_updated": tr("updated the contract of"),
  "staff.admin_invited": tr("invited Admin"),
  "staff.admin_updated": tr("edited Admin"),
  "staff.admin_deactivated": tr("deactivated Admin"),
  "staff.admin_reactivated": tr("reactivated Admin"),
  "certificate.issued": tr("issued a certificate to"),
  "certificate.revoked": tr("revoked a certificate of"),
  "manager.handover": tr("handed over the batches of"),
  "test.started": tr("started the test"),
  "test.completed": tr("finished the test"),
  "recruitment.job_created": tr("created job opening"),
  "recruitment.candidates_invited": tr("invited candidates to"),
  "recruitment.decision": tr("recorded a decision for"),
  "recruitment.recruiter_added": tr("added recruiter"),
  "recruitment.recruiter_removed": tr("removed recruiter"),
  "recruitment.credits_requested": tr("asked for assessment credits"),
  "recruitment.retention_changed": tr("changed how long candidate data is kept"),
  "proctoring.policy_updated": tr("changed the proctoring settings"),
  "integrity.reviewed": tr("recorded an integrity decision for"),
  "integrity.session_terminated": tr("ended the test of"),
  "identity.reviewed": tr("reviewed the ID of"),
  "plan.products_changed": tr("changed the products"),
  "plan.credits_granted": tr("changed assessment credits"),
  "plan.quota_changed": tr("changed monthly test limits"),
  "content.generation_started": tr("asked AI to write questions"),
  "content.item_approve": tr("approved a question for practice"),
  "content.item_approve_mock": tr("approved a question for practice and mocks"),
  "content.item_remove_mock": tr("removed a question from mocks"),
  "content.item_reject": tr("rejected a question"),
  "content.set_assembled": tr("made a new test set"),
  "content.form_created": tr("built a test"),
  "content.form_published": tr("published a built test"),
  "content.form_retired": tr("retired a built test"),
};

// Detail values that read better as words.
export const AUDIT_DETAIL_WORDS: Record<string, string> = {
  shortlisted: tr("shortlisted"),
  rejected: tr("rejected"),
  hired: tr("hired"),
  cleared: tr("cleared"),
  violation: tr("violation"),
  verified: tr("verified"),
  employees: tr("employees"),
  candidates: tr("candidates"),
};

// Extra facts for a test, a decision or a count, e.g.
// "(Test ID SL-002 · Attempt ID SL-7K3M-9QX2 · B2 · 74% · 29 min)".
export function auditDetailParts(d: Record<string, unknown>): string[] {
  const parts: string[] = [];
  const word = (v: unknown) => AUDIT_DETAIL_WORDS[String(v)] ?? String(v);
  if (typeof d.testId === "string") parts.push(tr("Test ID {{c}}", { c: d.testId }));
  if (typeof d.attemptId === "string") parts.push(tr("Attempt ID {{c}}", { c: d.attemptId }));
  if (typeof d.level === "string") parts.push(d.level);
  if (typeof d.score === "number") parts.push(`${d.score}%`);
  if (typeof d.minutes === "number") parts.push(tr("{{m}} min", { m: d.minutes }));
  if (typeof d.skipped === "number" && d.skipped > 0) parts.push(tr("{{n}} skipped", { n: d.skipped }));
  if (typeof d.decision === "string") parts.push(word(d.decision));
  if ("decision" in d && d.decision === null) parts.push(tr("decision cleared"));
  if (typeof d.verdict === "string") parts.push(word(d.verdict));
  if (typeof d.audience === "string") parts.push(word(d.audience));
  if (typeof d.count === "number") parts.push(tr("{{n}} people", { n: d.count }));
  if (typeof d.amount === "number") parts.push(`${d.amount > 0 ? "+" : ""}${d.amount}`);
  if (typeof d.reason === "string" && d.reason && !["grant", "purchase", "adjustment"].includes(d.reason)) parts.push(d.reason);
  return parts;
}
