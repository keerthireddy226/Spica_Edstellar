import { describe, expect, it } from "vitest";
import { agreementText, bringsOrganisations, canAct, daysLeft, partnershipStatus, renewalBlock, renewedEnd } from "./partnership.js";
import { newPartnerCode } from "./staffRoutes.js";

const day = 86400000;
const now = new Date("2026-11-19T10:00:00Z").getTime();
const base = { demo_starts_at: new Date(now - 10 * day), demo_ends_at: new Date(now + 60 * day), demo_ended_at: null };

describe("partnership status", () => {
  it("runs, ends soon, ends, and is terminated", () => {
    expect(partnershipStatus({ demo_starts_at: null, demo_ends_at: null, demo_ended_at: null }, now)).toBe("not_started");
    expect(partnershipStatus(base, now)).toBe("active");
    expect(partnershipStatus({ ...base, demo_ends_at: new Date(now + 10 * day) }, now)).toBe("expiring");
    expect(partnershipStatus({ ...base, demo_ends_at: new Date(now - day) }, now)).toBe("expired");
    expect(partnershipStatus({ ...base, terminated_at: new Date(now), demo_ended_at: new Date(now) }, now)).toBe("terminated");
    expect(partnershipStatus({ ...base, deactivated_at: new Date(now) }, now)).toBe("deactivated");
  });
  it("is read-only once it has ended", () => {
    expect(canAct("active")).toBe(true);
    expect(canAct("expiring")).toBe(true);
    expect(canAct("expired")).toBe(false);
    expect(canAct("terminated")).toBe(false);
  });
  it("counts days left", () => {
    expect(daysLeft(base, now)).toBe(60);
    expect(daysLeft({ ...base, demo_ends_at: new Date(now - day) }, now)).toBe(0);
  });
});

describe("renewal", () => {
  it("needs the organisation minimum, or a reason, for Resellers and Channel Partners", () => {
    expect(renewalBlock({ status: "expiring", type: "channel_partner", organisations: 6, minOrganisations: 10 })).toBe("minimum_not_met");
    expect(renewalBlock({ status: "expiring", type: "reseller", organisations: 6, minOrganisations: 10, overrideReason: "short" })).toBe("minimum_not_met");
    expect(renewalBlock({ status: "expired", type: "reseller", organisations: 6, minOrganisations: 10, overrideReason: "Signed two large universities next week" })).toBeNull();
    expect(renewalBlock({ status: "active", type: "channel_partner", organisations: 10, minOrganisations: 10 })).toBeNull();
  });
  it("has no organisation minimum for Affiliates and Referral Partners", () => {
    expect(renewalBlock({ status: "expiring", type: "affiliate", organisations: 0, minOrganisations: 10 })).toBeNull();
    expect(renewalBlock({ status: "expiring", type: "referral", organisations: 0, minOrganisations: 10 })).toBeNull();
    expect(bringsOrganisations("affiliate")).toBe(false);
  });
  it("cannot renew a terminated or deactivated partner", () => {
    expect(renewalBlock({ status: "terminated", type: "affiliate", organisations: 0, minOrganisations: 0 })).toBe("partnership_terminated");
    expect(renewalBlock({ status: "deactivated", type: "affiliate", organisations: 0, minOrganisations: 0 })).toBe("partner_deactivated");
  });
  it("adds 3 months to the end, or to today if it has ended", () => {
    const n = new Date("2026-11-19T00:00:00Z");
    expect(renewedEnd(new Date("2026-12-01T00:00:00Z"), n).toISOString().slice(0, 10)).toBe("2027-03-01");
    expect(renewedEnd(new Date("2026-11-01T00:00:00Z"), n).toISOString().slice(0, 10)).toBe("2027-02-19");
  });
});

describe("codes and agreement", () => {
  it("prefixes codes by partner type", () => {
    expect(newPartnerCode("reseller")).toMatch(/^RS-[A-HJKMNP-Z2-9]{6}$/);
    expect(newPartnerCode("affiliate")).toMatch(/^AF-/);
    expect(newPartnerCode("referral")).toMatch(/^RF-/);
  });
  it("fills the agreement for the partner type", () => {
    const p = { partner_type: "reseller", full_name: "Acme Learning", email: "a@acme.test", code: "RS-ABCDEF", discount_percent: "20", min_organisations: 10, min_licences_per_org: 25, demo_licences: 250, demo_starts_at: base.demo_starts_at, demo_ends_at: base.demo_ends_at };
    const a = agreementText(p);
    const all = a.sections.flatMap((s) => s.items).join(" ");
    expect(a.title).toBe("Spica Reseller Agreement");
    expect(all).toContain("discount of 20%");
    expect(all).toContain("at least 10 organisations");
    expect(all).toContain("at least 25 licences");
    expect(all).toContain("30 days' written notice");
    const aff = agreementText({ ...p, partner_type: "affiliate", commission_percent: 10 });
    expect(aff.sections.map((s) => s.h).join(" ")).not.toContain("Demo licences");
    expect(aff.sections.flatMap((s) => s.items).join(" ")).toContain("No tracking cookies");
  });
});
