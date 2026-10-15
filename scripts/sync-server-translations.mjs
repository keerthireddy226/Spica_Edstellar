// Copies the server-sentence part of the screen translations
// (frontend/src/locales/<code>/ui.json) into backend/src/i18n/locales/<code>.json,
// so emails and other server text use the same wording as the app.
// Run after editing translations: node scripts/sync-server-translations.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const server = JSON.parse(readFileSync(`${root}frontend/src/i18n/serverTexts.json`, "utf8"));
writeFileSync(`${root}backend/src/i18n/serverTexts.json`, JSON.stringify(server, null, 1) + "\n");
for (const lang of readdirSync(`${root}frontend/src/locales`)) {
  const file = `${root}frontend/src/locales/${lang}/ui.json`;
  if (lang === "en" || !existsSync(file)) continue;
  const ui = JSON.parse(readFileSync(file, "utf8"));
  const out = Object.fromEntries(server.filter((k) => ui[k]).map((k) => [k, ui[k]]));
  writeFileSync(`${root}backend/src/i18n/locales/${lang}.json`, JSON.stringify(out, null, 1) + "\n");
  console.log(`${lang}: ${Object.keys(out).length} server sentences`);
}
