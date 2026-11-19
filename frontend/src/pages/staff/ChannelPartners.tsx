import { useEffect, useMemo, useState } from "react";
import { OrdersPanel } from "@/pages/partner/PartnerOrders";
import { CalendarClock, Gift, Handshake, KeyRound, Mail, Plus, Power, Building2, History, Receipt } from "lucide-react";
import { Button } from "@/components/Button";
import { EmptyNote, Notice, PageError, PageHeader, PageLoading, SearchBox, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { Badge, DetailModal, InfoGrid, ModalEmpty, ModalSection } from "@/components/DetailModal";
import {
  createChannelPartner,
  deactivatePartner,
  endDemo,
  extendDemo,
  getChannelPartner,
  listChannelPartners,
  reactivatePartner,
  resendPartnerInvite,
  startDemo,
  updateChannelPartner,
  type ChannelPartner,
  type ChannelPartnerDetail,
} from "@/api/channelPartners";
import { tr } from "@/i18n/tr";
import { AddOrganisation, GiveLicences, type PartnerOrg } from "@/pages/partner/PartnerDashboard";

// Channel Partners (stage 1): register partners, their code, commission and
// free demo allocation, and the demo window. Partners can't sign themselves up.
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—");
const dateInput = (d: Date) => d.toISOString().slice(0, 10);
const plusMonths = (n: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d;
};
const endOfDayIso = (v: string) => new Date(`${v}T23:59:59`).toISOString();
const daysLeft = (s: string | null) => (s ? Math.ceil((new Date(s).getTime() - Date.now()) / 86400000) : null);

function DemoPill({ p }: { p: ChannelPartner }) {
  if (p.demoStatus === "not_started") return <StatusPill tone="muted">{tr("Demo not started")}</StatusPill>;
  if (p.demoStatus === "ended") return <StatusPill tone="error">{tr("Demo ended")}</StatusPill>;
  const d = daysLeft(p.demoEndsAt);
  return <StatusPill tone={d !== null && d <= 14 ? "warning" : "success"}>{tr("Demo active · {{n}} days left", { n: d ?? 0 })}</StatusPill>;
}

const actionLabel = (a: string) =>
  ({
    "channel_partner.created": tr("Partner registered"),
    "channel_partner.updated": tr("Details changed"),
    "channel_partner.own_licence_on": tr("Own demo licence switched on"),
    "channel_partner.own_licence_off": tr("Own demo licence switched off"),
    "channel_partner.demo_started": tr("Demo licences made available"),
    "channel_partner.demo_extended": tr("Demo window changed"),
    "channel_partner.demo_ended": tr("Demo window ended"),
    "channel_partner.deactivated": tr("Partner deactivated"),
    "channel_partner.reactivated": tr("Partner reactivated"),
    "channel_partner.invite_resent": tr("Invitation sent again"),
    "channel_partner.organisation_added": tr("Organisation added"),
    "channel_partner.licences_given": tr("Demo licences given"),
  })[a] ?? a;

export function ChannelPartners() {
  const [rows, setRows] = useState<ChannelPartner[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const load = () => {
    setFailed(false);
    listChannelPartners()
      .then((r) => setRows(r.partners))
      .catch(() => setFailed(true));
  };
  useEffect(load, []);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((p) => !s || `${p.fullName} ${p.email} ${p.code}`.toLowerCase().includes(s));
  }, [rows, q]);
  if (failed) return <PageError message={tr("Could not load Channel Partners.")} onRetry={load} />;
  if (!rows) return <PageLoading />;
  const active = rows.filter((p) => p.active);
  const totalDemo = active.reduce((n, p) => n + p.demoLicences, 0);
  const runningDemos = active.filter((p) => p.demoStatus === "active").length;
  const orgs = rows.reduce((n, p) => n + p.organisations, 0);

  return (
    <div className="flex flex-col gap-6 w-full">
      <PageHeader
        title={tr("Channel Partners")}
        subtitle={tr("Partners who bring universities, colleges and companies to Spica. Register a partner, set their free demo licences and window, and track what they bring.")}
        actions={
          <Button onClick={() => setCreating(true)} className="flex items-center gap-1.5">
            <Plus size={16} /> {tr("Register a partner")}
          </Button>
        }
      />
      {notice && (
        <Notice tone={notice.tone} onClose={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard variant="ledger" palette="terracotta" index={0} icon={Handshake} value={active.length} label={tr("Active partners")} sub={tr("{{n}} registered in total", { n: rows.length })} progress={rows.length ? active.length / rows.length : 0} />
        <StatCard variant="ledger" palette="terracotta" index={1} icon={Gift} value={totalDemo} label={tr("Free demo licences")} sub={tr("Across active partners")} progress={0.5} />
        <StatCard variant="ledger" palette="terracotta" index={2} icon={CalendarClock} value={runningDemos} label={tr("Demo windows open")} sub={tr("Licences available to give out")} progress={active.length ? runningDemos / active.length : 0} />
        <StatCard variant="ledger" palette="terracotta" index={3} icon={Building2} value={orgs} label={tr("Organisations brought")} sub={tr("By all partners")} progress={0.3} />
      </div>

      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden">
        <div className="p-4 border-b border-rule flex flex-wrap gap-3 items-center">
          <SearchBox value={q} onChange={setQ} placeholder={tr("Search by name, email or code")} />
        </div>
        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyNote>{rows.length ? tr("No partner matches your search.") : tr("No Channel Partners yet. Register the first one.")}</EmptyNote>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-paper-warm text-xs text-muted uppercase tracking-wide">
                <tr>
                  {[tr("Partner"), tr("Code"), tr("Demo licences"), tr("Demo window"), tr("Own licence"), tr("Commission"), tr("Organisations"), tr("Status")].map((h) => (
                    <th key={h} className="text-left font-semibold px-4 py-2.5 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} onClick={() => setOpenId(p.id)} className="border-t border-rule hover:bg-paper-warm/60 cursor-pointer">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{p.fullName}</p>
                      <p className="text-xs text-muted">{p.email}</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{p.code}</td>
                    <td className="px-4 py-3">{tr("{{given}} of {{total}} given", { given: p.demoLicencesGiven, total: p.demoLicences })}</td>
                    <td className="px-4 py-3">
                      <DemoPill p={p} />
                      {p.demoEndsAt && <p className="text-xs text-muted mt-1">{tr("Until {{d}}", { d: day(p.demoEndedAt ?? p.demoEndsAt) })}</p>}
                    </td>
                    <td className="px-4 py-3">{p.ownLicenceEnabled ? <StatusPill tone="success">{tr("On")}</StatusPill> : <StatusPill tone="muted">{tr("Off")}</StatusPill>}</td>
                    <td className="px-4 py-3">{p.commissionPercent}%</td>
                    <td className="px-4 py-3">{p.organisations}</td>
                    <td className="px-4 py-3">
                      {!p.active ? <StatusPill tone="error">{tr("Deactivated")}</StatusPill> : p.invitePending ? <StatusPill tone="warning">{tr("Invite pending")}</StatusPill> : <StatusPill tone="success">{tr("Active")}</StatusPill>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <CreatePartner
          onClose={() => setCreating(false)}
          onCreated={(code, emailSent) => {
            setCreating(false);
            setNotice({ tone: emailSent ? "success" : "error", text: emailSent ? tr("Partner registered with code {{code}}. They've been emailed a link to set their password.", { code }) : tr("Partner registered with code {{code}}, but the invitation email didn't go out. Open the partner and send it again.", { code }) });
            load();
          }}
        />
      )}
      {openId && <PartnerDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}

const input = "w-full rounded-input border border-rule bg-surface px-3 py-2 text-sm focus:outline-none focus:border-navy";
const label = "text-xs font-semibold text-muted uppercase tracking-wide";

function CreatePartner({ onClose, onCreated }: { onClose: () => void; onCreated: (code: string, emailSent: boolean) => void }) {
  const [f, setF] = useState({ fullName: "", email: "", commissionPercent: "0", demoLicences: "250", startDemoNow: true, demoEndsAt: dateInput(plusMonths(3)), ownLicenceEnabled: false, notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const submit = async () => {
    setErr(null);
    if (f.fullName.trim().length < 2) return setErr(tr("Enter the partner's full name."));
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return setErr(tr("Enter a valid email address."));
    setBusy(true);
    try {
      const r = await createChannelPartner({
        fullName: f.fullName.trim(),
        email: f.email.trim(),
        commissionPercent: Number(f.commissionPercent) || 0,
        demoLicences: Math.max(0, Math.round(Number(f.demoLicences) || 0)),
        startDemoNow: f.startDemoNow,
        demoEndsAt: f.startDemoNow ? endOfDayIso(f.demoEndsAt) : undefined,
        ownLicenceEnabled: f.ownLicenceEnabled,
        notes: f.notes.trim() || undefined,
      });
      onCreated(r.code, r.emailSent);
    } catch (e) {
      const m = String((e as Error).message ?? "");
      setErr(m.includes("email_already_registered") ? tr("This email already has a Spica account. Use a different email.") : m.includes("demo_end_in_past") ? tr("The demo end date must be in the future.") : tr("Could not register the partner. Try again."));
      setBusy(false);
    }
  };
  return (
    <DetailModal title={tr("Register a Channel Partner")} subtitle={tr("The partner gets an email to set their password. Spica creates their unique code.")} icon={Handshake} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Full name")}</span>
            <input className={input} value={f.fullName} onChange={set("fullName")} placeholder={tr("e.g. Priya Sharma")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Email")}</span>
            <input className={input} type="email" value={f.email} onChange={set("email")} placeholder="name@company.com" />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Free demo licences")}</span>
            <input className={input} type="number" min={0} value={f.demoLicences} onChange={set("demoLicences")} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>{tr("Commission (%)")}</span>
            <input className={input} type="number" min={0} max={100} step="0.5" value={f.commissionPercent} onChange={set("commissionPercent")} />
            <span className="text-xs text-muted">{tr("For paid orders later. Leave at 0 until decided.")}</span>
          </label>
        </div>
        <label className="flex items-start gap-2.5 rounded-input border border-rule p-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-navy" checked={f.startDemoNow} onChange={set("startDemoNow")} />
          <span className="text-sm">
            <b>{tr("Make the demo licences available now")}</b>
            <br />
            <span className="text-muted">{tr("The demo window starts today. The partner gives out licences until the end date (3 months by default).")}</span>
          </span>
        </label>
        {f.startDemoNow && (
          <label className="flex flex-col gap-1 max-w-xs">
            <span className={label}>{tr("Demo window ends")}</span>
            <input className={input} type="date" min={dateInput(new Date(Date.now() + 86400000))} value={f.demoEndsAt} onChange={set("demoEndsAt")} />
          </label>
        )}
        <label className="flex items-start gap-2.5 rounded-input border border-rule p-3 cursor-pointer">
          <input type="checkbox" className="mt-0.5 accent-navy" checked={f.ownLicenceEnabled} onChange={set("ownLicenceEnabled")} />
          <span className="text-sm">
            <b>{tr("Give the partner one demo licence of their own")}</b>
            <br />
            <span className="text-muted">{tr("For showing Spica in meetings. Separate from the free demo licences. No official certificate.")}</span>
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className={label}>{tr("Notes (only Spica staff see these)")}</span>
          <textarea className={input} rows={2} value={f.notes} onChange={set("notes")} />
        </label>
        {err && <Notice tone="error">{err}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {tr("Cancel")}
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? tr("Registering…") : tr("Register partner")}
          </Button>
        </div>
      </div>
    </DetailModal>
  );
}

function PartnerDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<ChannelPartnerDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState("overview");
  // A normal popup (not the browser's) to confirm ending the window or deactivating.
  const [ask, setAsk] = useState<{ text: string; label: string; go: () => void } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [edit, setEdit] = useState<{ fullName: string; demoLicences: string; commissionPercent: string; notes: string } | null>(null);
  const [endDate, setEndDate] = useState("");
  const [adding, setAdding] = useState(false);
  const [giving, setGiving] = useState<PartnerOrg | null>(null);
  const load = () =>
    getChannelPartner(id)
      .then((r) => {
        setD(r);
        setEndDate(dateInput(r.partner.demoEndsAt ? new Date(r.partner.demoEndsAt) : plusMonths(3)));
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "success", text: ok });
      await load();
      onChanged();
    } catch {
      setMsg({ tone: "error", text: tr("That didn't work. Try again.") });
    } finally {
      setBusy(false);
    }
  };
  if (failed) return <DetailModal title={tr("Channel Partner")} onClose={onClose}><ModalEmpty>{tr("Could not load this partner.")}</ModalEmpty></DetailModal>;
  if (!d) return <DetailModal title={tr("Channel Partner")} onClose={onClose}><ModalEmpty>{tr("Loading…")}</ModalEmpty></DetailModal>;
  const p = d.partner;
  const initials = p.fullName.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return (
    <DetailModal
      title={p.fullName}
      subtitle={`${p.email} · ${p.code}`}
      initials={initials}
      onClose={onClose}
      badges={
        <>
          <Badge tone={p.demoStatus === "active" ? "good" : p.demoStatus === "ended" ? "bad" : "neutral"}>
            {p.demoStatus === "active" ? tr("Demo active") : p.demoStatus === "ended" ? tr("Demo ended") : tr("Demo not started")}
          </Badge>
          <Badge tone={!p.active ? "bad" : p.invitePending ? "warn" : "good"}>{!p.active ? tr("Deactivated") : p.invitePending ? tr("Invite pending") : tr("Active")}</Badge>
        </>
      }
      stats={[
        { label: tr("Demo licences"), value: tr("{{given}} of {{total}}", { given: p.demoLicencesGiven, total: p.demoLicences }), hint: tr("Given out") },
        { label: tr("Demo window"), value: p.demoStatus === "not_started" ? tr("Not started") : day(p.demoEndedAt ?? p.demoEndsAt), hint: p.demoStatus === "active" ? tr("Ends") : p.demoStatus === "ended" ? tr("Ended") : undefined },
        { label: tr("Organisations"), value: p.organisations },
        { label: tr("Learners on a demo"), value: d.organisations.reduce((n, o) => n + o.demoUsed, 0), hint: tr("{{n}} started a test", { n: d.organisations.reduce((n, o) => n + o.demoStarted, 0) }) },
        { label: tr("Commission"), value: `${p.commissionPercent}%` },
      ]}
      tabs={[
        { key: "overview", label: tr("Overview") },
        { key: "orgs", label: tr("Organisations"), count: d.organisations.length },
        { key: "orders", label: tr("Orders") },
        { key: "history", label: tr("History"), count: d.history.length },
      ]}
      tab={tab}
      onTab={setTab}
    >
      <div className="flex flex-col gap-5">
        {msg && (
          <Notice tone={msg.tone} onClose={() => setMsg(null)}>
            {msg.text}
          </Notice>
        )}
        {tab === "overview" && (
          <>
            <ModalSection
              title={tr("Partner details")}
              icon={Handshake}
              action={
                !edit && (
                  <button className="text-sm font-semibold text-navy cursor-pointer" onClick={() => setEdit({ fullName: p.fullName, demoLicences: String(p.demoLicences), commissionPercent: String(p.commissionPercent), notes: p.notes ?? "" })}>
                    {tr("Edit")}
                  </button>
                )
              }
            >
              {edit ? (
                <div className="flex flex-col gap-3">
                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="flex flex-col gap-1">
                      <span className={label}>{tr("Full name")}</span>
                      <input className={input} value={edit.fullName} onChange={(e) => setEdit({ ...edit, fullName: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={label}>{tr("Free demo licences")}</span>
                      <input className={input} type="number" min={0} value={edit.demoLicences} onChange={(e) => setEdit({ ...edit, demoLicences: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={label}>{tr("Commission (%)")}</span>
                      <input className={input} type="number" min={0} max={100} step="0.5" value={edit.commissionPercent} onChange={(e) => setEdit({ ...edit, commissionPercent: e.target.value })} />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className={label}>{tr("Notes (only Spica staff see these)")}</span>
                    <textarea className={input} rows={2} value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
                  </label>
                  <div className="flex gap-2 justify-end">
                    <Button variant="secondary" onClick={() => setEdit(null)}>
                      {tr("Cancel")}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        run(async () => {
                          await updateChannelPartner(p.id, { fullName: edit.fullName.trim(), demoLicences: Math.max(0, Math.round(Number(edit.demoLicences) || 0)), commissionPercent: Number(edit.commissionPercent) || 0, notes: edit.notes.trim() || null });
                          setEdit(null);
                        }, tr("Saved."))
                      }
                    >
                      {tr("Save")}
                    </Button>
                  </div>
                </div>
              ) : (
                <InfoGrid
                  columns={3}
                  items={[
                    [tr("Partner code"), <span className="font-mono">{p.code}</span>],
                    [tr("Email"), p.email],
                    [tr("Commission"), `${p.commissionPercent}%`],
                    [tr("Free demo licences"), p.demoLicences],
                    [tr("Registered"), `${day(p.createdAt)}${p.createdBy ? ` · ${p.createdBy}` : ""}`],
                    [tr("Last sign-in"), p.lastSignIn ? day(p.lastSignIn) : tr("Not yet")],
                    [tr("Notes"), p.notes || "—"],
                  ]}
                />
              )}
            </ModalSection>

            <ModalSection title={tr("Demo window")} icon={CalendarClock}>
              <p className="text-sm text-muted">
                {p.demoStatus === "not_started"
                  ? tr("The demo licences aren't available yet. Making them available starts the window today.")
                  : p.demoStatus === "active"
                    ? tr("The partner can give out demo licences until {{d}}. Each learner then has 7 days.", { d: day(p.demoEndsAt) })
                    : tr("The demo window ended on {{d}}. Set a new end date to open it again.", { d: day(p.demoEndedAt ?? p.demoEndsAt) })}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1">
                  <span className={label}>{p.demoStatus === "not_started" ? tr("Window ends") : tr("New end date")}</span>
                  <input className={input} type="date" min={dateInput(new Date(Date.now() + 86400000))} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </label>
                {p.demoStatus === "not_started" && (
                  <Button disabled={busy || !p.active} onClick={() => run(() => startDemo(p.id, endOfDayIso(endDate)), tr("Demo licences are now available."))}>
                    {tr("Make demo licences available")}
                  </Button>
                )}
                {p.demoStatus === "active" && (
                  <>
                    <Button disabled={busy} onClick={() => run(() => extendDemo(p.id, endOfDayIso(endDate)), tr("Demo window changed."))}>
                      {tr("Change end date")}
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setAsk({ text: tr("End the demo window now? The partner can't give out more demo licences."), label: tr("End now"), go: () => run(() => endDemo(p.id), tr("Demo window ended.")) })}>
                      {tr("End now")}
                    </Button>
                  </>
                )}
                {p.demoStatus === "ended" && (
                  <Button disabled={busy || !p.active} onClick={() => run(() => extendDemo(p.id, endOfDayIso(endDate)), tr("Demo window opened again."))}>
                    {tr("Extend the window")}
                  </Button>
                )}
              </div>
            </ModalSection>

            <ModalSection title={tr("Partner's own demo licence")} icon={KeyRound}>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" className="mt-0.5 accent-navy" checked={p.ownLicenceEnabled} disabled={busy} onChange={(e) => run(() => updateChannelPartner(p.id, { ownLicenceEnabled: e.target.checked }), e.target.checked ? tr("Own demo licence switched on.") : tr("Own demo licence switched off."))} />
                <span className="text-sm">
                  {tr("One demo licence for the partner to show Spica in meetings. Separate from the free demo licences; no official certificate (a sample certificate is shown).")}
                </span>
              </label>
            </ModalSection>

            <ModalSection title={tr("Account")} icon={Power}>
              <div className="flex flex-wrap gap-2">
                {p.active && (
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => resendPartnerInvite(p.id), tr("Invitation sent again."))} className="flex items-center gap-1.5">
                    <Mail size={15} /> {p.invitePending ? tr("Send the invitation again") : tr("Send a set-password link")}
                  </Button>
                )}
                {p.active ? (
                  <Button variant="secondary" disabled={busy} onClick={() => setAsk({ text: tr("Deactivate this partner? They're signed out and can't sign in. Their organisations stay."), label: tr("Deactivate partner"), go: () => run(() => deactivatePartner(p.id), tr("Partner deactivated.")) })}>
                    {tr("Deactivate partner")}
                  </Button>
                ) : (
                  <Button disabled={busy} onClick={() => run(() => reactivatePartner(p.id), tr("Partner reactivated."))}>
                    {tr("Reactivate partner")}
                  </Button>
                )}
              </div>
            </ModalSection>
          </>
        )}
        {ask && (
          <DetailModal title={tr("Are you sure?")} subtitle={p.fullName} icon={Handshake} onClose={() => setAsk(null)}>
            <div className="flex flex-col gap-4 text-sm">
              <p>{ask.text}</p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setAsk(null)}>
                  {tr("Cancel")}
                </Button>
                <Button
                  onClick={() => {
                    const go = ask.go;
                    setAsk(null);
                    go();
                  }}
                >
                  {ask.label}
                </Button>
              </div>
            </div>
          </DetailModal>
        )}
        {tab === "orgs" && (
          <ModalSection
            title={tr("Organisations brought by this partner")}
            icon={Building2}
            action={
              <Button onClick={() => setAdding(true)} disabled={p.demoStatus !== "active" || !p.active} className="!px-3 !py-1.5 flex items-center gap-1">
                <Plus size={14} /> {tr("Add for this partner")}
              </Button>
            }
          >
            {d.organisations.length === 0 ? (
              <ModalEmpty>{tr("None yet. The partner adds them from their portal, or you can add one for them.")}</ModalEmpty>
            ) : (
              <ul className="flex flex-col gap-2">
                {d.organisations.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border border-rule rounded-input px-3 py-2 text-sm">
                    <span>
                      <b>{o.name}</b>
                      <span className="text-muted"> · {o.admin.name} ({o.admin.email}){o.admin.invitePending ? ` · ${tr("Invite pending")}` : ""}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-muted">
                        {tr("{{used}} of {{n}} demo licences used · {{l}} learners", { used: o.demoUsed, n: o.demoLicences, l: o.learners })}
                        <br />
                        {tr("{{s}} started · {{p}} practice tests and {{m}} mock tests finished", { s: o.demoStarted, p: o.practiceDone, m: o.mocksDone })}
                      </span>
                      <button className="text-sm font-semibold text-navy cursor-pointer disabled:opacity-40" disabled={p.demoStatus !== "active"} onClick={() => setGiving(o)}>
                        {tr("Give licences")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {adding && <AddOrganisation left={p.demoLicences - p.demoLicencesGiven} windowEndsAt={p.demoEndedAt ?? p.demoEndsAt} endpoint={`/admin/channel-partners/${p.id}/organisations`} onClose={() => setAdding(false)} onDone={(name) => { setAdding(false); setMsg({ tone: "success", text: tr("{{name}} added for this partner.", { name }) }); load(); onChanged(); }} />}
            {giving && <GiveLicences org={giving} left={p.demoLicences - p.demoLicencesGiven} windowEndsAt={p.demoEndedAt ?? p.demoEndsAt} endpoint={`/admin/channel-partners/${p.id}/organisations/${giving.id}/licences`} onClose={() => setGiving(null)} onDone={(n) => { setMsg({ tone: "success", text: tr("{{n}} demo licences given to {{name}}.", { n, name: giving.name }) }); setGiving(null); load(); onChanged(); }} />}
          </ModalSection>
        )}
        {tab === "orders" && (
          <ModalSection title={tr("Orders from this partner")} icon={Receipt}>
            <OrdersPanel mode="staff" partnerId={p.id} />
          </ModalSection>
        )}
        {tab === "history" && (
          <ModalSection title={tr("History")} icon={History}>
            <ul className="flex flex-col gap-2">
              {d.history.map((h, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-rule pb-2 text-sm">
                  <span>
                    <b>{actionLabel(h.action)}</b>
                    {h.by ? <span className="text-muted"> · {h.by}</span> : null}
                  </span>
                  <span className="text-muted whitespace-nowrap">{new Date(h.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </ModalSection>
        )}
      </div>
    </DetailModal>
  );
}
