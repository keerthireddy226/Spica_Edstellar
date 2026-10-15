import i18n from "@/i18n";
import { tr } from "@/i18n/tr";
import SERVER_TEXTS from "@/i18n/serverTexts.json";

// The server writes some sentences in English with names and numbers filled
// in ("Org Two is at risk", "3 invoices overdue"), and stores notifications
// that way. This finds which known pattern a sentence came from, translates
// the pattern, and puts the names and numbers back in. Text that matches no
// pattern is shown as it is.
type Pattern = { key: string; re: RegExp; names: string[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS: Pattern[] = (SERVER_TEXTS as string[])
  .map((key) => {
    const names: string[] = [];
    const body = key
      .split(/(\{\{\w+\}\})/)
      .map((part) => {
        const m = part.match(/^\{\{(\w+)\}\}$/);
        if (m) {
          names.push(m[1]);
          return "([\\s\\S]*?)";
        }
        return escape(part);
      })
      .join("");
    return { key, re: new RegExp(`^${body}$`), names, fixed: key.replace(/\{\{\w+\}\}/g, "").length };
  })
  // The most specific pattern wins.
  .sort((a, b) => b.fixed - a.fixed)
  .map(({ key, re, names }) => ({ key, re, names }));

function known(text: string): boolean {
  return i18n.exists(text, { ns: "ui", keySeparator: false, nsSeparator: false });
}

export function trServer(text: string | null | undefined, depth = 0): string {
  if (!text) return text ?? "";
  if (i18n.language?.startsWith("en")) return text;
  if (known(text)) return tr(text);
  if (depth > 2) return text;
  for (const p of PATTERNS) {
    if (p.names.length === 0) continue;
    const m = text.match(p.re);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((n, i) => {
      vars[n] = trServer(m[i + 1], depth + 1);
    });
    return tr(p.key, vars);
  }
  return text;
}
