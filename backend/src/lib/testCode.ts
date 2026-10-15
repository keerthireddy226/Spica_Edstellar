import { randomInt } from "node:crypto";

// A test attempt's ID: two letters for the test, then 8 characters without
// look-alikes (no 0/O, 1/I), e.g. "FS-7K3M-9QX2". Unique across all attempts.
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const PREFIX_BY_EXAM: Record<string, string> = { fourskills: "FS", speaklisten: "SL", writing: "WR", professional: "PR", placement: "PL" };

export function newTestCode(prefix: string): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}-${s.slice(0, 4)}-${s.slice(4)}`;
}

// Mock exams by product ("fourskills-2" → "FS"); the adaptive placement test is "AP".
export function examPrefix(examCode: string): string {
  return PREFIX_BY_EXAM[examCode.replace(/-\d+$/, "")] ?? "MT";
}
