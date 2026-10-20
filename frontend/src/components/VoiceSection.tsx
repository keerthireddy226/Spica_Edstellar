import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Volume2, Check } from "lucide-react";
import { playClip } from "@/lib/playSpokenAudio";
import { getOnboardingProfile, updateVoicePreference, type PreferredVoice } from "@/api/onboarding";

const VOICES: PreferredVoice[] = ["female", "male"];

// Shared between Profile and the mock test's start screen. hideTitle: Profile renders its own header above this.
export function VoiceSection({ hideTitle }: { hideTitle?: boolean } = {}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<PreferredVoice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<PreferredVoice | null>(null);
  const [saved, setSaved] = useState(false);
  const [previewing, setPreviewing] = useState<PreferredVoice | null>(null);

  useEffect(() => {
    getOnboardingProfile()
      .then((profile) => setSelected(profile?.preferred_voice ?? "female"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSelect(voice: PreferredVoice) {
    if (voice === selected) return;
    setSaving(voice);
    setSaved(false);
    try {
      await updateVoicePreference(voice);
      setSelected(voice);
      setSaved(true);
    } finally {
      setSaving(null);
    }
  }

  async function handlePreview(voice: PreferredVoice) {
    setPreviewing(voice);
    // The same recorded voice the questions use (Google Neural2 F or D).
    await playClip(`/voice-preview/${voice}.mp3`);
    setPreviewing(null);
  }

  if (loading) return <p className="text-sm text-muted">{t("profile.voice.loading")}</p>;

  return (
    <div className="flex flex-col gap-3">
      {!hideTitle && <h3 className="font-mono text-[11px] font-medium tracking-[.24em] uppercase text-muted">{t("profile.voice.title")}</h3>}
      <p className={`text-sm text-muted ${hideTitle ? "" : "-mt-1"}`}>{t("profile.voice.subtitle")}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {VOICES.map((voice) => {
          const isSelected = selected === voice;
          return (
            <button
              key={voice}
              onClick={() => handleSelect(voice)}
              disabled={saving !== null}
              className={`flex items-center gap-3 text-left rounded-card border-2 px-4 py-3.5 transition-all cursor-pointer disabled:cursor-not-allowed ${
                isSelected ? "border-accent bg-accent/10" : "border-rule hover:border-rule-strong"
              }`}
            >
              <span
                className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
                  isSelected ? "bg-accent text-white" : "bg-paper-warm text-muted"
                }`}
              >
                {isSelected ? <Check size={18} strokeWidth={2.4} /> : null}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-ink">{t(`profile.voice.${voice}`)}</span>
              </span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePreview(voice);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.stopPropagation();
                    handlePreview(voice);
                  }
                }}
                aria-label={t("profile.voice.preview")}
                className="h-8 w-8 rounded-full flex items-center justify-center text-muted hover:text-ink hover:bg-paper-warm transition-colors shrink-0"
              >
                <Volume2 size={16} strokeWidth={1.8} className={previewing === voice ? "animate-pulse" : ""} />
              </span>
            </button>
          );
        })}
      </div>
      {saved && <p className="text-xs text-success">{t("profile.voice.saved")}</p>}
    </div>
  );
}
