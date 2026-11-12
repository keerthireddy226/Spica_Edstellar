"""Question list: every approved question in a simple format.

Columns: Question, CEFR Level, Difficulty Level, Number of Words, Question
Length, Type, Usage. Uses the measurements in OUT_DIR/profile.jsonl
(measure_questions.py) for the difficulty and length.

  PROFILE_DB_URL=... python question_list.py OUT_DIR OUTPUT.xlsx [--sample 10]
"""

import json
import os
import re
import statistics
import sys
from collections import defaultdict

import psycopg
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill

OUT, XLSX = sys.argv[1], sys.argv[2]
SAMPLE = int(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else None
LEVELS = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]
PURPOSE = {"assessment": "Assessment", "mock": "Mock test", "practice": "Practice test"}


def text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return " ".join(text(x) for x in v)
    if isinstance(v, dict):
        return " ".join(text(x) for x in v.values())
    return str(v)


def letters(options, right):
    return "\n".join(f"{'ABCDEFGH'[i]}) {text(o)}{'   ✓' if i == right else ''}" for i, o in enumerate(options))


def show(t: str, c: dict, a: dict) -> str:
    """The question as the test taker meets it, in plain text."""
    a = a if isinstance(a, dict) else {}
    accepted = a.get("acceptable_answers") if isinstance(a.get("acceptable_answers"), list) else None
    parts = []
    if t == "conversations":
        parts = [c.get("dialogue", ""), f"Question: {c.get('question', '')}"]
    elif t == "sentence_builds":
        parts = [" / ".join(c.get("groups") or []), f"Answer: {a.get('correct', '')}"]
    elif t == "sentence_completion":
        parts = [c.get("sentence", ""), f"Answer: {', '.join(accepted or [])}"]
    elif t in ("reading_comprehension",):
        parts = [c.get("passage") or c.get("text", ""), f"Question: {c.get('question', '')}", letters(c.get("options") or [], a.get("correctIndex"))]
    elif t == "response_selection":
        parts = [c.get("text", ""), letters(c.get("options") or [], a.get("correctIndex"))]
    elif t in ("passage_comprehension",):
        parts = [c.get("story", ""), f"Question: {c.get('question', '')}"]
    elif t in ("reading_selective",):
        parts = [c.get("text", ""), f"Question: {c.get('question', '')}"]
    elif t in ("short_answer",):
        parts = [c.get("question", ""), f"Answer: {', '.join(accepted or [])}" if accepted else ""]
    elif t in ("lc_speak_discussion", "lc_speak_presentation"):
        parts = [c.get("prompt", ""), text(c.get("ideas") or c.get("points"))]
    elif t.startswith("lc_"):
        main = c.get("audio") or c.get("passage") or c.get("text") or c.get("sentence") or c.get("prompt", "")
        parts = [main, c.get("question", "")]
        if isinstance(c.get("options"), list):
            parts.append(letters(c["options"], a.get("correctIndex")))
        for i, q in enumerate(c.get("questions") or []):
            if isinstance(q, dict):
                parts.append(f"{i + 1}. {q.get('question', '')}" + (("\n" + letters(q.get("options") or [], None)) if q.get("options") else ""))
    else:
        main = c.get("text") or c.get("passage") or c.get("story") or c.get("situation") or c.get("prompt") or c.get("question") or text(c)
        parts = [main]
    return "\n".join(p for p in parts if p and p.strip())


def words(s: str) -> int:
    """Words the test taker hears or reads: not the answer, labels or option letters."""
    lines = [l for l in s.split("\n") if not l.startswith("Answer:")]
    body = "\n".join(lines).replace("✓", "")
    body = re.sub(r"^Question:\s*", "", body, flags=re.M)
    body = re.sub(r"^(?:[A-H]\)|\d+\.)\s*", "", body, flags=re.M)
    body = re.sub(r"(?:^|\s)(?:Speaker\s+)?[A-D]:\s", " ", body)
    return len(re.findall(r"[A-Za-z0-9']+", body))


def collect() -> list:
    """Every approved question with its display text, difficulty, length and uses."""
    prof = {}
    for line in open(os.path.join(OUT, "profile.jsonl")):
        r = json.loads(line)
        prof[r["id"]] = r

    with psycopg.connect(os.environ["PROFILE_DB_URL"]) as conn:
        rows = conn.execute(
            """SELECT i.id::text, i.item_type_id, it.name, i.cefr_level, i.content, i.answer_set, i.pool, it.skills
               FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.status = 'approved'"""
        ).fetchall()
        usage = defaultdict(list)
        sets = defaultdict(list)
        # The set the question belongs to, and every built test that uses it.
        for iid, purpose, name, test_type in conn.execute(
            """SELECT i.id::text, e.purpose, e.name, e.test_type_id FROM items i JOIN exam_parts ep ON ep.id = i.exam_part_id JOIN exams e ON e.id = ep.exam_id
               WHERE i.status = 'approved'
               UNION
               SELECT fi.item_id::text, f.purpose, f.name, f.test_type_id FROM form_items fi JOIN forms f ON f.id = fi.form_id"""
        ):
            usage[iid].append(f"{PURPOSE.get(purpose, (purpose or '').title())}: {name}")
            sets[iid].append((purpose, name, test_type))

    # Difficulty within the level: a question's text measures (length, sentence
    # length, clauses, word length, share of less common words, speech rate)
    # compared with the other questions of the same type, then split into
    # thirds within its type and CEFR level: Easy, Medium, Hard.
    keys = ["stimulus_words", "words_per_sentence", "clauses_per_sentence", "syllables_per_word", "rare_share", "speech_rate_wpm"]
    for p in prof.values():
        p["rare_share"] = 100 - (p.get("words_A1_pct") or 0) if p.get("content_words") else None
    by_type = defaultdict(list)
    for p in prof.values():
        by_type[p["type_id"]].append(p)
    for ps in by_type.values():
        stats = {}
        for k in keys:
            v = [p[k] for p in ps if isinstance(p.get(k), (int, float))]
            if len(v) > 2 and statistics.pstdev(v) > 0:
                stats[k] = (statistics.mean(v), statistics.pstdev(v))
        for p in ps:
            z = [(p[k] - m) / s for k, (m, s) in stats.items() if isinstance(p.get(k), (int, float))]
            p["score"] = sum(z) / len(z) if z else 0.0
        # Length within the type: thirds by number of words.
        wl = sorted(p["stimulus_words"] for p in ps)
        lo, hi = wl[len(wl) // 3], wl[(2 * len(wl)) // 3]
        for p in ps:
            p["length"] = "Short" if p["stimulus_words"] <= lo and lo < hi else "Long" if p["stimulus_words"] > hi else "Medium"
    groups = defaultdict(list)
    for p in prof.values():
        groups[(p["type_id"], p["cefr"])].append(p)
    for ps in groups.values():
        ps.sort(key=lambda p: p["score"])
        n = len(ps)
        for i, p in enumerate(ps):
            p["difficulty"] = "Easy" if i < n / 3 else "Medium" if i < 2 * n / 3 else "Hard"

    out = []
    for iid, t, tname, cefr, content, answer, pool, skills in rows:
        p = prof.get(iid)
        if not p:
            continue
        q = show(t, content or {}, answer or {})
        used = sorted(set(usage.get(iid, []))) or ["Practice Modules (question bank)"]
        out.append(
            {
                "id": iid,
                "type_id": t,
                "question": q,
                "cefr": cefr,
                "difficulty": p["difficulty"],
                "words": words(q),
                "length": p["length"] + (f" ({p['audio_seconds']} s audio)" if p.get("audio_seconds") else ""),
                "type": tname,
                "usage": "\n".join(used),
                "kind": 0 if any(u.startswith("Assessment") for u in used) else 1 if any(u.startswith("Mock") for u in used) else 2 if any(u.startswith("Practice test") for u in used) else 3,
                "sets": sets.get(iid, []),
                "pool": pool,
                "skills": list(skills or []),
                "audio_seconds": p.get("audio_seconds"),
                "length_band": p["length"],
            }
        )
    return out


def main():
    out = collect()

    if SAMPLE:
        # A spread of types, levels and uses.
        wanted = ["repeats", "sentence_builds", "conversations", "sentence_completion", "dictation", "passage_reconstruction", "reading_comprehension", "response_selection", "short_answer", "email_writing"]
        picked = []
        for i, t in enumerate(wanted[:SAMPLE]):
            cands = [o for o in out if o["type_id"] == t]
            pref = [o for o in cands if o["kind"] == i % 4] or cands
            pref.sort(key=lambda o: (LEVELS.index(o["cefr"]) if o["cefr"] in LEVELS else 9, o["id"]))
            picked.append(pref[(i * 7) % len(pref)])
        out = picked
    out.sort(key=lambda o: (o["kind"], o["usage"], o["type"], LEVELS.index(o["cefr"]) if o["cefr"] in LEVELS else 9))

    wb = Workbook()
    ws = wb.active
    ws.title = "Question list"
    heads = [("Question", 70), ("CEFR Level", 10), ("Difficulty Level", 12), ("Number of Words", 11), ("Question Length", 16), ("Type", 22), ("Usage", 44)]
    ws.append([h for h, _ in heads])
    for i, (_, w) in enumerate(heads, 1):
        c = ws.cell(row=1, column=i)
        c.font = Font(name="Arial", bold=True, color="FFFFFF", size=10)
        c.fill = PatternFill("solid", fgColor="1F3A5F")
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[c.column_letter].width = w
    for o in out:
        ws.append([o["question"], o["cefr"], o["difficulty"], o["words"], o["length"], o["type"], o["usage"]])
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = Font(name="Arial", size=10)
            c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions

    notes = wb.create_sheet("How to read")
    for line in [
        "Question: the question as the test taker meets it (what they hear or read). The right option is marked ✓; 'Answer:' shows the expected answer where there is one.",
        "CEFR Level: the level the question is labelled with.",
        "Difficulty Level: Easy, Medium or Hard compared with the other questions of the same type and CEFR level. Worked out from the text: length, sentence length, sentence structure, word length, less common words and (for recordings) speech speed. It is not yet based on test takers' answers; that comes after launch.",
        "Number of Words: words the test taker hears or reads (text, question and options; not the answer).",
        "Question Length: Short, Medium or Long compared with other questions of the same type, and the recording length for questions that are heard.",
        "Type: the question type, as named in the app.",
        "Usage: every test the question is in: Assessment (real test), Mock test or Practice test, with the set's name. 'Practice Modules (question bank)' means it is not in a fixed set: it is used in Practice Modules and when new tests are built.",
    ]:
        notes.append([line])
        notes.cell(row=notes.max_row, column=1).font = Font(name="Arial", size=10)
        notes.cell(row=notes.max_row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
    notes.column_dimensions["A"].width = 120
    wb.save(XLSX)
    print(f"saved {XLSX}: {len(out)} questions")


if __name__ == "__main__":
    main()
