import { useEffect, useState } from "react";
import { Copy, KeyRound, Webhook, Trash2, Send, Eye, EyeOff, RefreshCw, BarChart3 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { planErrorMessage, sendEnterpriseInquiry } from "@/api/plans";
import { developersApi, type ApiKeyInfo, type WebhookInfo } from "@/api/developers";

import { tr } from "@/i18n/tr";
const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
const when = (d: string | null) => (d ? new Date(d).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "never");

function ApiKeys() {
  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => developersApi.keys().then((r) => setKeys(r.keys)).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
        <KeyRound size={18} className="text-navy" /> {tr("API keys")}</h2>
      <p className="text-sm text-muted">
        {tr("For your LMS or HR system. Send")}{" "}<code className="text-xs bg-paper-warm px-1.5 py-0.5 rounded">{"Authorization: Bearer spk_…"}</code> {tr("to")}{" "}
        <code className="text-xs bg-paper-warm px-1.5 py-0.5 rounded">{window.location.origin}{"/api/v1"}</code>.{" "}
        <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-navy font-semibold hover:underline">
          {tr("API reference (OpenAPI)")}</a>
      </p>

      {newKey && (
        <div className="rounded-input bg-success/10 border border-success/25 px-4 py-3 flex flex-col gap-2">
          <p className="text-sm text-ink font-semibold">{tr("Copy this key now — it won't be shown again.")}</p>
          <div className="flex gap-2 items-center">
            <code className="text-xs break-all bg-white px-2 py-1.5 rounded border border-rule flex-1">{newKey}</code>
            <button onClick={() => navigator.clipboard?.writeText(newKey)} className="text-navy cursor-pointer" title={tr("Copy")}>
              <Copy size={16} />
            </button>
          </div>
          <button onClick={() => setNewKey(null)} className="self-start text-xs font-semibold text-navy hover:underline cursor-pointer">
            {tr("Done")}</button>
        </div>
      )}

      <div className="flex gap-2 flex-wrap items-center">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={tr("Key name, e.g. Workday sync")} className={`${inputClass} flex-1 min-w-48`} />
        <label className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="h-4 w-4 accent-navy" />
          {tr("Can add and deactivate learners")}</label>
        <Button
          disabled={!name.trim()}
          onClick={async () => {
            setError(null);
            try {
              const r = await developersApi.createKey(name.trim(), write ? ["read", "write"] : ["read"]);
              setNewKey(r.key);
              setName("");
              load();
            } catch (err) {
              setError(planErrorMessage(err) ?? tr("Couldn't create the key."));
            }
          }}
        >
          {tr("Create key")}</Button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}

      {keys.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-rule">
              <th className="py-2">{tr("Name")}</th>
              <th className="py-2">{tr("Key")}</th>
              <th className="py-2">{tr("Access")}</th>
              <th className="py-2">{tr("Last used")}</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className={`border-b border-rule last:border-0 ${k.revokedAt ? "opacity-50" : ""}`}>
                <td className="py-2 text-ink">{k.name}</td>
                <td className="py-2 font-mono text-xs text-muted">{k.prefix}…</td>
                <td className="py-2 text-muted">{k.scopes.includes("write") ? tr("Read and write") : tr("Read only")}</td>
                <td className="py-2 text-muted">{k.revokedAt ? tr("Revoked") : when(k.lastUsedAt)}</td>
                <td className="py-2 text-right">
                  {!k.revokedAt && (
                    <button onClick={() => developersApi.revokeKey(k.id).then(load)} className="text-xs font-semibold text-muted hover:text-error cursor-pointer">
                      {tr("Revoke")}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function WebhookRow({ hook, onChanged }: { hook: WebhookInfo; onChanged: () => void }) {
  const [reveal, setReveal] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-rule rounded-input px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-mono text-ink break-all">{hook.url}</p>
          <p className="text-xs text-muted">{hook.events.join(", ")}</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={hook.enabled} onChange={(e) => developersApi.updateWebhook(hook.id, { enabled: e.target.checked }).then(onChanged)} className="h-4 w-4 accent-navy" />
            {tr("On")}</label>
          <button onClick={() => developersApi.testWebhook(hook.id).then(() => setTimeout(onChanged, 3000))} disabled={!hook.enabled} title={tr("Send a test event")} className="text-navy disabled:opacity-40 cursor-pointer">
            <Send size={15} />
          </button>
          <button onClick={() => developersApi.deleteWebhook(hook.id).then(onChanged)} title={tr("Delete")} className="text-muted hover:text-error cursor-pointer">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {hook.disabledReason && <p className="text-xs text-error">{tr("Turned off: {{disabledReason}}.", { disabledReason: hook.disabledReason })}</p>}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted">{tr("Signing secret")}</span>
        <code className="bg-paper-warm px-1.5 py-0.5 rounded font-mono">{reveal ? hook.secret : "whsec_••••••••"}</code>
        <button onClick={() => setReveal((r) => !r)} className="text-muted cursor-pointer">
          {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <button onClick={() => navigator.clipboard?.writeText(hook.secret)} className="text-muted cursor-pointer" title={tr("Copy")}>
          <Copy size={13} />
        </button>
        <button onClick={() => setOpen((o) => !o)} className="ml-auto text-navy font-semibold hover:underline cursor-pointer">
          {open ? tr("Hide") : tr("Recent deliveries")}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1 text-xs">
          {hook.recentDeliveries.length === 0 && <p className="text-muted">{tr("None yet.")}</p>}
          {hook.recentDeliveries.map((d) => (
            <div key={d.id} className="flex justify-between gap-3">
              <span className="text-ink">
                {d.event} · {when(d.created_at)}
              </span>
              <span className={d.status === "delivered" ? "text-success" : d.status === "failed" ? "text-error" : "text-muted"}>
                {d.status}
                {d.response_code ? ` (${d.response_code})` : ""}
                {d.last_error && d.status !== "delivered" ? ` · ${d.last_error}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Webhooks() {
  const [data, setData] = useState<{ events: string[]; webhooks: WebhookInfo[] } | null>(null);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => developersApi.webhooks().then(setData).catch(() => {});
  useEffect(() => {
    load();
  }, []);
  if (!data) return null;

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 flex flex-col gap-4">
      <h2 className="font-display font-bold text-lg text-ink flex items-center gap-2">
        <Webhook size={18} className="text-navy" /> {tr("Webhooks")}</h2>
      <p className="text-sm text-muted">
        {tr("Spica sends a signed POST to your URL when these things happen. Check")}{" "}<code className="text-xs bg-paper-warm px-1 rounded">{"X-Spica-Signature"}</code>{tr(": it's")}{" "}
        <code className="text-xs bg-paper-warm px-1 rounded">{"t=<time>,v1=HMAC-SHA256(secret, \"<time>.<body>\")"}</code>{tr(". Failed deliveries retry six times; a webhook that fails 20 times in a row is turned off.")}</p>
      <div className="flex flex-col gap-2">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={tr("https://hr.example.com/spica-webhook")} className={inputClass} />
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {data.events.map((ev) => (
            <label key={ev} className="flex items-center gap-1.5 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={events.includes(ev)}
                onChange={(e) => setEvents((p) => (e.target.checked ? [...p, ev] : p.filter((x) => x !== ev)))}
                className="h-4 w-4 accent-navy"
              />
              <span className="font-mono text-xs">{ev}</span>
            </label>
          ))}
        </div>
        <Button
          disabled={!url.trim() || events.length === 0}
          onClick={async () => {
            setError(null);
            try {
              await developersApi.createWebhook(url.trim(), events);
              setUrl("");
              setEvents([]);
              load();
            } catch (err) {
              setError(planErrorMessage(err) ?? (err instanceof ApiError ? ((err.body as { message?: string })?.message ?? tr("Couldn't add it.")) : tr("Couldn't add it.")));
            }
          }}
          className="self-start"
        >
          {tr("Add webhook")}</Button>
        {error && <p className="text-sm text-error">{error}</p>}
      </div>
      {data.webhooks.map((h) => (
        <WebhookRow key={h.id} hook={h} onChanged={load} />
      ))}
    </div>
  );
}

const USES: { icon: LucideIcon; title: string; text: string; example: string }[] = [
  {
    icon: RefreshCw,
    title: tr("Add learners automatically"),
    text: tr("Your HR system or LMS creates, moves and deactivates learners through the API, so nobody uploads CSVs by hand."),
    example: tr("A new hire joins in Workday → they get a Spica invite and a license the same day."),
  },
  {
    icon: BarChart3,
    title: tr("Pull progress into your own reports"),
    text: tr("Read each learner's level, sessions, license and certificates, and batch results, to show them in your BI or LMS."),
    example: tr("A Power BI dashboard shows English levels by department next to other training."),
  },
  {
    icon: Webhook,
    title: tr("Get told the moment something happens"),
    text: tr("Webhooks send a signed message to your system when a learner is added, a license is assigned, a batch completes or a certificate is issued."),
    example: tr("A certificate is issued → it's stored on the employee's record automatically."),
  },
];

// Integrations: API keys and webhooks that connect Spica to an
// organization's own systems. Usually set up by their IT team.
export function OrgAdminDevelopers() {
  const allowed = useHasFeature("api_access");
  const [asked, setAsked] = useState(false);
  return (
    <div className="flex flex-col gap-5 w-full">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">{tr("Integrations")}</h1>
        <p className="text-sm text-muted mt-1 max-w-3xl">
          {tr("Connect Spica to your HR system, LMS or reporting tools so learners, licenses and results stay in sync without manual work. This is usually set up once by your IT team.")}</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {USES.map((u) => (
          <div key={u.title} className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-2">
            <span className="h-10 w-10 rounded-2xl bg-navy/10 text-navy flex items-center justify-center">
              <u.icon size={20} strokeWidth={1.8} />
            </span>
            <p className="font-display font-bold text-ink">{u.title}</p>
            <p className="text-sm text-muted">{u.text}</p>
            <p className="text-xs text-ink bg-paper-warm rounded-input px-3 py-2 mt-auto">{u.example}</p>
          </div>
        ))}
      </div>

      {allowed === false ? (
        <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-3">
          <PlanLockNote feature="api_access" />
          <p className="text-sm text-muted">
            {tr("Not sure you need it? If you add learners a few times a month, CSV upload and single sign-on are usually enough. Integrations help when learners change every week or results must appear in other systems.")}</p>
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              disabled={asked}
              onClick={() =>
                sendEnterpriseInquiry(tr("Interested in integrations (API and webhooks)."))
                  .then(() => setAsked(true))
                  .catch(() => {})
              }
            >
              {asked ? tr("We'll be in touch") : tr("Talk to us about Enterprise")}
            </Button>
            <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer" className="text-sm font-semibold text-navy hover:underline">
              {tr("Show the API reference to your IT team")}</a>
          </div>
        </div>
      ) : (
        <>
          <ApiKeys />
          <Webhooks />
        </>
      )}
    </div>
  );
}
