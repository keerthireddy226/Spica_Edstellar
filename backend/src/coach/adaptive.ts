import { LEVELS, type Level } from "../learner/path.js";

const step = (level: string, by: number): Level => LEVELS[Math.min(LEVELS.length - 1, Math.max(0, LEVELS.indexOf(level as Level) + by))];

// The level for the next question: the skill's level to start with; then, in
// this conversation, two right in a row at a level moves one level up and two
// wrong in a row moves one level down.
export function adaptiveLevel(pathLevel: Level, asked: { level: string; correct: boolean | null }[]): Level {
  if (!asked.length) return pathLevel;
  const current = asked[asked.length - 1].level;
  const marked = asked.filter((a) => a.correct !== null);
  // The latest marks at the current level, since it was reached.
  const run: boolean[] = [];
  for (let k = marked.length - 1; k >= 0 && marked[k].level === current; k--) run.unshift(marked[k].correct!);
  const last2 = run.slice(-2);
  if (last2.length === 2 && last2.every(Boolean)) return step(current, 1);
  if (last2.length === 2 && last2.every((x) => !x)) return step(current, -1);
  return LEVELS.includes(current as Level) ? (current as Level) : pathLevel;
}
