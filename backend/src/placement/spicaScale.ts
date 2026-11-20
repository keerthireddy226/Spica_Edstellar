// The Spica score (10-90, Spica's own scale aligned to CEFR) and its bands.
// In its own module so the level rules (levels.ts) and the score report use
// the same bands without importing each other.
export const BELOW_A1 = "Pre-A1";

export const BANDS = [
  { level: "Pre-A1", min: 10, max: 19 },
  { level: "A1", min: 20, max: 29 },
  { level: "A2", min: 30, max: 39 },
  { level: "B1", min: 40, max: 54 },
  { level: "B2", min: 55, max: 69 },
  { level: "C1", min: 70, max: 79 },
  { level: "C2", min: 80, max: 90 },
] as const;

// A skill's level sets its band; the share of its questions right places it within the band.
export function spicaScore(level: string | null | undefined, percent: number | null | undefined): number | null {
  const band = BANDS.find((b) => b.level === level);
  if (!band) return null;
  const p = Math.max(0, Math.min(100, percent ?? 50)) / 100;
  return Math.round(band.min + (band.max - band.min) * p);
}

export function levelOfScore(score: number): string {
  return (BANDS.find((b) => score >= b.min && score <= b.max) ?? (score < 10 ? BANDS[0] : BANDS[BANDS.length - 1])).level;
}
