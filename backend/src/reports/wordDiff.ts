// Word-level comparison of what a learner said (or typed) with the target
// text: which words were said differently, left out or added. Only a
// different or missing word counts; an accent never does, and British,
// American and Indian spellings are the same word.
import { canonicalSpelling } from "../placement/spelling.js";

export interface WordOp {
  op: "same" | "sub" | "missing" | "extra";
  // The target word (absent for an added word).
  word?: string;
  // What the learner said instead, or added.
  said?: string;
}

function tokens(s: string): string[] {
  return (s.match(/[A-Za-z0-9'’-]+/g) ?? []).map((w) => w.replace(/’/g, "'"));
}

const norm = (w: string) => canonicalSpelling(w.toLowerCase());

// Levenshtein alignment over words; substitutions count like a missing plus
// an added word would, so a single wrong word shows as one substitution.
export function wordDiff(target: string, said: string): WordOp[] {
  const a = tokens(target);
  const b = tokens(said);
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const same = norm(a[i - 1]) === norm(b[j - 1]);
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (same ? 0 : 1));
    }
  }
  const ops: WordOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && norm(a[i - 1]) === norm(b[j - 1]) && d[i][j] === d[i - 1][j - 1]) {
      ops.push({ op: "same", word: a[i - 1] });
      i--;
      j--;
    } else if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + 1) {
      ops.push({ op: "sub", word: a[i - 1], said: b[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      ops.push({ op: "missing", word: a[i - 1] });
      i--;
    } else {
      ops.push({ op: "extra", said: b[j - 1] });
      j--;
    }
  }
  return ops.reverse();
}

export function diffSummary(ops: WordOp[]): { substituted: number; missing: number; extra: number; accuracy: number } {
  const targetWords = ops.filter((o) => o.op !== "extra").length;
  const substituted = ops.filter((o) => o.op === "sub").length;
  const missing = ops.filter((o) => o.op === "missing").length;
  const extra = ops.filter((o) => o.op === "extra").length;
  return { substituted, missing, extra, accuracy: targetWords ? (targetWords - substituted - missing) / targetWords : 0 };
}
