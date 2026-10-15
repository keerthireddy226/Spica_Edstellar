import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { AuthContext, saveLanguagePreference } from "@/hooks/useAuth";
import { LANGUAGES, changeAppLanguage } from "@/i18n";

import { tr } from "@/i18n/tr";
// `compact`: on phones only the globe shows; tapping it opens the list.
export function LanguageSwitcher({ compact }: { compact?: boolean } = {}) {
  const { i18n } = useTranslation();
  // Optional context: this also renders on logged-out pages.
  const auth = useContext(AuthContext);
  const current = i18n.language?.split("-")[0] ?? "en";

  // Save first: switching language reloads the page.
  async function choose(code: string) {
    if (auth?.user) await saveLanguagePreference(code).catch(() => {});
    await changeAppLanguage(code);
  }

  return (
    <label className={`relative inline-flex items-center gap-1.5 text-xs text-muted ${compact ? "max-sm:p-1.5" : ""}`}>
      <Globe size={14} className={`shrink-0 ${compact ? "max-sm:h-[22px] max-sm:w-[22px]" : ""}`} />
      <span className="sr-only">{tr("Language")}</span>
      <select
        value={current}
        onChange={(e) => choose(e.target.value)}
        className={`appearance-none bg-transparent pr-1 text-xs font-medium text-ink hover:text-navy focus:outline-none cursor-pointer ${
          compact ? "max-sm:absolute max-sm:inset-0 max-sm:w-full max-sm:opacity-0" : ""
        }`}
      >
        {LANGUAGES.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
