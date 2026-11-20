// Individual prices from the Spica price list (live, 16 Nov 2026). Update
// here whenever the price list in Spica (staff: Plans & pricing) changes.
// The site shows USD only: one price list for everyone, India included
// (owner, 20 Nov 2026); the other columns are kept for reference.

export const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
export type Currency = (typeof CURRENCIES)[number];

type Row = Record<Currency, number>;
const r = (INR: number, USD: number, EUR: number, GBP: number, AED: number, SGD: number): Row => ({ INR, USD, EUR, GBP, AED, SGD });

export const PRICES: Record<string, Row> = {
  free: r(0, 0, 0, 0, 0, 0),
  full: r(2499, 49, 45, 39, 180, 66),
  "prep:fourSkills": r(1499, 29, 27, 23, 106, 39),
  "prep:speakingListening": r(1199, 25, 23, 20, 92, 34),
  "prep:writing": r(1199, 25, 23, 20, 92, 34),
  "prep:professional": r(1999, 39, 36, 31, 143, 53),
  "prep:placement": r(799, 19, 17, 15, 70, 26),
  "assessment:fourSkills": r(699, 15, 14, 12, 55, 20),
  "assessment:speakingListening": r(449, 10, 9, 8, 37, 14),
  "assessment:writing": r(449, 10, 9, 8, 37, 14),
  "assessment:professional": r(899, 19, 17, 15, 70, 26),
  "assessment:placement": r(299, 7, 6, 6, 26, 9),
  level: r(249, 6, 6, 5, 22, 8),
  pack: r(599, 12, 11, 9, 44, 16),
  certExtend: r(199, 5, 5, 4, 18, 7),
  certLifetime: r(699, 15, 14, 12, 55, 20),
};

const SYMBOL: Record<Currency, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£", AED: "AED ", SGD: "S$" };

export function money(key: string, c: Currency): string {
  const v = PRICES[key]?.[c];
  if (v === undefined) return "—";
  return `${SYMBOL[c]}${v.toLocaleString(c === "INR" ? "en-IN" : "en-US")}`;
}

// Organisations (USD).
export const LICENCE_BANDS = [
  { tier: "Starter", from: 1, usd: 25 },
  { tier: "Business", from: 50, usd: 20 },
  { tier: "Enterprise", from: 250, usd: 15 },
];
export const CREDIT_BANDS = [
  { from: 1, usd: 5 },
  { from: 100, usd: 4 },
  { from: 500, usd: 3 },
];
export const EDUCATION_DISCOUNT = 15;
export const PILOT = { licences: 10, days: 30 };
