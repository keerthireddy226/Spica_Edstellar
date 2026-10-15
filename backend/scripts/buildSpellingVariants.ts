// Builds src/placement/spellingVariants.ts: British spellings mapped to their
// American form, so graders can accept either.
//
// Source: the British and American SCOWL word lists (Ubuntu packages wbritish
// and wamerican, /usr/share/dict). A British word is paired with an American
// one when a known spelling pattern turns one into the other (-ise/-ize,
// -our/-or, -re/-er, -ll-/-l-, ae/oe/e, -ogue/-og, -ence/-ense, -mme/-m) and
// the pair is a real variant: one form is missing from the other variety's
// list. Pairs where both forms are separate words in both varieties
// (four/for, holy/holly) are left out; the real variants among them are
// listed by hand below, with forms no pattern covers (grey/gray, learnt/learned).
//
//   npx tsx scripts/buildSpellingVariants.ts
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const UK_LIST = "/usr/share/dict/british-english";
const US_LIST = "/usr/share/dict/american-english";
const OUT = path.join(import.meta.dirname, "..", "src", "placement", "spellingVariants.ts");

// Pattern matches that are different words, not spellings of one word.
const NOT_VARIANTS = new Set(["snowshoed", "mantoes", "patinae"]);

// Real variants the patterns miss, or that the "missing from one list" test
// drops because both lists carry both spellings.
const MANUAL: Record<string, string> = {
  licence: "license",
  licences: "licenses",
  programme: "program",
  programmes: "programs",
  analogue: "analog",
  analogues: "analogs",
  dialogue: "dialog",
  encyclopaedia: "encyclopedia",
  encyclopaedias: "encyclopedias",
  encyclopaedic: "encyclopedic",
  foetus: "fetus",
  foetuses: "fetuses",
  foetal: "fetal",
  caesarean: "cesarean",
  caesareans: "cesareans",
  mediaeval: "medieval",
  primaeval: "primeval",
  instil: "instill",
  instils: "instills",
  instal: "install",
  instals: "installs",
  tranquillity: "tranquility",
  practise: "practice",
  practised: "practiced",
  practises: "practices",
  practising: "practicing",
  grey: "gray",
  greys: "grays",
  greyer: "grayer",
  greyest: "grayest",
  greyish: "grayish",
  greyness: "grayness",
  tyre: "tire",
  tyres: "tires",
  judgement: "judgment",
  judgements: "judgments",
  acknowledgement: "acknowledgment",
  acknowledgements: "acknowledgments",
  ageing: "aging",
  cheque: "check",
  cheques: "checks",
  chequebook: "checkbook",
  plough: "plow",
  ploughs: "plows",
  ploughed: "plowed",
  ploughing: "plowing",
  aluminium: "aluminum",
  mould: "mold",
  moulds: "molds",
  moulded: "molded",
  moulding: "molding",
  mouldy: "moldy",
  smoulder: "smolder",
  smoulders: "smolders",
  smouldered: "smoldered",
  smouldering: "smoldering",
  moult: "molt",
  moulted: "molted",
  moulting: "molting",
  moustache: "mustache",
  moustaches: "mustaches",
  pyjamas: "pajamas",
  sceptic: "skeptic",
  sceptics: "skeptics",
  sceptical: "skeptical",
  sceptically: "skeptically",
  scepticism: "skepticism",
  draught: "draft",
  draughts: "drafts",
  draughty: "drafty",
  jewellery: "jewelry",
  kerb: "curb",
  kerbs: "curbs",
  learnt: "learned",
  spelt: "spelled",
  dreamt: "dreamed",
  leapt: "leaped",
  burnt: "burned",
  spoilt: "spoiled",
  cosy: "cozy",
  cosier: "cozier",
  cosiest: "coziest",
  cosily: "cozily",
  cosiness: "coziness",
  doughnut: "donut",
  doughnuts: "donuts",
  artefact: "artifact",
  artefacts: "artifacts",
  manoeuvre: "maneuver",
  manoeuvres: "maneuvers",
  manoeuvred: "maneuvered",
  manoeuvring: "maneuvering",
  manoeuvrable: "maneuverable",
};

function load(file: string): Set<string> {
  return new Set(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((w) => /^[a-z]+$/.test(w)),
  );
}

// American candidates for one British word.
function* candidates(w: string): Generator<string> {
  const suffixRules: [RegExp, string][] = [
    [/is(e|ed|es|ing|ation|ations|er|ers|able|ational)$/, "iz$1"],
    [/ys(e|ed|es|ing|er|ers)$/, "yz$1"],
    [/([^aeiou])re(s)?$/, "$1er$2"],
    [/([^aeiou])red$/, "$1ered"],
    [/([^aeiou])ring$/, "$1ering"],
    [/ogue(s)?$/, "og$1"],
    [/ence(s)?$/, "ense$1"],
    [/mme(s)?$/, "m$1"],
  ];
  for (const [re, to] of suffixRules) if (re.test(w)) yield w.replace(re, to);
  // -isation inside a longer word (organisational), every -ise- at once.
  if (w.includes("is")) yield w.replace(/is(?=e|ing|ation|er|able)/g, "iz");
  // One edit at one position: colour/color, anaemia/anemia, travelled/traveled.
  for (const [from, to] of [
    ["our", "or"],
    ["ae", "e"],
    ["oe", "e"],
    ["ll", "l"],
  ]) {
    for (let i = w.indexOf(from); i !== -1; i = w.indexOf(from, i + 1)) yield w.slice(0, i) + to + w.slice(i + from.length);
  }
  // British single l where American doubles it: fulfil/fulfill, skilful/skillful.
  for (let i = w.indexOf("l"); i !== -1; i = w.indexOf("l", i + 1)) {
    if (w[i + 1] !== "l" && w[i - 1] !== "l") yield w.slice(0, i) + "ll" + w.slice(i + 1);
  }
}

const uk = load(UK_LIST);
const us = load(US_LIST);
const pairs = new Map<string, string>();
for (const w of [...uk].sort()) {
  if (NOT_VARIANTS.has(w)) continue;
  for (const c of candidates(w)) {
    if (c === w || !us.has(c)) continue;
    // Both spellings are words in both varieties: two different words.
    if (us.has(w) && uk.has(c)) continue;
    pairs.set(w, c);
    break;
  }
}
for (const [b, a] of Object.entries(MANUAL)) pairs.set(b, a);

const sorted = [...pairs].sort(([a], [b]) => a.localeCompare(b));
const body = sorted.map(([b, a]) => `  ${b}: "${a}",`).join("\n");
writeFileSync(
  OUT,
  `// Generated by scripts/buildSpellingVariants.ts; edit that script, not this file.
// British spelling -> American spelling, ${sorted.length} words.
//
// Derived from SCOWL (Spell Checker Oriented Word Lists):
// Copyright 2000-2011 by Kevin Atkinson
// Permission to use, copy, modify, distribute and sell these word lists, the
// associated scripts, the output created from the scripts, and its
// documentation for any purpose is hereby granted without fee, provided that
// the above copyright notice appears in all copies and that both that
// copyright notice and this permission notice appear in supporting
// documentation. Kevin Atkinson makes no representations about the
// suitability of this array for any purpose. It is provided "as is" without
// express or implied warranty.
export const BRITISH_TO_AMERICAN: Record<string, string> = {
${body}
};
`,
);
console.log(`Wrote ${sorted.length} pairs to ${path.relative(process.cwd(), OUT)}`);
