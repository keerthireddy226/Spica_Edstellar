import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, Briefcase, Fingerprint, Globe2, Monitor, ShieldOff, UserCheck, Video } from "lucide-react";
import { Button } from "@/components/Button";
import { getProctoringPreset, type ProctoringMode, type ProctoringPolicy, type ProctoringRegion } from "@/api/proctoring";
import { planErrorMessage } from "@/api/plans";
import { tr } from "@/i18n/tr";

const MODES: { key: ProctoringMode; icon: typeof ShieldOff; title: () => string; text: () => string }[] = [
  { key: "off", icon: ShieldOff, title: () => tr("Off"), text: () => tr("No proctoring. Tests run like practice.") },
  { key: "standard", icon: UserCheck, title: () => tr("Standard"), text: () => tr("For measuring your employees' skills: browser lockdown, randomized questions, optional camera checks.") },
  { key: "strict", icon: Briefcase, title: () => tr("Strict"), text: () => tr("For recruitment: ID check, room scan, camera, face and voice matching, live monitoring.") },
];

const REGIONS: [ProctoringRegion, () => string][] = [
  ["global", () => tr("Global")],
  ["eu", () => tr("EU / UK (GDPR)")],
  ["us", () => tr("United States")],
  ["india", () => tr("India (DPDP)")],
];

type Flag = Exclude<keyof ProctoringPolicy, "mode" | "region" | "sebConfigKeys" | "retentionDays">;

const GROUPS: { title: () => string; icon: typeof Monitor; flags: { key: Flag; label: () => string; hint: () => string; biometric?: boolean }[] }[] = [
  {
    title: () => tr("Browser and device"),
    icon: Monitor,
    flags: [
      { key: "lockdown", label: () => tr("Lock down the test page"), hint: () => tr("Turns off copy, paste and right-click; records leaving the tab and screenshot keys. A web page can't block screenshots: on Mac and Linux the browser doesn't even see the key. Use Safe Exam Browser where that matters.") },
      { key: "requireFullscreen", label: () => tr("Require full screen"), hint: () => tr("Leaving full screen is recorded and the learner is asked to return.") },
      { key: "multiMonitorCheck", label: () => tr("Detect a second screen"), hint: () => tr("Works in Chrome and Edge; other browsers can't report it.") },
      { key: "secureBrowser", label: () => tr("Require Safe Exam Browser"), hint: () => tr("Blocks other apps and screenshots at the system level. Learners install it first.") },
      { key: "randomizedForms", label: () => tr("Randomize questions"), hint: () => tr("Each learner gets a different mix of questions from all sets of the test.") },
    ],
  },
  {
    title: () => tr("Camera and identity"),
    icon: UserCheck,
    flags: [
      { key: "webcamMonitoring", label: () => tr("Camera snapshots"), hint: () => tr("Checks the learner is present and alone, with no phone in view. Not biometric.") },
      { key: "roomScan", label: () => tr("Room scan"), hint: () => tr("A 12-second video of the room before the test.") },
      { key: "liveMonitoring", label: () => tr("Live monitoring"), hint: () => tr("Your reviewers see active tests, can message a learner or end a test.") },
      { key: "idVerification", label: () => tr("ID document check"), hint: () => tr("A photo of a government ID and a selfie, checked by your reviewers."), biometric: true },
      { key: "faceMatch", label: () => tr("Face matching"), hint: () => tr("Snapshots compared with the learner's enrolled face."), biometric: true },
    ],
  },
  {
    title: () => tr("Recording"),
    icon: Video,
    flags: [
      { key: "videoRecording", label: () => tr("Record the camera"), hint: () => tr("The whole test on video, in 30-second parts your reviewers can play back.") },
      { key: "screenRecording", label: () => tr("Record the screen"), hint: () => tr("The learner shares their entire screen, recorded for review. Computers only.") },
      {
        key: "audioMonitoring",
        label: () => tr("Listen for talking"),
        hint: () =>
          tr("The microphone stays on between answers; talking or whispering is flagged with a short clip. Spoken answers are checked for loud background noise."),
      },
    ],
  },
  {
    title: () => tr("Voice and typing"),
    icon: Fingerprint,
    flags: [
      {
        key: "voiceMatch",
        label: () => tr("Voice matching"),
        hint: () => tr("Spoken answers compared with each other and a voice sample, after the test. Flags a different speaker for review."),
        biometric: true,
      },
      {
        key: "typingPattern",
        label: () => tr("Typing rhythm"),
        hint: () => tr("Typing timing compared across answers and with earlier tests. Only timing is kept, never the text. A weak signal."),
        biometric: true,
      },
    ],
  },
];

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 mt-0.5 accent-navy shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </label>
  );
}

// The proctoring policy editor, for an Org Admin (their organization) or
// Edstellar staff (an organization they look after).
export function ProctoringSettings({ load, save }: { load: () => Promise<{ policy: ProctoringPolicy }>; save: (p: ProctoringPolicy) => Promise<{ policy: ProctoringPolicy }> }) {
  const [saved, setSaved] = useState<ProctoringPolicy | null>(null);
  const [draft, setDraft] = useState<ProctoringPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [sebText, setSebText] = useState("");

  useEffect(() => {
    load()
      .then((r) => {
        setSaved(r.policy);
        setDraft(r.policy);
        setSebText(r.policy.sebConfigKeys.join("\n"));
      })
      .catch(() => setNote({ ok: false, text: tr("Could not load the proctoring settings.") }));
  }, [load]);

  if (!draft || !saved) return note ? <p className="text-sm text-error">{note.text}</p> : null;

  const applyPreset = async (mode: ProctoringMode, region: ProctoringRegion) => {
    const r = await getProctoringPreset(mode, region).catch(() => null);
    if (r) {
      setDraft({ ...r.policy, sebConfigKeys: draft.sebConfigKeys });
      setNote(null);
    }
  };
  const set = (key: Flag, value: boolean) => setDraft({ ...draft, [key]: value });
  const biometricOn = draft.faceMatch || draft.voiceMatch || draft.idVerification || draft.typingPattern;
  const keys = sebText
    .split(/\s+/)
    .map((k) => k.trim())
    .filter(Boolean);
  const keysValid = keys.every((k) => /^[0-9a-fA-F]{64}$/.test(k));
  const dirty = JSON.stringify({ ...draft, sebConfigKeys: keys }) !== JSON.stringify(saved);

  async function submit() {
    setBusy(true);
    setNote(null);
    try {
      const r = await save({ ...draft!, sebConfigKeys: keys });
      setSaved(r.policy);
      setDraft(r.policy);
      setNote({ ok: true, text: tr("Proctoring settings saved. They apply to tests started from now on.") });
    } catch (err) {
      setNote({ ok: false, text: planErrorMessage(err) ?? tr("Could not save. Check the settings and try again.") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => applyPreset(m.key, draft.region)}
            className={`text-left rounded-card border p-4 flex flex-col gap-1.5 transition-colors cursor-pointer ${
              draft.mode === m.key ? "border-navy bg-navy/10" : "border-rule bg-surface hover:border-navy/40"
            }`}
          >
            <span className="flex items-center gap-2 font-semibold text-ink">
              <m.icon size={18} className="text-navy-deep" /> {m.title()}
            </span>
            <span className="text-xs text-muted leading-relaxed">{m.text()}</span>
          </button>
        ))}
      </div>

      <label className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm text-ink">
        <span className="flex items-center gap-2 font-semibold">
          <Globe2 size={16} className="text-navy-deep" /> {tr("Privacy rules")}
        </span>
        <select
          value={draft.region}
          onChange={(e) => applyPreset(draft.mode, e.target.value as ProctoringRegion)}
          className="rounded-input border border-rule bg-surface px-3 py-2 text-sm sm:w-64"
        >
          {REGIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l()}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{tr("Choosing a mode or region resets the options below to its defaults.")}</span>
      </label>

      {draft.mode !== "off" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {GROUPS.map((g) => (
            <div key={g.title()} className="bg-surface border border-rule rounded-card p-4">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink mb-1">
                <g.icon size={16} className="text-navy-deep" /> {g.title()}
              </p>
              {g.flags.map((f) => (
                <Toggle key={f.key} checked={draft[f.key]} onChange={(v) => set(f.key, v)}>
                  <span className="text-sm text-ink font-medium">
                    {f.label()}
                    {f.biometric && <span className="ml-1.5 text-[10px] uppercase tracking-wide font-bold text-navy-deep bg-navy/10 rounded-pill px-1.5 py-0.5">{tr("Biometric")}</span>}
                  </span>
                  <span className="block text-xs text-muted">{f.hint()}</span>
                </Toggle>
              ))}
              {g.flags.some((f) => f.key === "secureBrowser") && draft.secureBrowser && (
                <label className="flex flex-col gap-1 text-xs text-muted mt-2">
                  {tr("Safe Exam Browser config keys (one per line)")}
                  <textarea
                    value={sebText}
                    onChange={(e) => setSebText(e.target.value)}
                    rows={3}
                    className="rounded-input border border-rule bg-surface px-2 py-1.5 font-mono text-[11px] text-ink"
                  />
                  {!keysValid && <span className="text-error">{tr("Each key is 64 hexadecimal characters.")}</span>}
                  {keysValid && keys.length === 0 && <span className="text-error">{tr("Add at least one key, or learners can't start.")}</span>}
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      {draft.mode !== "off" && (
        <label className="flex items-center gap-3 text-sm text-ink">
          {tr("Keep snapshots, recordings and ID images for")}
          <input
            type="number"
            min={1}
            max={365}
            value={draft.retentionDays}
            onChange={(e) => setDraft({ ...draft, retentionDays: Math.max(1, Math.min(365, Number(e.target.value) || 1)) })}
            className="w-20 rounded-input border border-rule bg-surface px-2 py-1.5 text-sm"
          />
          {tr("days")}
        </label>
      )}

      {biometricOn && draft.mode !== "off" && (
        <div className="flex items-start gap-2 bg-warning/15 border border-warning/40 rounded-card p-3 text-xs text-ink leading-relaxed">
          <AlertTriangle size={16} className="text-navy-deep shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <p>{tr("Biometric checks need each learner's consent. Learners can always choose a manual identity check instead, and nothing fails anyone automatically: your reviewers decide.")}</p>
            {draft.region === "eu" && <p>{tr("Under GDPR, run a data protection impact assessment first and, where you have one, agree this with your works council.")}</p>}
            {draft.region === "us" && <p>{tr("Illinois, Texas, Washington and Colorado regulate biometrics. Spica collects written consent; publish your retention period in your privacy notice.")}</p>}
          </div>
        </div>
      )}

      {note && <p className={`text-sm ${note.ok ? "text-success" : "text-error"}`}>{note.text}</p>}
      <div>
        <Button onClick={submit} disabled={busy || !dirty || !keysValid || (draft.secureBrowser && draft.mode !== "off" && keys.length === 0)}>
          {busy ? tr("Saving...") : tr("Save proctoring settings")}
        </Button>
      </div>
    </div>
  );
}
