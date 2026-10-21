import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { LANGUAGES } from "@/i18n";
import { getOrgSettings, removeOrgLogo, updateOrgSettings, uploadOrgLogo, type OrgSettings } from "@/api/orgAdmin";
import { refreshBranding } from "@/components/AppShell/useBranding";
import { DataGovernanceSection } from "@/components/DataGovernanceSection";
import { SsoSettingsSection } from "@/components/SsoSettingsSection";
import { PlanLockNote, useHasFeature } from "@/components/plans/usePlan";
import { planErrorMessage } from "@/api/plans";
import { ApiError } from "@/lib/api";
import { getCatalogue } from "@/api/practiceTests";
import { familyHeading, testTypeName } from "@/lib/testTypes";
import { useTranslation } from "react-i18next";

import { tr } from "@/i18n/tr";

const TIME_ZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Asia/Kolkata", "Europe/London", "America/New_York"];
  }
})();

function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-6 grid md:grid-cols-[260px_1fr] gap-5">
      <div>
        <h2 className="font-display font-bold text-base text-ink">{title}</h2>
        <p className="text-sm text-muted mt-1">{description}</p>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}

export function OrgAdminSettings() {
  const hasSecurity = useHasFeature("security_policies");
  const hasMfaEnforcement = useHasFeature("mfa_enforcement");
  const hasIpAllowlist = useHasFeature("ip_allowlist");
  const { t } = useTranslation();
  // Live test types from the exam catalogue, as [id, "Family-style practice: name"].
  const [products, setProducts] = useState<[string, string][]>([]);
  useEffect(() => {
    getCatalogue()
      .then((r) =>
        setProducts(
          r.families.flatMap((f) =>
            f.testTypes.filter((tt) => tt.status === "live").map((tt): [string, string] => [tt.id, `${familyHeading(f)}: ${testTypeName(tt, t)}`]),
          ),
        ),
      )
      .catch(() => {});
  }, [t]);
  const [settings, setSettings] = useState<OrgSettings | null>(null);
  const [draft, setDraft] = useState<OrgSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getOrgSettings()
      .then((s) => {
        setSettings(s);
        setDraft(s);
      })
      .catch(() => setMessage({ ok: false, text: tr("Could not load settings.") }));
  }, []);

  if (!draft || !settings) return <p className="text-sm text-muted">{message?.text ?? tr("Loading…")}</p>;

  const dirty = JSON.stringify({ ...draft, logoUrl: null }) !== JSON.stringify({ ...settings, logoUrl: null });
  const set = <K extends keyof OrgSettings>(k: K, v: OrgSettings[K]) => setDraft({ ...draft, [k]: v });
  const inputClass = "rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";

  async function save() {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const { logoUrl: _logo, ...body } = draft;
      const next = await updateOrgSettings(body);
      setSettings(next);
      setDraft(next);
      refreshBranding();
      setMessage({ ok: true, text: tr("Settings saved.") });
    } catch (err) {
      const body = err instanceof ApiError ? (err.body as { error?: string; yourIp?: string }) : null;
      const text =
        planErrorMessage(err) ??
        (body?.error === "allowlist_excludes_you"
          ? tr("That allowlist doesn't include your own address ({{yourIp}}), so saving it would lock you out. Add it first.", { yourIp: body.yourIp })
          : body?.error === "invalid_ip_allowlist"
            ? tr("One of the allowlist entries isn't an IP address or range (for example 203.0.113.5 or 203.0.113.0/24).")
            : body?.error === "enable_your_mfa_first"
              ? tr("Turn on two-step sign-in for your own account (Profile) before requiring it for everyone.")
              : tr("Couldn't save. Check the values and try again."));
      setMessage({ ok: false, text });
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ ok: false, text: tr("That image is over 2 MB.") });
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    try {
      const next = await uploadOrgLogo(dataUrl);
      setSettings({ ...settings!, logoUrl: next.logoUrl });
      setDraft({ ...draft!, logoUrl: next.logoUrl });
      refreshBranding();
    } catch {
      setMessage({ ok: false, text: tr("That file isn't an image we can use. Try a PNG or JPG.") });
    }
  }

  const allProducts = draft.allowedTestProducts === null;

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">{tr("Settings")}</h1>
          <p className="text-sm text-muted mt-1">{tr("How Spica looks and behaves for everyone in your organization.")}</p>
        </div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? tr("Saving…") : tr("Save changes")}
        </Button>
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>}

      <Section title={tr("Branding")} description={tr("Your logo and colour appear in the app header for your Managers and learners.")}>
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl border border-rule bg-paper flex items-center justify-center overflow-hidden">
            {draft.logoUrl ? <img src={draft.logoUrl} alt={tr("Organization logo")} className="max-h-full max-w-full object-contain" /> : <ImagePlus size={22} className="text-muted" />}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => fileRef.current?.click()} className="!px-3.5 !py-2">
              {draft.logoUrl ? tr("Replace logo") : tr("Upload logo")}
            </Button>
            {draft.logoUrl && (
              <Button
                variant="secondary"
                onClick={() =>
                  removeOrgLogo().then((n) => {
                    setSettings({ ...settings, logoUrl: n.logoUrl });
                    setDraft({ ...draft, logoUrl: null });
                    refreshBranding();
                  })
                }
                className="!px-3 !py-2"
              >
                <Trash2 size={15} />
              </Button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogo} className="hidden" />
        </div>
        <p className="text-xs text-muted">{tr("PNG, JPG or WebP up to 2 MB. Shown at up to 256 × 256.")}</p>
        <div className="flex items-center gap-3">
          <label className="text-sm text-ink w-28">{tr("Brand colour")}</label>
          <input type="color" value={draft.brandColor ?? "#1f3a5f"} onChange={(e) => set("brandColor", e.target.value)} className="h-9 w-14 rounded border border-rule cursor-pointer" />
          <span className="text-xs text-muted font-mono">{draft.brandColor ?? "default"}</span>
          {draft.brandColor && (
            <button onClick={() => set("brandColor", null)} className="text-xs text-navy font-semibold hover:underline cursor-pointer">
              {tr("Use default")}</button>
          )}
        </div>
      </Section>

      <Section title={tr("Language and time zone")} description={tr("New learners start in this language (they can change it). Batch end dates and reports use this time zone.")}>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Default language for new learners")}</label>
            <select value={draft.defaultLanguage ?? ""} onChange={(e) => set("defaultLanguage", e.target.value || null)} className={`${inputClass} cursor-pointer`}>
              <option value="">{tr("Their browser's language")}</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Time zone")}</label>
            <select value={draft.timezone} onChange={(e) => set("timezone", e.target.value)} className={`${inputClass} cursor-pointer`}>
              {(TIME_ZONES.includes(draft.timezone) ? TIME_ZONES : [draft.timezone, ...TIME_ZONES]).map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Section>

      <Section title={tr("Daily practice reminder")} description={tr("Turn on a daily reminder email for every learner you add from now on. Learners can change or switch it off.")}>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.reminderDefaultEnabled} onChange={(e) => set("reminderDefaultEnabled", e.target.checked)} className="h-4 w-4 accent-navy" />
          {tr("Turn on for new learners")}</label>
        {draft.reminderDefaultEnabled && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-ink">{tr("At")}</label>
            <input type="time" value={draft.reminderDefaultTime} onChange={(e) => set("reminderDefaultTime", e.target.value)} className={inputClass} />
            <span className="text-xs text-muted">{draft.timezone}</span>
          </div>
        )}
      </Section>

      <Section
        title={tr("Practice Modules for learners")}
        description={tr("Practice Modules let learners practise one skill at a time. Turn them off when your learners should only take practice tests and mock tests.")}
      >
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.modulesEnabled} onChange={(e) => set("modulesEnabled", e.target.checked)} className="h-4 w-4 accent-navy" />
          {tr("Learners can use Practice Modules")}
        </label>
        {!draft.modulesEnabled && <p className="text-xs text-muted">{tr("Practice Modules are hidden from learners; their Overview and Roadmap point to Practice Tests instead.")}</p>}
      </Section>

      <Section
        title={tr("Batch reports")}
        description={tr("Managers see each learner's levels and scores in the Batch report. You choose whether they can also open each learner's full score report.")}
      >
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.managersSeeReports} onChange={(e) => set("managersSeeReports", e.target.checked)} className="h-4 w-4 accent-navy" />
          {tr("Managers can open learners' full score reports")}
        </label>
      </Section>

{/* Course certificates stopped: certificates come only from the final assessment. */}

      <Section
        title={tr("Identity checks")}
        description={tr("Face verification confirms the right person is practising and taking tests. Turn it off only if your organization verifies identity another way.")}
      >
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.faceCheckRequired} onChange={(e) => set("faceCheckRequired", e.target.checked)} className="h-4 w-4 accent-navy" />
          {tr("Require face verification for learners")}</label>
        {!draft.faceCheckRequired && <p className="text-xs text-warning">{tr("Learners won't be asked to verify their face before tests or practice.")}</p>}
      </Section>

      <Section
        title={tr("Security")}
        description={tr("Sign-in rules for your organization. Two-step sign-in and the IP allowlist apply to Org Admins and Managers; the password rule applies to everyone.")}
      >
        <PlanLockNote feature="security_policies" compact />
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Minimum password length")}</label>
            <select
              value={draft.passwordMinLength}
              onChange={(e) => set("passwordMinLength", Number(e.target.value))}
              disabled={hasSecurity === false}
              className={`${inputClass} cursor-pointer`}
            >
              {[8, 10, 12, 14, 16, 20].map((n) => (
                <option key={n} value={n}>
                  {tr("{{n}} characters", { n: n })}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Sign out after inactivity")}</label>
            <select
              value={draft.sessionIdleMinutes ?? ""}
              onChange={(e) => set("sessionIdleMinutes", e.target.value ? Number(e.target.value) : null)}
              disabled={hasSecurity === false}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">{tr("Never (7-day sessions)")}</option>
              {[
                [15, tr("15 minutes")],
                [30, tr("30 minutes")],
                [60, tr("1 hour")],
                [240, tr("4 hours")],
                [480, tr("8 hours")],
                [1440, tr("1 day")],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">{tr("Invite links work for")}</label>
            <select
              value={draft.inviteExpiryHours}
              onChange={(e) => set("inviteExpiryHours", Number(e.target.value))}
              disabled={hasSecurity === false}
              className={`${inputClass} cursor-pointer`}
            >
              {[
                [24, tr("24 hours")],
                [48, tr("2 days")],
                [72, tr("3 days")],
                [168, tr("7 days")],
                [336, tr("14 days")],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="border-t border-rule pt-4 flex flex-col gap-2">
          <PlanLockNote feature="mfa_enforcement" compact />
          <label className={`flex items-center gap-2 text-sm text-ink ${hasMfaEnforcement === false ? "opacity-60" : "cursor-pointer"}`}>
            <input
              type="checkbox"
              checked={draft.mfaRequired}
              disabled={hasMfaEnforcement === false && !draft.mfaRequired}
              onChange={(e) => set("mfaRequired", e.target.checked)}
              className="h-4 w-4 accent-navy"
            />
            {tr("Require two-step sign-in for Org Admins and Managers")}</label>
          <p className="text-xs text-muted">{tr("Managers without it are asked to set it up the next time they sign in.")}</p>
        </div>
        <div className="border-t border-rule pt-4 flex flex-col gap-2">
          <PlanLockNote feature="ip_allowlist" compact />
          <label className="text-xs text-muted">{tr("IP allowlist (one address or range per line; leave empty for no restriction)")}</label>
          <textarea
            rows={3}
            value={(draft.ipAllowlist ?? []).join("\n")}
            disabled={hasIpAllowlist === false}
            onChange={(e) =>
              set(
                "ipAllowlist",
                e.target.value
                  .split(/[\n,]/)
                  .map((x) => x.trim())
                  .filter(Boolean),
              )
            }
            placeholder={"203.0.113.0/24\n198.51.100.7"}
            className={`${inputClass} font-mono text-xs`}
          />
        </div>
      </Section>

      <Section title={tr("Practice tests")} description={tr("Choose which mock tests your learners can take.")}>
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={allProducts}
            onChange={(e) => set("allowedTestProducts", e.target.checked ? null : products.map(([id]) => id))}
            className="h-4 w-4 accent-navy"
          />
          {tr("All practice tests")}</label>
        {!allProducts && (
          <div className="flex flex-col gap-2 pl-6">
            {products.map(([id, label]) => {
              const on = draft.allowedTestProducts!.includes(id);
              const onlyOne = on && draft.allowedTestProducts!.length === 1;
              return (
                <label key={id} className={`flex items-center gap-2 text-sm text-ink ${onlyOne ? "opacity-70" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={onlyOne}
                    onChange={(e) =>
                      set(
                        "allowedTestProducts",
                        e.target.checked ? [...draft.allowedTestProducts!, id] : draft.allowedTestProducts!.filter((x) => x !== id),
                      )
                    }
                    className="h-4 w-4 accent-navy"
                  />
                  {label}
                </label>
              );
            })}
            <p className="text-xs text-muted">{tr("At least one must stay on.")}</p>
          </div>
        )}
      </Section>

      <SsoSettingsSection />

      <DataGovernanceSection />
    </div>
  );
}
