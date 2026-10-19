import i18n from "@/i18n";
import { tr } from "@/i18n/tr";
import SERVER_TEXTS from "@/i18n/serverTexts.json";

// The server writes some sentences in English with names and numbers filled
// in ("Org Two is at risk", "3 invoices overdue"), and stores notifications
// that way. This finds which known pattern a sentence came from, translates
// the pattern, and puts the names and numbers back in. Text that matches no
// pattern is shown as it is.
type Pattern = { key: string; re: RegExp; names: string[]; breaks: number };

// Sentence ends and line breaks in a text.
function breaks(s: string): number {
  return (s.match(/[.!?…]\s+(?=\S)/g)?.length ?? 0) + (s.match(/\n/g)?.length ?? 0);
}

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
    return { key, re: new RegExp(`^${body}$`), names, fixed: key.replace(/\{\{\w+\}\}/g, "").length, breaks: breaks(key) };
  })
  // The most specific pattern wins.
  .sort((a, b) => b.fixed - a.fixed)
  .map(({ key, re, names, breaks }) => ({ key, re, names, breaks }));

function known(text: string): boolean {
  return i18n.exists(text, { ns: "ui", keySeparator: false, nsSeparator: false });
}

export function trServer(text: string | null | undefined, depth = 0): string {
  if (!text) return text ?? "";
  if (i18n.language?.startsWith("en")) return text;
  if (known(text)) return tr(text);
  if (depth > 2) return text;
  const textBreaks = breaks(text);
  for (const p of PATTERNS) {
    if (p.names.length === 0) continue;
    // A pattern can't swallow more sentences than it has itself.
    if (textBreaks > p.breaks) continue;
    const m = text.match(p.re);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((n, i) => {
      vars[n] = trServer(m[i + 1], depth + 1);
    });
    return tr(p.key, vars);
  }
  return depth === 0 ? bySentence(text, (part) => trServer(part, 1)) : text;
}

// Text built from several sentences or lines ("3 learners practised. 1 needs
// attention."): each line, then each sentence, is translated on its own.
function bySentence(text: string, translate: (part: string) => string): string {
  const lines = text.split(/(\n+)/);
  if (lines.length > 1) return lines.map((x, i) => (i % 2 ? x : x && translate(x) === x ? bySentence(x, translate) : translate(x))).join("");
  const parts = text.split(/(?<=[.!?…])(\s+)(?=\S)/);
  if (parts.length < 2) return text;
  return parts.map((x, i) => (i % 2 ? x : translate(x))).join("");
}
