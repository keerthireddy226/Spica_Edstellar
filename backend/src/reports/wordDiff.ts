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

// Similar words (want/wanted, walk/work) pair up before unrelated ones.
function similar(x: string, y: string): boolean {
  const a = norm(x);
  const b = norm(y);
  if (a.slice(0, 3) === b.slice(0, 3) && Math.min(a.length, b.length) >= 3) return true;
  // Letters in common, in order.
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length] >= Math.max(a.length, b.length) * 0.6;
}

// Costs: a missing or added word 10, a different word 10 if similar, else
// 14 (still cheaper than missing + added, so one wrong word shows as one
// substitution).
const GAP = 10;
const subCost = (x: string, y: string) => (norm(x) === norm(y) ? 0 : similar(x, y) ? 10 : 14);

export function wordDiff(target: string, said: string): WordOp[] {
  const a = tokens(target);
  const b = tokens(said);
  const n = a.length;
  const m = b.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j * GAP : j === 0 ? i * GAP : 0)));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      d[i][j] = Math.min(d[i - 1][j] + GAP, d[i][j - 1] + GAP, d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1]));
    }
  }
  const ops: WordOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + subCost(a[i - 1], b[j - 1])) {
      ops.push(norm(a[i - 1]) === norm(b[j - 1]) ? { op: "same", word: a[i - 1] } : { op: "sub", word: a[i - 1], said: b[j - 1] });
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + GAP) {
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
