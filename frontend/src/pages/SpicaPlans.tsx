import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { formatAmount, getPriceList, type PricedProduct, type ShopCurrency } from "@/api/payments";
import { getQuota, type QuotaTier } from "@/api/practiceTests";
import { formatUsdCents, TIER_LABELS, type PlanTier } from "@/api/plans";
import { trServer } from "@/i18n/serverText";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// Spica plans: every plan in one place, for individuals and for
// organizations. A read-only overview; buying stays on Plans (individuals),
// Licenses and Tests & credits (organizations).

interface Overview {
  catalog: { tier: PlanTier; label: string; support: string; limits: Record<string, number | null>; features: string[]; fromPriceCents: number }[];
  features: { key: string; label: string; available: boolean }[];
  licenseBands: { minQuantity: number; unitPriceCents: number }[];
  educationDiscountPercent: number;
  creditBands: { minQuantity: number; unitPriceCents: number }[];
  organization: { tier: PlanTier; customPriceCents: number | null } | null;
}

const TESTS = ["placement", "speakingListening", "writing", "fourSkills", "professional"];

function Item({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2 text-sm ${ok ? "text-ink" : "text-muted"}`}>
      {ok ? <Check size={16} className="text-success shrink-0 mt-0.5" /> : <Minus size={16} className="shrink-0 mt-0.5" />}
      <span>{children}</span>
    </li>
  );
}

function Card({ eyebrow, title, price, highlight, children, action }: { eyebrow: string; title: string; price?: React.ReactNode; highlight?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`bg-surface rounded-card p-5 flex flex-col gap-3 min-w-0 ${highlight ? "border-2 border-navy" : "border border-rule"}`}>
      {highlight && <span className="self-start text-[11px] font-semibold text-white bg-navy rounded-pill px-2.5 py-0.5">{highlight}</span>}
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">{eyebrow}</span>
      <h3 className="font-display font-bold text-lg text-ink">{title}</h3>
      {price && <div className="font-display font-bold text-2xl text-ink tabular-nums">{price}</div>}
      <ul className="flex flex-col gap-1.5">{children}</ul>
      {action && <div className="mt-auto pt-1">{action}</div>}
    </div>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <div className="flex flex-col border border-rule rounded-xl overflow-hidden">
      {rows.map(([a, b]) => (
        <div key={a} className="flex justify-between gap-3 px-3.5 py-2 text-sm border-t border-rule first:border-t-0">
          <span className="text-ink">{a}</span>
          <b className="text-ink tabular-nums whitespace-nowrap">{b}</b>
        </div>
      ))}
    </div>
  );
}

const linkBtn = "inline-flex justify-center rounded-pill px-4 py-2 text-sm font-semibold";

function Individuals({ canBuy }: { canBuy: boolean }) {
  const [currency, setCurrency] = useState<ShopCurrency | undefined>(undefined);
  const [list, setList] = useState<Awaited<ReturnType<typeof getPriceList>> | null>(null);
  const [tiers, setTiers] = useState<QuotaTier[]>([]);
  useEffect(() => {
    getPriceList(currency).then((r) => {
      setList(r);
      if (!currency) setCurrency(r.currency);
    });
  }, [currency]);
  useEffect(() => {
    getQuota()
      .then((r) => setTiers(r.tiers ?? []))
      .catch(() => {});
  }, []);
  if (!list) return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  const by = (kind: PricedProduct["kind"]) => list.products.filter((p) => p.kind === kind);
  const price = (p: PricedProduct | undefined) => (p ? formatAmount(p.amount, p.currency) : "—");
  const min = (kind: PricedProduct["kind"]) => {
    const xs = by(kind);
    return xs.length ? xs.reduce((a, b) => (a.amount <= b.amount ? a : b)) : undefined;
  };
  const free = tiers.find((t) => t.segment === "individual" && t.tier === "free");
  const plus = tiers.find((t) => t.segment === "individual" && t.tier !== "free");
  const buy = canBuy ? (
    <Link to={ROUTES.PLANS} className={`${linkBtn} border border-rule-strong text-ink hover:bg-paper-warm`}>
      {tr("Go to Plans")}
    </Link>
  ) : null;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display font-bold text-xl text-ink">{tr("For individuals")}</h2>
        <label className="flex items-center gap-2 text-sm text-ink">
          {tr("Currency")}
          <select value={list.currency} onChange={(e) => setCurrency(e.target.value as ShopCurrency)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm cursor-pointer">
            {list.currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <Card eyebrow={tr("Start free")} title={tr("Free")} price={formatAmount(0, list.currency)}>
          <Item ok>{tr("One level test")}</Item>
          <Item ok>{tr("3 practice sessions a week")}</Item>
          <Item ok>
            {free
              ? tr("{{p}} practice tests and {{m}} mock tests a month", { p: free.practicePerMonth ?? "∞", m: free.mocksPerMonth ?? "∞" })
              : tr("A few practice tests and mock tests a month")}
          </Item>
          <Item ok={false}>{tr("AI speaking tutor")}</Item>
          <Item ok={false}>{tr("No certificate included")}</Item>
        </Card>
        <Card eyebrow={tr("Everything")} title={tr("Full access")} price={<>{price(by("full")[0])} <small className="text-sm font-medium text-muted">{tr("a month")}</small></>} highlight={tr("Most complete")} action={buy}>
          <Item ok>{tr("Every test: practice tests, Practice Modules, AI tutor")}</Item>
          <Item ok>{plus?.mocksPerMonth ? tr("{{n}} mock tests a month", { n: plus.mocksPerMonth }) : tr("Mock tests")}</Item>
          <Item ok>{tr("Level test retakes")}</Item>
          <Item ok>{tr("One final assessment on the test you choose")}</Item>
          <Item ok>{tr("Certificate provided")}</Item>
        </Card>
        <Card eyebrow={tr("Prepare for one test")} title={tr("Preparation + real test + certificate")} price={<>{tr("from {{p}}", { p: price(min("prep")) })} <small className="text-sm font-medium text-muted">{tr("30 days")}</small></>} action={buy}>
          <Item ok>{tr("That test's practice tests and mock tests")}</Item>
          <Item ok>{tr("Its Practice Modules question types")}</Item>
          <Item ok>{tr("One real test with a certificate")}</Item>
        </Card>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <Card eyebrow={tr("Prove your level")} title={tr("Real test + certificate")} action={buy}>
          <Rows rows={by("assessment").map((p) => [p.testTypeName ?? p.name, price(p)])} />
        </Card>
        <Card eyebrow={tr("One level, A1 to C2")} title={tr("Level test + certificate")} price={price(by("level")[0])} action={buy}>
          <Item ok>{tr("Questions at the level you choose, all four skills")}</Item>
          <Item ok>{tr("Pass at 70% overall and 50% in each skill")}</Item>
          <Item ok>{tr("That level's certificate")}</Item>
        </Card>
        <Card eyebrow={tr("Just practice")} title={tr("Practice pack")} price={<>{price(by("pack")[0])} <small className="text-sm font-medium text-muted">{tr("30 days")}</small></>} action={buy}>
          <Item ok>{tr("Practice Modules in every question type")}</Item>
          <Item ok>{tr("At your level as it grows, aiming at the level you choose")}</Item>
          <Item ok={false}>{tr("No certificate included")}</Item>
        </Card>
      </div>
      {!canBuy && <p className="text-sm text-muted">{tr("Your organization gives you your access. Ask your organization if you need another test.")}</p>}
    </div>
  );
}

function Organizations({ data, isOrgAdmin }: { data: Overview; isOrgAdmin: boolean }) {
  const [credits, setCredits] = useState<PricedProduct[]>([]);
  useEffect(() => {
    getPriceList("USD").then((r) => setCredits(r.products));
  }, []);
  const label = (k: string) => trServer(data.features.find((f) => f.key === k)?.label ?? k);
  const creditOf = (id: string) => credits.find((p) => p.id === id)?.credits ?? null;
  const yours = data.organization?.tier;
  return (
    <div className="flex flex-col gap-5">
      <h2 className="font-display font-bold text-xl text-ink">{tr("For organizations")}</h2>
      <div className="grid md:grid-cols-3 gap-4">
        {data.catalog.map((c) => (
          <Card
            key={c.tier}
            eyebrow={c.tier === "starter" ? tr("Get going") : c.tier === "business" ? tr("Grow") : tr("At scale")}
            title={TIER_LABELS[c.tier]}
            price={
              <>
                {formatUsdCents(yours === c.tier && data.organization?.customPriceCents ? data.organization.customPriceCents : c.fromPriceCents)}{" "}
                <small className="text-sm font-medium text-muted">{tr("per learner-month")}</small>
              </>
            }
            highlight={yours === c.tier ? tr("Your plan") : undefined}
          >
            {c.limits.managers !== null && <Item ok>{tr("Up to {{m}} Managers and {{b}} batches", { m: c.limits.managers, b: c.limits.batches ?? "∞" })}</Item>}
            {c.limits.managers === null && <Item ok>{tr("Unlimited Managers and batches")}</Item>}
            <Item ok>{tr("Programs, reports, certificates provided")}</Item>
            {c.features.map((k) => (
              <Item key={k} ok>
                {label(k)}
              </Item>
            ))}
          </Card>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card
          eyebrow={tr("Full access")}
          title={tr("Licenses")}
          action={
            isOrgAdmin ? (
              <Link to={ROUTES.ORG_ADMIN_LICENSES} className={`${linkBtn} bg-navy text-white`}>
                {tr("Buy licenses")}
              </Link>
            ) : null
          }
        >
          <p className="text-sm text-muted">{tr("1 license = 1 learner's access to everything for a month, certificate provided.")}</p>
          <p className="text-sm text-muted">{tr("Each licensed learner gets one final assessment, a real test with a certificate.")}</p>
          <Rows
            rows={data.licenseBands.map((b, i) => [
              data.licenseBands[i + 1] ? tr("{{a}}–{{b}} licenses", { a: b.minQuantity, b: data.licenseBands[i + 1].minQuantity - 1 }) : tr("{{a}} or more", { a: b.minQuantity }),
              tr("{{p}} each", { p: formatUsdCents(b.unitPriceCents) }),
            ])}
          />
          <p className="text-xs text-muted">{tr("Universities and schools get {{n}}% off.", { n: data.educationDiscountPercent })}</p>
        </Card>
        <Card
          eyebrow={tr("Pay per test")}
          title={tr("Credits")}
          action={
            isOrgAdmin ? (
              <Link to={ROUTES.ORG_ADMIN_TESTS} className={`${linkBtn} border border-rule-strong text-ink hover:bg-paper-warm`}>
                {tr("Tests & credits")}
              </Link>
            ) : null
          }
        >
          <p className="text-sm text-muted">{tr("For real tests, preparation for one test, practice packs and candidate tests. Unused real tests give their credits back.")}</p>
          <Rows
            rows={data.creditBands.map((b, i) => [
              data.creditBands[i + 1] ? tr("{{a}}–{{b}} credits", { a: b.minQuantity, b: data.creditBands[i + 1].minQuantity - 1 }) : tr("{{a}} or more", { a: b.minQuantity }),
              tr("{{p}} each", { p: formatUsdCents(b.unitPriceCents) }),
            ])}
          />
        </Card>
      </div>
      {credits.length > 0 && (
        <div className="overflow-x-auto bg-surface border border-rule rounded-card">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="bg-paper-warm/60 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5">{tr("Credits per test")}</th>
                <th className="px-4 py-2.5">{tr("Real test + certificate")}</th>
                <th className="px-4 py-2.5">{tr("Preparation + real test + certificate, a month")}</th>
              </tr>
            </thead>
            <tbody>
              {TESTS.map((t) => (
                <tr key={t} className="border-t border-rule">
                  <td className="px-4 py-2.5 text-ink">{credits.find((p) => p.testTypeId === t)?.testTypeName ?? t}</td>
                  <td className="px-4 py-2.5 tabular-nums">{creditOf(`assess_${t}`) ?? "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums">{creditOf(`prep_${t}`) ?? "—"}</td>
                </tr>
              ))}
              <tr className="border-t border-rule">
                <td className="px-4 py-2.5 text-ink">{tr("Practice pack, a month")}</td>
                <td className="px-4 py-2.5 text-muted">—</td>
                <td className="px-4 py-2.5 tabular-nums">{creditOf("practice_pack") ?? "—"}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function SpicaPlans() {
  const { user } = useAuth();
  const isOrgPerson = user?.role === "org_admin" || user?.role === "manager";
  const [tab, setTab] = useState<"individuals" | "organizations">(isOrgPerson ? "organizations" : "individuals");
  const [data, setData] = useState<Overview | null>(null);
  const [canBuy, setCanBuy] = useState(false);
  useEffect(() => {
    api<Overview>("/plans/overview").then(setData);
    getPriceList()
      .then((r) => setCanBuy(r.canBuy))
      .catch(() => {});
  }, []);
  return (
    <div className="flex flex-col gap-5 w-full max-w-5xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Spica plans")}</h1>
        <p className="text-sm text-muted mt-1">{tr("Every Spica plan in one place: practise, prove your level, and get a certificate anyone can check.")}</p>
      </div>
      <div className="flex gap-1 border-b border-rule">
        {(
          [
            ["individuals", tr("For individuals")],
            ["organizations", tr("For organizations")],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2.5 text-sm font-semibold -mb-px border-b-2 cursor-pointer ${tab === k ? "border-navy text-navy" : "border-transparent text-muted hover:text-ink"}`}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === "individuals" ? <Individuals canBuy={canBuy} /> : data ? <Organizations data={data} isOrgAdmin={user?.role === "org_admin"} /> : <p className="text-sm text-muted">{tr("Loading…")}</p>}
    </div>
  );
}
