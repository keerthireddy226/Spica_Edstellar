import type { TFunction } from "i18next";
import { BookOpen, Briefcase, ClipboardCheck, Headphones, Layers, Mic, PenLine, type LucideIcon } from "lucide-react";
import type { CatalogueFamily, CatalogueTestType } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// How a catalogue test type is shown: name, one-line description, icon and
// colour. Spica's own tests keep their translated names.
const VERSANT_IDS = new Set(["speakingListening", "fourSkills", "writing", "professional", "placement"]);

const NAMES: Record<string, () => string> = {
  lcListeningReading: () => tr("Listening & Reading (A1-C2)"),
  lcListeningReadingLower: () => tr("Listening & Reading (A1-B1)"),
  lcWriting: () => tr("Writing (A1-C2)"),
  lcSpeaking: () => tr("Speaking (A1-C2)"),
  lcFourSkills: () => tr("4 Skills (A1-C2)"),
};

const ICONS: Record<string, LucideIcon> = {
  speakingListening: Headphones,
  fourSkills: BookOpen,
  writing: PenLine,
  professional: Briefcase,
  placement: ClipboardCheck,
  lcListeningReading: Headphones,
  lcListeningReadingLower: Headphones,
  lcWriting: PenLine,
  lcSpeaking: Mic,
  lcFourSkills: Layers,
};

// Solid, clearly different hues (see index.css); `listening` and `accent`
// are the same green, so only one of them is used.
const COLOURS: Record<string, string> = {
  speakingListening: "bg-speaking",
  fourSkills: "bg-reading",
  writing: "bg-writing",
  professional: "bg-navy",
  placement: "bg-accent",
  lcListeningReading: "bg-navy",
  lcListeningReadingLower: "bg-reading",
  lcWriting: "bg-writing",
  lcSpeaking: "bg-speaking",
  lcFourSkills: "bg-accent",
};

export function testTypeName(tt: Pick<CatalogueTestType, "id" | "name">, t: TFunction): string {
  if (VERSANT_IDS.has(tt.id)) return t(`practiceTests.versantProduct.${tt.id}`);
  return NAMES[tt.id]?.() ?? tt.name;
}

const FORMAT_LABEL: Record<CatalogueTestType["formats"][number]["kind"], () => string> = {
  paper: () => tr("Paper"),
  computer: () => tr("Computer"),
  online: () => tr("Online"),
  face_to_face: () => tr("Face to face"),
};

function minutesText(m: number): string {
  if (m < 60) return tr("{{m}} min", { m });
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? tr("{{h}} h", { h }) : tr("{{h}} h {{m}} min", { h, m: m % 60 });
}

// "2 h", "1 h-1 h 30 min", "10-14 min".
function rangeText(min: number, max: number): string {
  if (min === max) return minutesText(min);
  return max < 60 ? tr("{{from}}-{{to}} min", { from: min, to: max }) : `${minutesText(min)}-${minutesText(max)}`;
}

// The test's length: per delivery format where the catalogue lists them.
export function testTypeTime(tt: CatalogueTestType): string {
  if (!tt.formats?.length) return minutesText(tt.durationMinutes);
  const distinct = new Set(tt.formats.map((f) => `${f.min}-${f.max}`));
  // Same time in every format: just the time.
  if (distinct.size === 1) return rangeText(tt.formats[0].min, tt.formats[0].max);
  return tt.formats.map((f) => `${FORMAT_LABEL[f.kind]()} ${rangeText(f.min, f.max)}`).join(" · ");
}

// Short form for the card's badge: the first format's time.
export function testTypeBadgeTime(tt: CatalogueTestType): string {
  return tt.formats?.length ? rangeText(tt.formats[0].min, tt.formats[0].max) : minutesText(tt.durationMinutes);
}

export function testTypeDescription(tt: CatalogueTestType, t: TFunction): string {
  if (VERSANT_IDS.has(tt.id)) return t(`practiceTests.versantProduct.${tt.id}Desc`);
  return `${tt.skills.map((s) => t(`skills.${s}`)).join(", ")} · ${testTypeTime(tt)}`;
}

export function testTypeIcon(id: string): LucideIcon {
  return ICONS[id] ?? ClipboardCheck;
}

export function testTypeColour(id: string): string {
  return COLOURS[id] ?? "bg-navy";
}

// Spica's own tests (the family keeps its old id 'versant').
export const OWN_FAMILY = "versant";

// Spica's own tests: "Practice tests". Another publisher's exam: "LanguageCert-style
// practice", since Spica prepares people for it and isn't affiliated with them.
export function familyHeading(f: Pick<CatalogueFamily, "id" | "name">, mock = false): string {
  if (f.id === OWN_FAMILY) return mock ? tr("Mock tests") : tr("Practice tests");
  return mock ? tr("{{name}}-style mock tests", { name: f.name }) : tr("{{name}}-style practice", { name: f.name });
}

// Empty for Spica's own tests.
export function familyNote(f: CatalogueFamily): string {
  if (f.id === OWN_FAMILY) return "";
  return tr("Practice in the style of {{name}} tests. Spica isn't affiliated with {{publisher}}; levels and scores are estimates.", {
    name: f.name,
    publisher: f.publisher,
  });
}
