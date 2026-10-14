import { useEffect, useState } from "react";
import { Copy, CheckCircle2, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ApiError } from "@/lib/api";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { planErrorMessage } from "@/api/plans";
import { ssoApi, type SsoSettings } from "@/api/developers";

const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

function CopyText({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <code className="text-xs bg-paper-warm px-1.5 py-0.5 rounded break-all">{text}</code>
      <button onClick={() => navigator.clipboard?.writeText(text)} className="text-muted hover:text-ink cursor-pointer" title="Copy">
        <Copy size={12} />
      </button>
    </span>
  );
}

const ERRORS: Record<string, string> = {
  verify_a_domain_first: "Verify at least one email domain before turning SSO on.",
  provider_unreachable: "Couldn't reach the identity provider's OpenID configuration at that issuer URL.",
  domain_taken: "That domain is already registered to an organization.",
  txt_record_not_found: "The TXT record wasn't found yet. DNS changes can take a while — try again later.",
  sso_not_configured: "Enter the client secret.",
};

// Single sign-on through the organization's identity provider (OpenID
// Connect), domain verification and SCIM provisioning.
export function SsoSettingsSection() {
  const allowed = useHasFeature("sso");
  const [s, setS] = useState<SsoSettings | null>(null);
  const [form, setForm] = useState({ issuer: "", clientId: "", clientSecret: "", enabled: false, enforce: false, jitProvisioning: false });
  const [domain, setDomain] = useState("");
  const [scimToken, setScimToken] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function apply(x: SsoSettings) {
    setS(x);
    setForm({ issuer: x.issuer, clientId: x.clientId, clientSecret: "", enabled: x.enabled, enforce: x.enforce, jitProvisioning: x.jitProvisioning });
  }
  useEffect(() => {
    ssoApi.get().then(apply).catch(() => {});
  }, []);

  async function run<T>(fn: () => Promise<T>, ok: string, after?: (r: T) => void) {
    setMsg(null);
    try {
      const r = await fn();
      after?.(r);
      setMsg({ ok: true, text: ok });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; message?: string }) : null;
      setMsg({ ok: false, text: planErrorMessage(err) ?? ERRORS[body?.error ?? ""] ?? body?.message ?? "That didn't work." });
    }
  }

  if (!s) return null;
  const locked = allowed === false;

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 grid md:grid-cols-[260px_1fr] gap-5">
      <div>
        <h2 className="font-display font-bold text-base text-ink">Single sign-on</h2>
        <p className="text-sm text-muted mt-1">
          People sign in with your company account (Okta, Microsoft Entra ID, Google Workspace, Auth0, OneLogin — any OpenID Connect provider), and your
          directory can add and remove learners automatically (SCIM).
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <PlanLockNote feature="sso" compact />

        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">1. Verify your email domains</p>
          {s.domains.map((d) => (
            <div key={d.domain} className="border border-rule rounded-input px-3 py-2.5 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-ink font-medium">{d.domain}</span>
                <span className="flex items-center gap-3">
                  {d.verified ? (
                    <span className="flex items-center gap-1 text-xs text-success font-semibold">
                      <CheckCircle2 size={13} /> Verified
                    </span>
                  ) : (
                    <button onClick={() => run(() => ssoApi.verifyDomain(d.domain), "Domain verified.", apply)} className="text-xs font-semibold text-navy hover:underline cursor-pointer">
                      Check now
                    </button>
                  )}
                  <button onClick={() => run(() => ssoApi.removeDomain(d.domain), "Removed.", apply)} className="text-muted hover:text-error cursor-pointer">
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
              {!d.verified && (
                <p className="text-xs text-muted">
                  Add a TXT record named <CopyText text={d.txtName} /> with the value <CopyText text={d.txtValue} />.
                </p>
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="yourcompany.com" disabled={locked} className={`${inputClass} flex-1`} />
            <Button
              variant="secondary"
              disabled={locked || !domain.trim()}
              onClick={() => run(() => ssoApi.addDomain(domain.trim()), "Domain added — now add the TXT record.", (x) => {
                apply(x);
                setDomain("");
              })}
              className="!px-3.5 !py-2"
            >
              Add domain
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">2. Connect your identity provider</p>
          <p className="text-xs text-muted">
            Create an OpenID Connect web app in your provider with this sign-in redirect URL: <CopyText text={s.redirectUri} />
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            <input value={form.issuer} onChange={(e) => setForm({ ...form, issuer: e.target.value })} placeholder="Issuer URL, e.g. https://acme.okta.com" disabled={locked} className={inputClass} />
            <input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} placeholder="Client ID" disabled={locked} className={inputClass} />
            <input
              type="password"
              value={form.clientSecret}
              onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
              placeholder={s.hasClientSecret ? "Client secret (saved — leave blank to keep)" : "Client secret"}
              disabled={locked}
              className={inputClass}
            />
          </div>
          {(
            [
              ["enabled", "Turn on single sign-on"],
              ["jitProvisioning", "Create a learner account the first time someone from a verified domain signs in"],
              ["enforce", "Require it: learners and Managers can't use passwords (you keep yours as a way back in)"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={form[k]}
                disabled={locked || (k === "enforce" && !form.enabled)}
                onChange={(e) => setForm({ ...form, [k]: e.target.checked })}
                className="h-4 w-4 accent-navy"
              />
              {label}
            </label>
          ))}
          <Button
            disabled={locked || !form.issuer || !form.clientId}
            onClick={() =>
              run(
                () =>
                  ssoApi.save({
                    issuer: form.issuer.trim(),
                    clientId: form.clientId.trim(),
                    clientSecret: form.clientSecret.trim() || undefined,
                    enabled: form.enabled,
                    enforce: form.enforce,
                    jitProvisioning: form.jitProvisioning,
                  }),
                "Single sign-on saved. Try it from the sign-in page in a private window before requiring it.",
                apply,
              )
            }
            className="self-start"
          >
            Save
          </Button>
        </div>

        <div className="flex flex-col gap-2 border-t border-rule pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">3. Automatic provisioning (SCIM 2.0)</p>
          <p className="text-xs text-muted">
            In your identity provider, set the SCIM base URL to <CopyText text={s.scim.baseUrl} /> and use this token. Users it assigns become learners;
            unassigning them deactivates them and returns unstarted license months.
          </p>
          {scimToken && (
            <div className="rounded-input bg-success/10 border border-success/25 px-3 py-2 flex flex-col gap-1">
              <p className="text-xs text-ink font-semibold">Copy the token now — it won't be shown again.</p>
              <CopyText text={scimToken} />
            </div>
          )}
          <div className="flex gap-2 items-center">
            <Button
              variant="secondary"
              disabled={locked}
              onClick={() => run(ssoApi.newScimToken, s.scim.enabled ? "New token created; the old one stopped working." : "Token created.", (r) => {
                setScimToken(r.token);
                ssoApi.get().then(apply);
              })}
              className="!px-3.5 !py-2"
            >
              {s.scim.enabled ? "Replace token" : "Create token"}
            </Button>
            {s.scim.enabled && (
              <>
                <span className="text-xs text-muted font-mono">{s.scim.tokenPrefix}…</span>
                <button onClick={() => run(ssoApi.revokeScimToken, "Provisioning turned off.", () => ssoApi.get().then(apply))} className="text-xs font-semibold text-muted hover:text-error cursor-pointer">
                  Turn off
                </button>
              </>
            )}
          </div>
        </div>
        {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-error"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
