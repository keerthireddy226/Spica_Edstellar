import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { Button } from "@/components/Button";
import { LANGUAGES } from "@/i18n";
import { getOrgSettings, removeOrgLogo, updateOrgSettings, uploadOrgLogo, type OrgSettings } from "@/api/orgAdmin";
import { refreshBranding } from "@/components/AppShell/useBranding";

const PRODUCTS: [string, string][] = [
  ["fourSkills", "Versant 4 Skills Essential"],
  ["placement", "Versant English Placement Test"],
  ["writing", "Versant Writing Test"],
  ["professional", "Versant Professional English"],
  ["speakingListening", "Versant Speaking & Listening"],
];

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
      .catch(() => setMessage({ ok: false, text: "Could not load settings." }));
  }, []);

  if (!draft || !settings) return <p className="text-sm text-muted">{message?.text ?? "Loading…"}</p>;

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
      setMessage({ ok: true, text: "Settings saved." });
    } catch {
      setMessage({ ok: false, text: "Couldn't save. Check the values and try again." });
    } finally {
      setSaving(false);
    }
  }

  async function handleLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ ok: false, text: "That image is over 2 MB." });
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
      setMessage({ ok: false, text: "That file isn't an image we can use. Try a PNG or JPG." });
    }
  }

  const allProducts = draft.allowedTestProducts === null;

  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display font-bold text-2xl text-ink">Settings</h1>
          <p className="text-sm text-muted mt-1">How Spica looks and behaves for everyone in your organization.</p>
        </div>
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-success" : "text-error"}`}>{message.text}</p>}

      <Section title="Branding" description="Your logo and colour appear in the app header for your Managers and learners.">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl border border-rule bg-paper flex items-center justify-center overflow-hidden">
            {draft.logoUrl ? <img src={draft.logoUrl} alt="Organization logo" className="max-h-full max-w-full object-contain" /> : <ImagePlus size={22} className="text-muted" />}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => fileRef.current?.click()} className="!px-3.5 !py-2">
              {draft.logoUrl ? "Replace logo" : "Upload logo"}
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
        <p className="text-xs text-muted">PNG, JPG or WebP up to 2 MB. Shown at up to 256 × 256.</p>
        <div className="flex items-center gap-3">
          <label className="text-sm text-ink w-28">Brand colour</label>
          <input type="color" value={draft.brandColor ?? "#1f3a5f"} onChange={(e) => set("brandColor", e.target.value)} className="h-9 w-14 rounded border border-rule cursor-pointer" />
          <span className="text-xs text-muted font-mono">{draft.brandColor ?? "default"}</span>
          {draft.brandColor && (
            <button onClick={() => set("brandColor", null)} className="text-xs text-navy font-semibold hover:underline cursor-pointer">
              Use default
            </button>
          )}
        </div>
      </Section>

      <Section title="Language and time zone" description="New learners start in this language (they can change it). Batch end dates and reports use this time zone.">
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">Default language for new learners</label>
            <select value={draft.defaultLanguage ?? ""} onChange={(e) => set("defaultLanguage", e.target.value || null)} className={`${inputClass} cursor-pointer`}>
              <option value="">Their browser's language</option>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted">Time zone</label>
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

      <Section title="Daily practice reminder" description="Turn on a daily reminder email for every learner you add from now on. Learners can change or switch it off.">
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.reminderDefaultEnabled} onChange={(e) => set("reminderDefaultEnabled", e.target.checked)} className="h-4 w-4 accent-navy" />
          Turn on for new learners
        </label>
        {draft.reminderDefaultEnabled && (
          <div className="flex items-center gap-3">
            <label className="text-sm text-ink">At</label>
            <input type="time" value={draft.reminderDefaultTime} onChange={(e) => set("reminderDefaultTime", e.target.value)} className={inputClass} />
            <span className="text-xs text-muted">{draft.timezone}</span>
          </div>
        )}
      </Section>

      <Section
        title="Identity checks"
        description="Face verification confirms the right person is practising and taking tests. Turn it off only if your organization verifies identity another way."
      >
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input type="checkbox" checked={draft.faceCheckRequired} onChange={(e) => set("faceCheckRequired", e.target.checked)} className="h-4 w-4 accent-navy" />
          Require face verification for learners
        </label>
        {!draft.faceCheckRequired && <p className="text-xs text-warning">Learners won't be asked to verify their face before tests or practice.</p>}
      </Section>

      <Section title="Practice tests" description="Choose which mock exams your learners can take.">
        <label className="flex items-center gap-2 text-sm text-ink cursor-pointer">
          <input
            type="checkbox"
            checked={allProducts}
            onChange={(e) => set("allowedTestProducts", e.target.checked ? null : PRODUCTS.map(([id]) => id))}
            className="h-4 w-4 accent-navy"
          />
          All practice tests
        </label>
        {!allProducts && (
          <div className="flex flex-col gap-2 pl-6">
            {PRODUCTS.map(([id, label]) => {
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
            <p className="text-xs text-muted">At least one must stay on.</p>
          </div>
        )}
      </Section>
    </div>
  );
}
