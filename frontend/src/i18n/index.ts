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
// Screen text written as plain English in the code (wrapped in tr()) is
// translated through a second namespace keyed by the English text itself.
const uiLoaders = import.meta.glob<{ default: Record<string, string> }>("../locales/*/ui.json");

export function isSupportedLanguage(code: string | null | undefined): code is string {
  return !!code && SUPPORTED_LANGUAGE_CODES.includes(code);
}

async function loadLanguage(code: string): Promise<void> {
  if (code === "en" || i18n.hasResourceBundle(code, "translation")) return;
  const load = loaders[`../locales/${code}/translation.json`];
  const loadUi = uiLoaders[`../locales/${code}/ui.json`];
  const [mod, ui] = await Promise.all([load?.(), loadUi?.()]);
  if (mod) i18n.addResourceBundle(code, "translation", mod.default, true, true);
  if (ui) i18n.addResourceBundle(code, "ui", ui.default, true, true);
}

let started = false;

// The one way to switch language: makes sure the bundle is loaded first.
// Once the app is running, the page reloads so every screen (including text
// worked out when a module first loads) comes back in the new language.
export async function changeAppLanguage(code: string): Promise<void> {
  const target = isSupportedLanguage(code) ? code : "en";
  const current = i18n.language?.split("-")[0];
  await loadLanguage(target);
  await i18n.changeLanguage(target);
  if (started && current !== target) window.location.reload();
}

i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

// Resolves once the starting language is loaded; main.tsx waits for it
// before loading the app, so every screen starts in the right language.
export const i18nReady: Promise<void> = i18n
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
  .then(async () => {
    // The detector may pick a language whose bundle isn't loaded yet (or a
    // stale/unsupported one cached from an earlier session) — load it, or
    // fall back to English.
    const detected = i18n.language?.split("-")[0];
    if (detected !== "en") await changeAppLanguage(isSupportedLanguage(detected) ? detected : "en");
    started = true;
  });

export default i18n;
