import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Globe } from "lucide-react";
import { AuthContext, saveLanguagePreference } from "@/hooks/useAuth";
import { LANGUAGES, changeAppLanguage } from "@/i18n";

export function LanguageSwitcher() {
  const { i18n } = useTranslation();
  // Optional context: this also renders on logged-out pages.
  const auth = useContext(AuthContext);
  const current = i18n.language?.split("-")[0] ?? "en";

  function choose(code: string) {
    changeAppLanguage(code);
    if (auth?.user) saveLanguagePreference(code).catch(() => {});
  }

  return (
    <label className="relative inline-flex items-center gap-1.5 text-xs text-muted">
      <Globe size={14} className="shrink-0" />
      <span className="sr-only">Language</span>
      <select
        value={current}
        onChange={(e) => choose(e.target.value)}
        className="appearance-none bg-transparent pr-1 text-xs font-medium text-ink hover:text-navy focus:outline-none cursor-pointer"
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
