import i18n from "@/i18n";

// Screen text in plain English: tr("Onboard Organization"),
// tr("{{n}} learners", { n }). The English text is the key; other languages
// come from locales/<code>/ui.json, and anything missing shows in English.
export function tr(text: string, vars?: Record<string, unknown>): string {
  return i18n.t(text, { ns: "ui", keySeparator: false, nsSeparator: false, defaultValue: text, ...vars }) as string;
}
