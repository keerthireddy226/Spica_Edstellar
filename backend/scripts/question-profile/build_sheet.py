"""Question profile, part 3: the spreadsheet. Joins the measurements
(profile.jsonl) and, when present, the AI judgements (ai.jsonl).

  python build_sheet.py OUT_DIR OUTPUT.xlsx
"""

import json
import os
import statistics
import sys
from collections import defaultdict
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

OUT, XLSX = sys.argv[1], sys.argv[2]
LEVELS = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]

rows = [json.loads(l) for l in open(os.path.join(OUT, "profile.jsonl"))]
ai = {}
if os.path.exists(os.path.join(OUT, "ai.jsonl")):
    for l in open(os.path.join(OUT, "ai.jsonl")):
        if l.strip():
            d = json.loads(l)
            ai[d["id"]] = d
for r in rows:
    a = ai.get(r["id"])
    r["ai_cefr"] = a["ai_cefr"] if a else None
    r["ai_fit"] = a["fit"] if a else None
    r["ai_vocab_cefr"] = a.get("vocab_cefr") if a else None
    r["ai_hard_words"] = ", ".join(a.get("hard_words") or []) if a else None
    r["ai_grammar"] = "; ".join(a["grammar_points"]) if a else None
    r["ai_task"] = a["task_demand"] if a else None
    r["ai_topic"] = a["topic_familiarity"] if a else None
    r["ai_load"] = a["cognitive_load"] if a else None
    r["ai_distractors"] = (a.get("distractors") or None) if a else None
    r["ai_issues"] = (a.get("issues") or None) if a else None
    checks = [f for f in r["flags"].split("; ") if f]
    if a and a["fit"] != "fits":
        checks.append(f"AI: {a['fit']} for {r['cefr']}")
    if a and a.get("issues"):
        checks.append("AI: possible problem")
    r["to_check"] = "; ".join(checks)

# (key, header, width, explanation)
COLUMNS = [
    ("id", "Question ID", 38, "The question's ID in the database."),
    ("type", "Question type", 22, "The type of question, as named in the app."),
    ("skills", "Skills", 22, "Skills the question type is scored on."),
    ("cefr", "CEFR level", 9, "The level the question is labelled with."),
    ("used_in", "Used in", 11, "assessment (real test), mock, practice (practice sets), or bank (Practice Modules and newly built tests)."),
    ("set", "Set", 26, "The set the question belongs to, if any."),
    ("topic", "Topic", 18, "Topic recorded when the question was made."),
    ("domain", "Domain", 12, "Everyday, work and so on, as recorded."),
    ("mode", "Heard or read", 10, "Whether the test taker hears the text (a recording) or reads it."),
    ("stimulus_words", "Text words", 9, "Words in the text the test taker reads or hears."),
    ("question_words", "Question words", 9, "Words in the separate question, if any."),
    ("sentences", "Sentences", 9, "Number of sentences in the text."),
    ("words_per_sentence", "Words per sentence", 10, "Average words per sentence."),
    ("longest_sentence", "Longest sentence (words)", 10, "Words in the longest sentence."),
    ("letters_per_word", "Letters per word", 9, "Average word length in letters."),
    ("syllables_per_word", "Syllables per word", 9, "Average syllables per word."),
    ("readability_ease", "Reading ease", 9, "Flesch Reading Ease: higher is easier (90+ very easy, below 30 very hard). Only for texts of 5+ words."),
    ("grade_level", "School grade", 8, "Flesch-Kincaid grade: the US school year a native reader would need. Only for texts of 5+ words."),
    ("unique_word_ratio", "Word variety", 8, "Different words divided by all words (1.0 = no word repeated)."),
    ("content_words", "Content words", 8, "Nouns, verbs, adjectives and adverbs (not small grammar words)."),
    ("rarity_level", "Word rarity level", 9, "From general English word frequency (Milton 2010 sizes): the lowest level whose vocabulary covers 90% of the content words. Everyday words such as 'umbrella' count as rare in general English, so this is a signal, not a learner level; see AI vocabulary level."),
    ("words_A1_pct", "% A1-band words", 8, "Share of content words within the 1,500 most frequent English words."),
    ("words_A2_pct", "% A2-band", 7, "Share within words 1,501-2,500."),
    ("words_B1_pct", "% B1-band", 7, "Share within words 2,501-3,250."),
    ("words_B2_pct", "% B2-band", 7, "Share within words 3,251-3,750."),
    ("words_C1_pct", "% C1-band", 7, "Share within words 3,751-4,500."),
    ("words_C2_pct", "% rarer", 7, "Share beyond the 4,500 most frequent words."),
    ("rare_words", "Rarer words", 26, "Content words beyond the 4,500 most frequent words."),
    ("clauses_per_sentence", "Clauses per sentence", 9, "Average clauses (verb groups) per sentence: 1 = simple sentences."),
    ("subordinate_clauses", "Subordinate clauses", 9, "Clauses such as 'because...', 'which...', 'that...', 'to...'."),
    ("passive", "Passive", 7, "Passive verb forms found."),
    ("max_depth", "Structure depth", 8, "How deeply phrases are nested in the most complex sentence (higher = harder to follow)."),
    ("grammar_features", "Grammar found", 30, "Tenses and structures found by the parser: present simple, past simple, present perfect, passive, conditionals, modals..."),
    ("recordings", "Recordings", 8, "Number of recordings (one per voice)."),
    ("audio_seconds", "Audio seconds", 8, "Length of the recording."),
    ("speech_rate_wpm", "Speech rate (wpm)", 9, "Words per minute in the recording, including pauses."),
    ("accent", "Accent", 9, "en-US (American) or en-GB (British)."),
    ("speakers", "Speakers", 7, "Speakers in the recording."),
    ("options", "Options", 7, "Multiple choice: number of options."),
    ("correct_position", "Right option", 7, "Multiple choice: position of the right option."),
    ("option_words_avg", "Option words", 8, "Multiple choice: average words per option."),
    ("correct_is_longest", "Right option longest", 8, "Multiple choice: the right option is at least 2 words longer than every other (a clue test takers can use)."),
    ("answer_words_min", "Answer min words", 8, "Writing tasks: fewest words expected."),
    ("answer_words_max", "Answer max words", 8, "Writing tasks: most words expected."),
    ("time_seconds", "Time (seconds)", 8, "Time allowed to answer."),
    ("difficulty_old", "Old difficulty", 8, "Difficulty estimated when the question was made (0-1), where recorded."),
    ("ai_cefr", "AI level", 8, "AI: the CEFR level it would give the question."),
    ("ai_fit", "AI fit", 9, "AI: fits, too easy or too hard for its labelled level."),
    ("ai_vocab_cefr", "AI vocabulary level", 9, "AI: vocabulary level as learner word lists would place it."),
    ("ai_hard_words", "AI hard words", 22, "AI: words above the labelled level."),
    ("ai_grammar", "AI grammar points", 34, "AI: main grammar structures, each with its usual CEFR level."),
    ("ai_task", "AI task demand", 16, "AI: what the task asks (repeat, literal understanding, inference, opinion...)."),
    ("ai_topic", "AI topic type", 10, "AI: everyday, work, academic or abstract."),
    ("ai_load", "AI load (1-5)", 7, "AI: how demanding the question is for a learner at its level."),
    ("ai_distractors", "AI distractors", 9, "AI, multiple choice only: good, weak or ambiguous wrong options."),
    ("ai_issues", "AI possible problem", 30, "AI: possible problem (two right answers, wrong key, unnatural English, unclear)."),
    ("to_check", "To check", 40, "Why the question may not fit its level, from the measurements and the AI. Empty = nothing found."),
]

HEAD = Font(name="Arial", bold=True, color="FFFFFF", size=10)
HEAD_FILL = PatternFill("solid", fgColor="1F3A5F")
BODY = Font(name="Arial", size=10)
BOLD = Font(name="Arial", size=10, bold=True)
WRAP = Alignment(wrap_text=True, vertical="top")


def header(ws, names, widths):
    ws.append(names)
    for i, w in enumerate(widths, 1):
        c = ws.cell(row=1, column=i)
        c.font, c.fill, c.alignment = HEAD, HEAD_FILL, Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.row_dimensions[1].height = 42
    ws.freeze_panes = "B2"


def write_rows(ws, data):
    for d in data:
        ws.append(d)
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = BODY
    ws.auto_filter.ref = ws.dimensions


wb = Workbook()
about = wb.active
about.title = "About"
judged = sum(1 for r in rows if r["ai_cefr"])
flagged = sum(1 for r in rows if r["to_check"])
lines = [
    ("Spica question profile", True),
    (f"Made {date.today().isoformat()} from the question bank: {len(rows):,} approved questions. AI judgements for {judged:,} of them.", False),
    ("", False),
    ("In short", True),
    ("Every approved question is measured on its text, vocabulary, sentence structure, recording and answer format.", False),
    (f"{flagged:,} questions are listed on the 'To check' sheet: they look easier or harder than their level, or have a possible problem. A teacher should look at these first.", False),
    ("Sheets: Questions (one row per question), By type and level (typical values), To check (questions to review), Columns (what each column means).", False),
    ("", False),
    ("How to read it", True),
    ("Measured values (text length, sentences, structure, recording) are exact counts made by a program.", False),
    ("'Word rarity level' uses general English word frequency. Everyday learner words such as 'umbrella' or 'soup' are rare in general English, so it over-states the level of simple concrete words. 'AI vocabulary level' judges vocabulary the way learner word lists do.", False),
    ("'Longer / more complex than others' compares a question with the other questions of the same type and level: it is far outside the middle half of them.", False),
    ("AI columns are an AI model's judgement (Gemini). They are a second opinion for a teacher, not a final decision.", False),
    ("Real difficulty (how many test takers get a question right) is not included yet: no question has enough answers. It will be added after launch and the validation study.", False),
]
for text, bold in lines:
    about.append([text])
    about.cell(row=about.max_row, column=1).font = Font(name="Arial", size=14 if text == "Spica question profile" else 10, bold=bold)
    about.cell(row=about.max_row, column=1).alignment = Alignment(wrap_text=True, vertical="top")
about.column_dimensions["A"].width = 120

ws = wb.create_sheet("Questions")
header(ws, [c[1] for c in COLUMNS], [c[2] for c in COLUMNS])
write_rows(ws, [[r.get(c[0]) if not isinstance(r.get(c[0]), bool) else ("yes" if r[c[0]] else "") for c in COLUMNS] for r in rows])

# Typical values for each type and level.
groups = defaultdict(list)
for r in rows:
    groups[(r["type"], r["cefr"])].append(r)


def med(rs, key):
    v = [r[key] for r in rs if isinstance(r.get(key), (int, float)) and not isinstance(r.get(key), bool)]
    return round(statistics.median(v), 1) if v else None


summary_cols = [
    ("Question type", 24), ("CEFR level", 9), ("Questions", 9), ("Text words", 9), ("Words per sentence", 10), ("Longest sentence", 10),
    ("Clauses per sentence", 10), ("Syllables per word", 9), ("Reading ease", 9), ("% A1-band words", 9), ("Audio seconds", 9),
    ("Speech rate (wpm)", 9), ("% British accent", 9), ("% to check", 9), ("% AI says fits", 9), ("% AI too easy", 9), ("% AI too hard", 9),
]
ss = wb.create_sheet("By type and level")
header(ss, [c[0] for c in summary_cols], [c[1] for c in summary_cols])
data = []
for (tname, cefr), rs in sorted(groups.items(), key=lambda kv: (kv[0][0], LEVELS.index(kv[0][1]) if kv[0][1] in LEVELS else 9)):
    rec = [r for r in rs if r["recordings"]]
    j = [r for r in rs if r["ai_fit"]]
    pct = lambda n, d: round(100 * n / d) if d else None  # noqa: E731
    data.append([
        tname, cefr, len(rs), med(rs, "stimulus_words"), med(rs, "words_per_sentence"), med(rs, "longest_sentence"), med(rs, "clauses_per_sentence"),
        med(rs, "syllables_per_word"), med(rs, "readability_ease"), med(rs, "words_A1_pct"), med(rs, "audio_seconds"), med(rs, "speech_rate_wpm"),
        pct(sum(1 for r in rec if "en-GB" in (r["accent"] or "")), len(rec)), pct(sum(1 for r in rs if r["to_check"]), len(rs)),
        pct(sum(1 for r in j if r["ai_fit"] == "fits"), len(j)), pct(sum(1 for r in j if r["ai_fit"] == "too easy"), len(j)), pct(sum(1 for r in j if r["ai_fit"] == "too hard"), len(j)),
    ])
write_rows(ss, data)

tc = wb.create_sheet("To check")
check_cols = [("id", 38), ("type", 22), ("cefr", 9), ("used_in", 11), ("to_check", 50), ("ai_issues", 36), ("stimulus_words", 9), ("words_per_sentence", 10), ("rare_words", 26), ("ai_hard_words", 22)]
heads = {c[0]: c[1] for c in COLUMNS}
header(tc, [heads[k] for k, _ in check_cols], [w for _, w in check_cols])
order = {"assessment": 0, "mock": 1, "practice": 2, "bank": 3}
write_rows(tc, [[r.get(k) for k, _ in check_cols] for r in sorted((r for r in rows if r["to_check"]), key=lambda r: (order.get(r["used_in"], 9), r["type"], r["cefr"]))])
for row in tc.iter_rows(min_row=2):
    for c in row:
        c.alignment = WRAP

cols = wb.create_sheet("Columns")
header(cols, ["Column", "What it means"], [26, 120])
write_rows(cols, [[c[1], c[3]] for c in COLUMNS])
for row in cols.iter_rows(min_row=2):
    row[0].font = BOLD
    row[1].alignment = WRAP

wb.save(XLSX)
print(f"saved {XLSX}: {len(rows)} questions, {judged} with AI, {flagged} to check")
