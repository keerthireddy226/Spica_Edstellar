import { pool } from "../db.js";
import SERVER_TEXTS from "./serverTexts.json" with { type: "json" };
import es from "./locales/es.json" with { type: "json" };
import fr from "./locales/fr.json" with { type: "json" };
import de from "./locales/de.json" with { type: "json" };
import it from "./locales/it.json" with { type: "json" };
import nl from "./locales/nl.json" with { type: "json" };
import pl from "./locales/pl.json" with { type: "json" };
import da from "./locales/da.json" with { type: "json" };
import nb from "./locales/nb.json" with { type: "json" };
import sv from "./locales/sv.json" with { type: "json" };
import fi from "./locales/fi.json" with { type: "json" };
import hi from "./locales/hi.json" with { type: "json" };
import te from "./locales/te.json" with { type: "json" };
import ja from "./locales/ja.json" with { type: "json" };
import zh from "./locales/zh.json" with { type: "json" };
import vi from "./locales/vi.json" with { type: "json" };

// Emails and other server sentences are written in English with names and
// numbers filled in. To send them in someone's language, this finds which
// known pattern a sentence came from, translates the pattern, and puts the
// names and numbers back in. The translations are the server-sentence part
// of the app's screen translations (frontend/src/locales/<code>/ui.json),
// copied here by scripts/sync-server-translations.mjs.
const DICTS: Record<string, Record<string, string>> = { es, fr, de, it, nl, pl, da, nb, sv, fi, hi, te, ja, zh, vi };

type Pattern = { key: string; re: RegExp; names: string[]; breaks: number };

// Sentence ends and line breaks in a text.
function breaks(s: string): number {
  return (s.match(/[.!?…]\s+(?=\S)/g)?.length ?? 0) + (s.match(/\n/g)?.length ?? 0);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const PATTERNS: Pattern[] = (SERVER_TEXTS as string[])
  .filter((k) => /\{\{\w+\}\}/.test(k))
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
  .sort((a, b) => b.fixed - a.fixed);

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, n) => vars[n] ?? "");
}

export function translateServerText(lang: string | null | undefined, text: string, depth = 0): string {
  const dict = lang ? DICTS[lang] : undefined;
  if (!dict || !text) return text;
  if (dict[text]) return dict[text];
  if (depth > 2) return text;
  const textBreaks = breaks(text);
  for (const p of PATTERNS) {
    // A pattern can't swallow more sentences than it has itself.
    if (textBreaks > p.breaks) continue;
    const m = text.match(p.re);
    if (!m) continue;
    const vars: Record<string, string> = {};
    p.names.forEach((n, i) => {
      vars[n] = translateServerText(lang, m[i + 1], depth + 1);
    });
    return fill(dict[p.key] ?? p.key, vars);
  }
  return depth === 0 ? bySentence(text, (part) => translateServerText(lang, part, 1)) : text;
}

// Text built from several sentences or lines ("3 learners practised. 1 needs
// attention."): each line, then each sentence, is translated on its own.
export function bySentence(text: string, translate: (part: string) => string): string {
  const lines = text.split(/(\n+)/);
  if (lines.length > 1) return lines.map((x, i) => (i % 2 ? x : x && translate(x) === x ? bySentence(x, translate) : translate(x))).join("");
  const parts = text.split(/(?<=[.!?…])(\s+)(?=\S)/);
  if (parts.length < 2) return text;
  return parts.map((x, i) => (i % 2 ? x : translate(x))).join("");
}

// The language to write to this email address in: the person's own choice,
// else their organization's default, else English.
export async function languageForEmail(email: string): Promise<string> {
  const r = await pool.query(
    `SELECT coalesce(u.preferred_language, t.default_language, 'en') AS lang
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE lower(u.email) = lower($1) LIMIT 1`,
    [email],
  );
  return r.rows[0]?.lang ?? "en";
}
