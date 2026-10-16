"""Checks a LanguageCert-style set file (seeds/content/languagecert) against the layouts and content shapes.

Usage: python3 scripts/validateExamSets.py seeds/content/languagecert/*.json"""
import json, re, sys, collections

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
LR = [
    ("Listening Part 1: Short utterances", "lc_listen_mcq"),
    ("Listening Part 2: Best reply", "lc_listen_reply"),
    ("Listening Part 2: Complete the dialogue", "lc_listen_dialogue"),
    ("Listening Part 3: Short conversations", "lc_listen_conversation"),
    ("Listening Part 4: Longer listening", "lc_listen_long"),
    ("Reading Part 1: Short texts", "lc_read_short"),
    ("Reading Part 2: Gapped texts", "lc_read_cloze"),
    ("Reading Part 3: Gapped sentences", "lc_read_gap"),
    ("Reading Part 4: Longer texts", "lc_read_long"),
]
LR_COUNTS = [8, 5, 10, 6, 3, 7, 3, 23, 3]
LOWER = [
    ("Listening Part 1: Short utterances", "lc_listen_mcq", 8),
    ("Listening Part 2: Best reply", "lc_listen_reply", 6),
    ("Listening Part 3: Short conversations", "lc_listen_conversation", 4),
    ("Listening Part 4: Longer listening", "lc_listen_long", 2),
    ("Reading Part 1: Short texts", "lc_read_short", 8),
    ("Reading Part 2: Gapped texts", "lc_read_cloze", 3),
    ("Reading Part 3: Gapped sentences", "lc_read_gap", 7),
    ("Reading Part 4: Longer texts", "lc_read_long", 2),
]
WR = [("Writing: Report, article or review", "lc_write_task2", 1)]
SP = [
    ("Part 1: Personal questions", "lc_speak_personal", 3),
    ("Part 2: Discussion", "lc_speak_discussion", 1),
    ("Part 3: Presenting a topic", "lc_speak_presentation", 1),
    ("Part 3: Follow-up questions", "lc_speak_followup", 2),
]
LAYOUTS = {
    "lcListeningReading": [(l, t, c) for (l, t), c in zip(LR, LR_COUNTS)],
    "lcListeningReadingLower": LOWER,
    "lcWriting": WR,
    "lcSpeaking": SP,
    "lcFourSkills": [(l, t, c) for (l, t), c in zip(LR, LR_COUNTS)] + WR + SP,
}
MAX_LEVEL = {"lcListeningReadingLower": "B1"}

SINGLE = {"lc_listen_mcq", "lc_listen_reply", "lc_listen_dialogue", "lc_read_short", "lc_read_gap"}
GROUP = {"lc_listen_conversation": 2, "lc_listen_long": 5, "lc_read_cloze": 5, "lc_read_long": 5}
FREE = {"lc_write_task1", "lc_write_task2", "lc_speak_personal", "lc_speak_discussion", "lc_speak_presentation", "lc_speak_followup"}


def words(s):
    return len(re.findall(r"[A-Za-z0-9'’-]+", s or ""))


def check(path):
    problems = []
    d = json.load(open(path, encoding="utf8"))
    exam = d.get("exam", {})
    tt = exam.get("test_type_id")
    if tt not in LAYOUTS:
        return [f"unknown test_type_id {tt!r}"]
    if not re.fullmatch(r"(lclr|lclrb|lcwr|lcsp|lc4s)-\d+", exam.get("code", "")):
        problems.append(f"bad exam code {exam.get('code')!r}")
    layout = LAYOUTS[tt]
    parts = d.get("parts", [])
    if len(parts) != len(layout):
        problems.append(f"expected {len(layout)} parts, got {len(parts)}")
    positions = collections.Counter()
    for pi, (part, (label, itype, count)) in enumerate(zip(parts, layout), 1):
        where = f"part {pi}"
        if part.get("sort_order") != pi:
            problems.append(f"{where}: sort_order should be {pi}")
        if part.get("label") != label:
            problems.append(f"{where}: label should be {label!r}")
        if part.get("item_type_id") != itype:
            problems.append(f"{where}: item_type_id should be {itype!r}")
        items = part.get("items", [])
        if len(items) != count:
            problems.append(f"{where}: expected {count} items, got {len(items)}")
        for ii, it in enumerate(items, 1):
            w = f"{where} item {ii}"
            c, a = it.get("content", {}), it.get("answer_set", {})
            lvl = it.get("cefr_level")
            if lvl not in LEVELS:
                problems.append(f"{w}: bad cefr_level {lvl!r}")
            elif tt in MAX_LEVEL and LEVELS.index(lvl) > LEVELS.index(MAX_LEVEL[tt]):
                problems.append(f"{w}: level {lvl} above {MAX_LEVEL[tt]}")
            if not it.get("topic"):
                problems.append(f"{w}: missing topic")
            if itype in SINGLE:
                opts = c.get("options")
                if not (isinstance(opts, list) and len(opts) == 3 and all(isinstance(o, str) and o.strip() for o in opts)):
                    problems.append(f"{w}: needs 3 non-empty options")
                elif len(set(o.strip().lower() for o in opts)) < 3:
                    problems.append(f"{w}: duplicate options")
                ci = a.get("correctIndex")
                if ci not in (0, 1, 2):
                    problems.append(f"{w}: correctIndex must be 0-2")
                else:
                    positions[ci] += 1
                key = {"lc_read_short": "text", "lc_read_gap": "sentence"}.get(itype, "audio")
                if not isinstance(c.get(key), str) or not c[key].strip():
                    problems.append(f"{w}: missing {key}")
                if itype == "lc_read_gap" and c.get("sentence", "").count("____") != 1:
                    problems.append(f"{w}: sentence needs exactly one ____")
                if itype == "lc_read_short" and not c.get("question"):
                    problems.append(f"{w}: missing question")
                if itype == "lc_listen_dialogue" and "A:" not in c.get("audio", ""):
                    problems.append(f"{w}: dialogue audio should use A:/B:")
            elif itype in GROUP:
                n = GROUP[itype]
                qs = c.get("questions")
                corr = a.get("correct")
                if not (isinstance(qs, list) and len(qs) == n):
                    problems.append(f"{w}: needs exactly {n} questions")
                    continue
                if not (isinstance(corr, list) and len(corr) == n and all(x in (0, 1, 2) for x in corr)):
                    problems.append(f"{w}: answer_set.correct must be {n} indexes 0-2")
                else:
                    positions.update(corr)
                for qi, q in enumerate(qs, 1):
                    opts = q.get("options")
                    if not (isinstance(opts, list) and len(opts) == 3 and all(isinstance(o, str) and o.strip() for o in opts)):
                        problems.append(f"{w} q{qi}: needs 3 options")
                    if itype != "lc_read_cloze" and not q.get("stem"):
                        problems.append(f"{w} q{qi}: missing stem")
                if itype == "lc_read_cloze":
                    p = c.get("passage", "")
                    for g in range(1, 6):
                        if f"({g}) ____" not in p:
                            problems.append(f"{w}: passage missing gap ({g}) ____")
                    if not 70 <= words(p) <= 200:
                        problems.append(f"{w}: cloze passage should be 80-150 words (has {words(p)})")
                if itype == "lc_read_long" and not 280 <= words(c.get("passage", "")) <= 600:
                    problems.append(f"{w}: long passage should be 300-550 words (has {words(c.get('passage', ''))})")
                if itype == "lc_listen_long" and not 230 <= words(c.get("audio", "")) <= 430:
                    problems.append(f"{w}: long listening should be 250-400 words (has {words(c.get('audio', ''))})")
                if itype == "lc_listen_conversation" and not 70 <= words(c.get("audio", "")) <= 170:
                    problems.append(f"{w}: conversation should be 80-150 words (has {words(c.get('audio', ''))})")
            elif itype in FREE:
                if not isinstance(c.get("prompt"), str) or len(c["prompt"].strip()) < 10:
                    problems.append(f"{w}: missing prompt")
                if itype == "lc_write_task1" and "60-100 words" not in c.get("prompt", ""):
                    problems.append(f"{w}: task 1 prompt must say (60-100 words)")
                if itype == "lc_write_task2" and "200-250 words" not in c.get("prompt", ""):
                    problems.append(f"{w}: task 2 prompt must say (200-250 words)")
                if itype == "lc_speak_discussion" and not (isinstance(c.get("ideas"), list) and len(c["ideas"]) == 5):
                    problems.append(f"{w}: needs 5 ideas")
                if itype == "lc_speak_presentation" and not (isinstance(c.get("points"), list) and 2 <= len(c["points"]) <= 3):
                    problems.append(f"{w}: needs 2-3 points")
    total = sum(positions.values())
    if total >= 15:
        for pos in (0, 1, 2):
            share = positions[pos] / total
            if share < 0.22 or share > 0.45:
                problems.append(f"correct answers unbalanced: position {pos} is {share:.0%} ({dict(positions)})")
    return problems


if __name__ == "__main__":
    bad = 0
    for path in sys.argv[1:]:
        p = check(path)
        if p:
            bad += 1
            print(f"{path}: {len(p)} problems")
            for x in p[:40]:
                print("  -", x)
        else:
            print(f"{path}: OK")
    sys.exit(1 if bad else 0)
