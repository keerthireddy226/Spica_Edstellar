import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BellRing } from "lucide-react";
import { Button } from "@/components/Button";
import { getReminderPreferences, saveReminderPreferences, type ReminderPreferences } from "@/api/notifications";

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// Learner sets their own daily "time to practise" email. Skipped automatically
// on days they've already practised.
export function DailyReminderCard() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<ReminderPreferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getReminderPreferences()
      .then((p) => setPrefs({ ...p, timezone: p.timezone ?? browserTimezone() }))
      .catch(() => {});
  }, []);

  if (!prefs) return null;

  function patch(fields: Partial<ReminderPreferences>) {
    setPrefs((p) => (p ? { ...p, ...fields } : p));
    setSaved(false);
  }

  function toggleDay(d: number) {
    const days = prefs!.days.includes(d) ? prefs!.days.filter((x) => x !== d) : [...prefs!.days, d].sort();
    if (days.length > 0) patch({ days });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await saveReminderPreferences({
        enabled: prefs!.enabled,
        localTime: prefs!.localTime,
        timezone: prefs!.timezone ?? browserTimezone(),
        days: prefs!.days,
        streakAlert: prefs!.streakAlert,
      });
      setSaved(true);
    } catch {
      setError(t("profile.reminder.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-card p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="h-9 w-9 rounded-2xl bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <BellRing size={18} strokeWidth={1.8} />
          </span>
          <h2 className="font-display font-bold text-ink">{t("profile.reminder.title")}</h2>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-muted">{prefs.enabled ? t("profile.reminder.on") : t("profile.reminder.off")}</span>
          <input type="checkbox" checked={prefs.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="h-4 w-4 accent-navy cursor-pointer" />
        </label>
      </div>
      <p className="text-sm text-muted">{t("profile.reminder.subtitle")}</p>

      <div className={`flex flex-col gap-4 ${prefs.enabled ? "" : "opacity-50 pointer-events-none"}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted">{t("profile.reminder.time")}</label>
          <input
            type="time"
            value={prefs.localTime}
            onChange={(e) => patch({ localTime: e.target.value })}
            className="rounded-input border border-rule bg-paper px-3 py-1.5 text-sm text-ink focus:border-navy focus:outline-none"
          />
          <span className="text-xs text-muted">{prefs.timezone}</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {DAY_KEYS.map((key, i) => (
            <button
              key={key}
              type="button"
              onClick={() => toggleDay(i)}
              className={`h-8 min-w-10 px-2 rounded-pill text-xs font-semibold cursor-pointer transition-colors ${
                prefs.days.includes(i) ? "bg-navy text-white" : "bg-paper-warm text-muted hover:text-ink"
              }`}
            >
              {t(`profile.reminder.days.${key}`)}
            </button>
          ))}
        </div>
        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={prefs.streakAlert} onChange={(e) => patch({ streakAlert: e.target.checked })} className="mt-0.5 accent-navy" />
          <span className="text-sm text-ink">{t("profile.reminder.streakAlert")}</span>
        </label>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="!px-4 !py-2 !text-sm">
          {saving ? t("profile.personalInfo.saving") : t("profile.personalInfo.save")}
        </Button>
        {saved && <span className="text-xs text-success">{prefs.enabled ? t("profile.reminder.savedOn", { time: prefs.localTime }) : t("profile.reminder.savedOff")}</span>}
      </div>
    </div>
  );
}
