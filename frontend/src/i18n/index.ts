import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "@/locales/en/translation.json";

// Exam item content is never translated; this only ever covers UI chrome.
// English ships in the main bundle; every other language is fetched only
// when someone actually picks it.
export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Nederlands" },
  { code: "pl", label: "Polski" },
  { code: "da", label: "Dansk" },
  { code: "nb", label: "Norsk" },
  { code: "sv", label: "Svenska" },
  { code: "fi", label: "Suomi" },
  { code: "hi", label: "हिन्दी" },
  { code: "te", label: "తెలుగు" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文（简体）" },
  { code: "vi", label: "Tiếng Việt" },
] as const;

export const SUPPORTED_LANGUAGE_CODES: string[] = LANGUAGES.map((l) => l.code);

const loaders = import.meta.glob<{ default: Record<string, unknown> }>("../locales/*/translation.json");

export function isSupportedLanguage(code: string | null | undefined): code is string {
  return !!code && SUPPORTED_LANGUAGE_CODES.includes(code);
}

async function loadLanguage(code: string): Promise<void> {
  if (code === "en" || i18n.hasResourceBundle(code, "translation")) return;
  const load = loaders[`../locales/${code}/translation.json`];
  if (!load) return;
  const mod = await load();
  i18n.addResourceBundle(code, "translation", mod.default, true, true);
}

// The one way to switch language: makes sure the bundle is loaded first.
export async function changeAppLanguage(code: string): Promise<void> {
  const target = isSupportedLanguage(code) ? code : "en";
  await loadLanguage(target);
  await i18n.changeLanguage(target);
}

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    supportedLngs: SUPPORTED_LANGUAGE_CODES,
    // "de-DE" → "de", "zh-CN" → "zh".
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  })
  .then(() => {
    // The detector may pick a language whose bundle isn't loaded yet (or a
    // stale/unsupported one cached from an earlier session) — load it, or
    // fall back to English.
    const detected = i18n.language?.split("-")[0];
    if (detected !== "en") changeAppLanguage(isSupportedLanguage(detected) ? detected : "en");
  });

export default i18n;
