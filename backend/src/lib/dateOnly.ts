// A Postgres DATE arrives as a Date at local midnight; toISOString() would
// shift it a day back in timezones ahead of UTC. This keeps the calendar day.
export function dateOnly(d: Date | string): string {
  if (typeof d === "string") return d.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
