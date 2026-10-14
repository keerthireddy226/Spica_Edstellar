import { useEffect, useState } from "react";
import { Check, Gift, Minus, Percent, Tag } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/api/staff";
import { PageHeader, Panel, StatCard, paletteColor } from "@/components/staff/StaffKit";

interface Catalog {
  tiers: { tier: string; label: string; priceFloorCents: number; limits: { managers: number | null; batches: number | null }; support: string; features: { key: string; label: string; available: boolean }[] }[];
  volumeBands: { minQuantity: number; unitPriceCents: number }[];
  businessQualifyingQuantity: number;
  educationDiscountPercent: number;
  pilot: { licenses: number; days: number };
  allFeatures: { key: string; label: string; description: string; minTier: string; available: boolean }[];
}

// What Spica sells, for conversations with customers: plans, what's in
// each, prices, discounts and pilots.
export function PlansCatalog() {
  const [c, setC] = useState<Catalog | null>(null);
  useEffect(() => {
    api<Catalog>("/admin/plans-catalog")
      .then(setC)
      .catch(() => {});
  }, []);
  if (!c) return <p className="text-sm text-muted">Loading…</p>;
  const rank: Record<string, number> = { starter: 0, business: 1, enterprise: 2 };

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader title="Plans & pricing" subtitle="What each plan includes and costs — for proposals, renewals and upgrade conversations." />
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Tag} value={money(c.volumeBands[0].unitPriceCents, "USD")} label="List price per license-month" progress={1} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={Percent} value={`${c.educationDiscountPercent}%`} label="Education discount" sub="Universities and schools" progress={c.educationDiscountPercent / 100} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={Gift} value={`${c.pilot.licenses} × ${c.pilot.days} days`} label="Default pilot" sub="Free licenses to try Spica" progress={0.4} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Tag} value={c.businessQualifyingQuantity} label="Licenses that unlock Business" sub="In one purchase" progress={0.6} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {c.tiers.map((t, i) => (
          <div key={t.tier} className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden flex flex-col">
            <div style={{ background: `linear-gradient(135deg, ${paletteColor("terracotta", i)}, color-mix(in srgb, ${paletteColor("terracotta", i)} 65%, black))` }} className="px-5 py-4 text-white">
              <p className="font-display font-bold text-xl">{t.label}</p>
              <p className="text-sm text-white/85">from {money(t.priceFloorCents, "USD")} per license-month</p>
            </div>
            <div className="p-5 flex flex-col gap-3 flex-1">
              <p className="text-xs text-muted">
                {t.limits.managers == null ? "Unlimited Managers" : `Up to ${t.limits.managers} Managers`} · {t.limits.batches == null ? "unlimited batches" : `up to ${t.limits.batches} batches`} · {t.support}
              </p>
              <ul className="flex flex-col gap-1.5 text-sm">
                {c.allFeatures.map((f) => {
                  const included = rank[f.minTier] <= rank[t.tier];
                  return (
                    <li key={f.key} className={`flex items-start gap-2 ${included ? "text-ink" : "text-muted"}`} title={f.description}>
                      {included ? <Check size={15} className="text-success mt-0.5 shrink-0" /> : <Minus size={15} className="mt-0.5 shrink-0" />}
                      <span>
                        {f.label}
                        {included && !f.available && <span className="ml-1 text-[10px] font-semibold uppercase text-warning">coming soon</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <Panel title="Volume pricing">
        <div className="grid sm:grid-cols-3 gap-3">
          {c.volumeBands.map((b, i) => (
            <div key={b.minQuantity} className="rounded-input bg-paper-warm px-4 py-3">
              <p className="text-xs text-muted">{i === c.volumeBands.length - 1 ? `${b.minQuantity}+ licenses` : `${b.minQuantity}–${c.volumeBands[i + 1].minQuantity - 1} licenses`}</p>
              <p className="font-display font-bold text-xl text-ink">{money(b.unitPriceCents, "USD")}</p>
              <p className="text-[11px] text-muted">per license-month, in one purchase</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">A plan's rate applies to every purchase, including small top-ups. Custom prices for an organization are set from its Plan panel.</p>
      </Panel>
    </div>
  );
}
