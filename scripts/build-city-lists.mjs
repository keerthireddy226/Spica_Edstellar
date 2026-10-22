// Builds the city lists behind the City dropdowns: one small file per country,
// frontend/public/geo/cities/<CC>.json, as [[city, region], ...] largest first.
// Loaded only for the country a person picks.
//
// Source: GeoNames (https://www.geonames.org), CC BY 4.0: every place of
// 15,000 people or more (cities15000) and the region names (admin1CodesASCII).
//
// Usage: node scripts/build-city-lists.mjs <folder with cities15000.txt and admin1CodesASCII.txt>
// (download both from https://download.geonames.org/export/dump/; unzip cities15000.zip)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("usage: node scripts/build-city-lists.mjs <geonames folder>");
  process.exit(1);
}
const out = new URL("../frontend/public/geo/cities/", import.meta.url).pathname;

// "IN.40" -> "Telangana"
const regions = new Map(
  readFileSync(path.join(src, "admin1CodesASCII.txt"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [code, name] = line.split("\t");
      return [code, name];
    }),
);

const byCountry = new Map();
for (const line of readFileSync(path.join(src, "cities15000.txt"), "utf8").split("\n")) {
  if (!line) continue;
  const f = line.split("\t");
  const [name, featureCode, country, admin1, population] = [f[1], f[7], f[8], f[10], Number(f[14])];
  // A part of a bigger city (PPLX, e.g. a district of Delhi) isn't a city of its own.
  if (featureCode === "PPLX" || !country) continue;
  if (!byCountry.has(country)) byCountry.set(country, []);
  byCountry.get(country).push({ name, region: regions.get(`${country}.${admin1}`) ?? "", population });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
let files = 0;
let cities = 0;
for (const [country, list] of byCountry) {
  list.sort((a, b) => b.population - a.population);
  // The same name twice in one region: only the bigger one.
  const seen = new Set();
  const rows = [];
  for (const c of list) {
    const key = `${c.name}|${c.region}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(c.region ? [c.name, c.region] : [c.name]);
  }
  writeFileSync(path.join(out, `${country}.json`), JSON.stringify(rows));
  files++;
  cities += rows.length;
}
console.log(`${files} countries, ${cities} cities -> ${path.relative(process.cwd(), out)}`);
