import type { TFunction } from "i18next";
import { BookOpen, Briefcase, ClipboardCheck, Headphones, Layers, Mic, PenLine, type LucideIcon } from "lucide-react";
import type { CatalogueFamily, CatalogueTestType } from "@/api/practiceTests";
import { tr } from "@/i18n/tr";

// How a catalogue test type is shown: name, one-line description, icon and
// colour. Versant products keep their existing translated names.
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

export function testTypeDescription(tt: CatalogueTestType, t: TFunction): string {
  if (VERSANT_IDS.has(tt.id)) return t(`practiceTests.versantProduct.${tt.id}Desc`);
  return tr("{{skills}} · {{m}} min", { skills: tt.skills.map((s) => t(`skills.${s}`)).join(", "), m: tt.durationMinutes });
}

export function testTypeIcon(id: string): LucideIcon {
  return ICONS[id] ?? ClipboardCheck;
}

export function testTypeColour(id: string): string {
  return COLOURS[id] ?? "bg-navy";
}

// "Versant-style practice": Spica prepares people for these exams and isn't
// affiliated with their publishers.
export function familyHeading(f: CatalogueFamily): string {
  return tr("{{name}}-style practice", { name: f.name });
}

export function familyNote(f: CatalogueFamily): string {
  return tr("Practice in the style of {{name}} tests. Spica isn't affiliated with {{publisher}}; levels and scores are estimates.", {
    name: f.name,
    publisher: f.publisher,
  });
}
