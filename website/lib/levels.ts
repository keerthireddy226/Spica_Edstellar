// English levels on the Spica scale. The "can do" lines are the same ones the
// Spica score report shows (frontend/src/components/report/ScoreReport.tsx),
// so the website and the report always describe a level the same way.

export interface Level {
  slug: string;
  code: string;
  name: string;
  range: string;
  summary: string;
  speaking: string;
  listening: string;
  reading: string;
  writing: string;
}

export const BELOW_A1 = {
  code: "Below A1",
  range: "10–19",
  speaking: "Say a few familiar words and very short phrases about yourself.",
  listening: "Recognise a few familiar words when they're spoken slowly and clearly.",
  reading: "Recognise familiar names, words and very simple sentences.",
  writing: "Write your name and a few familiar words.",
};

export const LEVELS: Level[] = [
  {
    slug: "a1",
    code: "A1",
    name: "Beginner",
    range: "20–29",
    summary: "Uses simple everyday words and phrases about familiar things, when others speak slowly.",
    speaking: "Introduce yourself and answer simple questions about familiar things, slowly.",
    listening: "Understand simple questions and instructions spoken slowly.",
    reading: "Understand short, simple texts like notices and signs.",
    writing: "Write short, simple phrases and fill in forms with personal details.",
  },
  {
    slug: "a2",
    code: "A2",
    name: "Elementary",
    range: "30–39",
    summary: "Handles short, routine exchanges about daily life, work and plans.",
    speaking: "Talk about your daily routine, work and plans in short, simple sentences.",
    listening: "Understand short, clear messages and conversations on familiar topics.",
    reading: "Find information in short everyday texts like emails and timetables.",
    writing: "Write short, simple notes and messages about everyday needs.",
  },
  {
    slug: "b1",
    code: "B1",
    name: "Intermediate",
    range: "40–54",
    summary: "Deals with most everyday and work situations, and describes experiences and plans.",
    speaking: "Describe experiences and plans in connected sentences that others understand.",
    listening: "Follow the main points of clear speech about work and everyday life.",
    reading: "Understand the main points of clear texts on familiar topics.",
    writing: "Write simple connected text on familiar topics, like a short email.",
  },
  {
    slug: "b2",
    code: "B2",
    name: "Upper intermediate",
    range: "55–69",
    summary: "Works confidently in English: discussions, detailed emails and natural-speed conversation.",
    speaking: "Explain a point of view and take part in work discussions with some fluency.",
    listening: "Follow conversations and talks at natural speed, including some detail.",
    reading: "Read work emails and articles and understand the main points and details.",
    writing: "Write clear, detailed emails and short reports on familiar topics.",
  },
  {
    slug: "c1",
    code: "C1",
    name: "Advanced",
    range: "70–79",
    summary: "Uses English flexibly for complex work, study and professional situations.",
    speaking: "Speak fluently on complex topics, with clear structure and little searching for words.",
    listening: "Follow extended talk on unfamiliar topics and pick up implied meaning.",
    reading: "Understand long, complex texts and the writer's attitude.",
    writing: "Write well-structured texts on complex topics with good control of grammar.",
  },
  {
    slug: "c2",
    code: "C2",
    name: "Proficient",
    range: "80–90",
    summary: "Understands almost everything and expresses ideas precisely, in any situation.",
    speaking: "Speak effortlessly and precisely in any situation, including fine shades of meaning.",
    listening: "Understand any spoken English with ease, even fast or idiomatic speech.",
    reading: "Read almost any text with ease, including specialised or abstract ones.",
    writing: "Write clear, fluent and precise texts in any style.",
  },
];
