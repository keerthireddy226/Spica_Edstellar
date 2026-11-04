import { tr } from "@/i18n/tr";

// Where a Spica score sits inside its CEFR band: the lower, middle or upper
// third (for example "B2 · high" just below C1).
const BANDS: { level: string; min: number; max: number }[] = [
  { level: "Pre-A1", min: 10, max: 19 },
  { level: "A1", min: 20, max: 29 },
  { level: "A2", min: 30, max: 39 },
  { level: "B1", min: 40, max: 54 },
  { level: "B2", min: 55, max: 69 },
  { level: "C1", min: 70, max: 79 },
  { level: "C2", min: 80, max: 90 },
];

export function subBand(score: number | null | undefined): "low" | "mid" | "high" | null {
  if (score == null) return null;
  const b = BANDS.find((x) => score >= x.min && score <= x.max);
  if (!b) return null;
  const share = (score - b.min) / (b.max - b.min + 1);
  return share < 1 / 3 ? "low" : share < 2 / 3 ? "mid" : "high";
}

export function subBandLabel(score: number | null | undefined): string | null {
  const s = subBand(score);
  return s === "low" ? tr("low") : s === "mid" ? tr("mid") : s === "high" ? tr("high") : null;
}
