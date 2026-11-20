// The locale for dates, times and numbers: the language the user chose in
// Spica (set on <html lang> by i18n), not the browser's own setting. For
// English, keep the browser's English variant (en-IN, en-GB, en-US) so dates
// read the way the user expects.
export function appLocale(): string {
  const lang = (typeof document !== "undefined" && document.documentElement.lang) || "en";
  if (lang === "en" && typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) return navigator.language;
  if (lang === "zh") return "zh-CN";
  return lang;
}
