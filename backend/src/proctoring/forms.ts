// Randomized exam forms. Every set of a product has the same sections in the
// same order, so a candidate's form takes each section's questions from all
// sets of that product's bank (the one the assigned exam belongs to). Questions that share one passage or story stay
// together and in order.

export interface FormRow {
  id: string;
  exam_id: string;
  exam_order: number;
  sort_order: number;
  part_label: string;
  content: Record<string, unknown>;
}

// The longest text value in an item's content. Items that share one (a story
// read once, then several questions) belong to the same group.
function sharedText(content: Record<string, unknown>): string | null {
  let best: string | null = null;
  for (const v of Object.values(content ?? {})) {
    if (typeof v === "string" && v.length >= 80 && (!best || v.length > best.length)) best = v;
  }
  return best;
}

export function groupItems<T extends FormRow>(rows: T[]): T[][] {
  const groups: T[][] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    const prev = last?.[last.length - 1];
    const text = sharedText(row.content);
    if (prev && prev.exam_id === row.exam_id && text && text === sharedText(prev.content)) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

export function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
