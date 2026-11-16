import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  Compass,
  GraduationCap,
  Headphones,
  LayoutGrid,
  Mic,
  PenLine,
  Presentation,
  User,
  UserSearch,
} from "lucide-react";
import type { Tone } from "./PageHero";
import type { Skill } from "@/lib/tests";

// Each test's icon and colour, used on the Tests pages.
export const TEST_LOOK: Record<string, { icon: React.ElementType; tone: Tone }> = {
  "english-4-skills-essentials": { icon: LayoutGrid, tone: "clay" },
  "english-placement": { icon: Compass, tone: "sky" },
  "professional-english": { icon: Briefcase, tone: "plum" },
  "speaking-and-listening": { icon: Mic, tone: "moss" },
  writing: { icon: PenLine, tone: "gold" },
  "level-tests": { icon: BarChart3, tone: "clay" },
};

export const SKILL_ICON: Record<Skill, React.ElementType> = { Speaking: Mic, Listening: Headphones, Reading: BookOpen, Writing: PenLine };

// Each audience's icon and colour, used on the "Who it's for" pages.
export const SOLUTION_LOOK: Record<string, { icon: React.ElementType; tone: Tone }> = {
  companies: { icon: Building2, tone: "clay" },
  recruiters: { icon: UserSearch, tone: "sky" },
  universities: { icon: GraduationCap, tone: "plum" },
  "training-providers": { icon: Presentation, tone: "gold" },
  individuals: { icon: User, tone: "moss" },
};
