"""Question bank dashboard: one Excel file with
  - Dashboard: totals and charts, and a filter (test, skill, question type,
    usage) that recounts the questions by CEFR level, difficulty and length;
  - All questions, one sheet per test (the six tests) and one per skill
    (Speaking, Listening, Reading, Writing), each a filterable table, with a
    column for each of the six tests.
The hidden LanguageCert-style questions are left out.

  PROFILE_DB_URL=... python dashboard.py OUT_DIR OUTPUT.xlsx
Then calculate the formulas once (recalc.py from the xlsx skill) so the
numbers show in any viewer; Excel recalculates by itself.
"""

from collections import Counter
from datetime import date

from openpyxl import Workbook
from openpyxl.chart import BarChart, Reference
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

import re

import question_list as ql

LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
DIFFICULTY = ["Easy", "Medium", "Hard"]
LENGTHS = ["Short", "Medium", "Long"]
USAGE = ["Assessment", "Mock test", "Practice test", "Question bank"]

# The six tests, in the order Spica shows them.
TESTS = [
    ("placement", "English Placement"),
    ("fourSkills", "English 4 Skills Essentials"),
    ("speakingListening", "English Speaking & Listening"),
    ("writing", "English Writing"),
    ("professional", "Professional English"),
    ("level", "Level Test (A1-C2)"),
]
# Question types each test uses (its sets' layouts; the level test blueprint).
TEST_TYPES = {
    "placement": {"conversations", "dictation", "passage_reconstruction", "reading", "repeats", "sentence_builds", "sentence_completion", "summary_and_opinion", "typing"},
    "fourSkills": {"conversations", "dictation", "passage_reconstruction", "reading", "repeats", "sentence_builds", "sentence_completion"},
    "speakingListening": {"conversations", "open_questions", "passage_comprehension", "repeats", "short_answer", "story_retelling"},
    "writing": {"dictation", "email_writing", "passage_reconstruction", "response_selection", "sentence_completion", "typing"},
    "professional": {"dictation", "email_writing", "passage_comprehension", "passage_reconstruction", "reading_comprehension", "repeats", "response_selection", "sentence_completion", "speaking_situations", "story_retelling"},
    "level": {"reading", "repeats", "short_answer", "response_selection", "reading_comprehension", "sentence_completion", "dictation", "email_writing"},
}

# Each question on one skill sheet, by what the test taker does.
SKILL_SHEET = {
    "Speaking": {"open_questions", "conversations", "passage_comprehension", "reading", "repeats", "sentence_builds", "short_answer", "reading_selective", "speaking_situations", "story_retelling"},
    "Listening": {"dictation", "response_selection"},
    "Reading": {"reading_comprehension", "sentence_completion"},
    "Writing": {"free_writing", "typing", "email_writing", "passage_reconstruction", "summary_and_opinion"},
}
SKILLS = ["Speaking", "Listening", "Reading", "Writing"]
STATUS = ["Approved, not yet teacher-reviewed", "Reviewed", "Needs correction"]

NAVY = "1F3A5F"
F = lambda **k: Font(name="Arial", size=k.pop("size", 10), **k)  # noqa: E731
HEAD_FILL = PatternFill("solid", fgColor=NAVY)
PALE = PatternFill("solid", fgColor="EEF2F7")
INPUT = PatternFill("solid", fgColor="FFF4CC")
THIN = Border(*(Side(style="thin", color="C9D3E0"),) * 4)
WRAP = Alignment(wrap_text=True, vertical="top")


def skill_of(t: str) -> str:
    for s, types in SKILL_SHEET.items():
        if t in types:
            return s
    return "Other test types"


def test_cells(o) -> dict:
    """For each of the six tests: 'In this test' (in one of its sets or built
    tests), 'Can be used' (a bank question of a type the test uses; level tests
    draw from the bank), 'Reserved' (kept for level tests), or empty."""
    in_sets = {tt for _, _, tt in o["sets"]}
    cells = {}
    for tid, _ in TESTS:
        if tid in in_sets:
            cells[tid] = "In this test"
        elif not o["sets"] and o["type_id"] in TEST_TYPES[tid]:
            cells[tid] = "Reserved" if tid == "level" and o["pool"] == "level_test" else "Can be used"
        else:
            cells[tid] = ""
    return cells


COLUMNS = [
    ("Question ID", 11), ("Question", 60), ("Skill", 11), ("Question Type", 20), ("Test Type", 26), ("CEFR Level", 8), ("Difficulty", 9),
    ("Word Count", 8), ("Question Length", 12), ("Audio (seconds)", 9), ("Usage", 13), ("Practice Test", 30), ("Mock Test", 30), ("Assessment", 30),
    *[(name, 14) for _, name in TESTS],
    ("Skills Scored", 18), ("Status", 18),
]
HDR = [c for c, _ in COLUMNS]


def row_of(o) -> list:
    by = {"practice": [], "mock": [], "assessment": []}
    for purpose, name, _ in o["sets"]:
        by.setdefault(purpose, []).append(name)
    test_names = sorted({dict(TESTS).get(tt, "LanguageCert-style (hidden)") for _, _, tt in o["sets"]})
    tc = test_cells(o)
    return [
        o["id"][:8],
        o["question"],
        skill_of(o["type_id"]),
        o["type"],
        "; ".join(test_names) if test_names else "Question bank",
        o["cefr"],
        o["difficulty"],
        o["words"],
        o["length_band"],
        o["audio_seconds"],
        USAGE[o["kind"]],
        "\n".join(sorted(by["practice"])),
        "\n".join(sorted(by["mock"])),
        "\n".join(sorted(by["assessment"])),
        *[tc[tid] for tid, _ in TESTS],
        " + ".join(s.title() for s in o["skills"]),
        STATUS[0],
    ]


def data_sheet(wb, title, rows, table_name):
    ws = wb.create_sheet(title)
    ws.append(HDR)
    for r in rows:
        ws.append(r)
    for i, (_, w) in enumerate(COLUMNS, 1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for c in ws[1]:
        c.font = F(bold=True, color="FFFFFF")
        c.fill = HEAD_FILL
        c.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[1].height = 36
    for row in ws.iter_rows(min_row=2):
        for c in row:
            c.font = F()
            c.alignment = WRAP
    ws.freeze_panes = "C2"
    if rows:
        # Filter buttons on the header row. (Excel "tables" would add striping,
        # but a dozen of them make LibreOffice take many minutes to open the file.)
        ws.auto_filter.ref = f"A1:{get_column_letter(len(HDR))}{len(rows) + 1}"
        dv = DataValidation(type="list", formula1='"' + ",".join(STATUS) + '"', allow_blank=True)
        col = get_column_letter(HDR.index("Status") + 1)
        dv.add(f"{col}2:{col}{len(rows) + 1}")
        ws.add_data_validation(dv)
    return ws


def main():
    out = ql.collect()
    out.sort(key=lambda o: (o["kind"], o["type"], LEVELS.index(o["cefr"]) if o["cefr"] in LEVELS else 9, o["id"]))
    # The hidden LanguageCert-style questions are not part of Spica's tests.
    out = [o for o in out if not o["type_id"].startswith("lc_")]
    rows = [row_of(o) for o in out]
    n = len(rows)

    wb = Workbook()
    dash = wb.active
    dash.title = "Dashboard"
    all_ws = data_sheet(wb, "All questions", rows, "AllQuestions")
    # One sheet per test: the questions in its sets (assessment forms first,
    # then mock and practice sets). The level test has no fixed sets: its sheet
    # lists the bank questions it draws from.
    def natural(v):
        return [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", v or "")]

    usage_i, ass_i, mock_i, prac_i = HDR.index("Usage"), HDR.index("Assessment"), HDR.index("Mock Test"), HDR.index("Practice Test")
    for tid, name in TESTS:
        ci = HDR.index(name)
        mine = [r for r in rows if (r[ci] == "In this test" if tid != "level" else r[ci] in ("Can be used", "Reserved"))]
        mine.sort(key=lambda r: (USAGE.index(r[usage_i]), natural(r[ass_i] or r[mock_i] or r[prac_i]), r[3], LEVELS.index(r[5]) if r[5] in LEVELS else 9))
        data_sheet(wb, name, mine, re.sub(r"[^A-Za-z0-9]", "", name) + "Test")
    for s in SKILLS:
        data_sheet(wb, s, [r for r in rows if r[2] == s], s.replace(" ", "") + "Questions")

    # Lists for the dropdowns (hidden sheet).
    lists = wb.create_sheet("Lists")
    types = sorted({r[3] for r in rows})
    columns_lists = [
        ["Test", "All tests", *[name for _, name in TESTS]],
        ["Skill", "All skills", *SKILLS],
        ["Question type", "All question types", *types],
        ["Usage", "All uses", *USAGE],
        ["Include", "Only questions in the test's sets", "Also bank questions it can use"],
    ]
    for ci, col in enumerate(columns_lists, 1):
        for ri, v in enumerate(col, 1):
            lists.cell(row=ri, column=ci, value=v)
    lists.sheet_state = "hidden"

    # Ranges on All questions.
    last = n + 1
    def rng(header):
        c = get_column_letter(HDR.index(header) + 1)
        return f"'All questions'!${c}$2:${c}${last}"
    full = f"'All questions'!$A$2:${get_column_letter(len(HDR))}${last}"
    hdr_row = f"'All questions'!$A$1:${get_column_letter(len(HDR))}$1"

    d = dash
    d.sheet_view.showGridLines = False
    for col, w in zip("ABCDEFGHIJKL", [26, 14, 12, 12, 12, 12, 12, 12, 4, 26, 14, 12]):
        d.column_dimensions[col].width = w
    d["A1"] = "Spica question bank"
    d["A1"].font = F(size=18, bold=True, color=NAVY)
    d["A2"] = f"All approved questions of Spica's six tests, {date.today().isoformat()}. Difficulty and length are worked out from each question's text, compared with questions of the same type and level."
    d["A2"].font = F(color="5B6B7C")

    # Headline numbers.
    d["A4"], d["B4"] = "Total questions", f"=COUNTA({rng('Question ID')})"
    d["A5"], d["B5"] = "Question types", len(types)
    d["A6"], d["B6"] = "Skills", 4
    d["A7"], d["B7"] = "Tests", len(TESTS)
    for r in range(4, 8):
        d[f"A{r}"].font = F(bold=True)
        d[f"B{r}"].font = F(size=14, bold=True, color=NAVY)
        d[f"B{r}"].number_format = "#,##0"

    # ---- Filter ----
    d["A9"] = "Filter"
    d["A9"].font = F(size=13, bold=True, color=NAVY)
    d["A10"] = "Pick values in the yellow cells; the tables below recount."
    d["A10"].font = F(color="5B6B7C")
    picks = [("Test", "A", 11), ("Skill", "B", 12), ("Question type", "C", 13), ("Usage", "D", 14), ("Include", "E", 15)]
    for (label, lcol, r), default in zip(picks, ["All tests", "All skills", "All question types", "All uses", "Also bank questions it can use"]):
        d[f"A{r}"] = label if label != "Include" else "For a test, include"
        d[f"A{r}"].font = F(bold=True)
        cell = d[f"B{r}"]
        cell.value = default
        cell.fill = INPUT
        cell.border = THIN
        cell.font = F(bold=True)
        d.merge_cells(f"B{r}:E{r}")
        last_row = len([c for c in columns_lists if c[0] == (label if label != "Include" else "Include")][0])
        dv = DataValidation(type="list", formula1=f"Lists!${lcol}$2:${lcol}${last_row}", allow_blank=False)
        dv.add(f"B{r}")
        d.add_data_validation(dv)

    # Criteria cells (hidden helpers in column L).
    d["L11"] = '=IF($B$11="All tests",MATCH("CEFR Level",' + hdr_row + ',0),MATCH($B$11,' + hdr_row + ',0))'
    d["L12"] = '=IF($B$11="All tests","<>",IF($B$15="Only questions in the test\'s sets","In this test","<>"))'
    d["L13"] = '=IF($B$12="All skills","*",$B$12)'
    d["L14"] = '=IF($B$13="All question types","*",$B$13)'
    d["L15"] = '=IF($B$14="All uses","*",$B$14)'
    for r in range(11, 16):
        d[f"L{r}"].font = F(color="FFFFFF")
    crit = (
        f"INDEX({full},0,$L$11),$L$12,{rng('Skill')},$L$13,{rng('Question Type')},$L$14,{rng('Usage')},$L$15"
    )

    def table(top, title, row_labels, row_header, extra=None):
        d.cell(row=top, column=1, value=title).font = F(size=12, bold=True, color=NAVY)
        heads = [row_header, *LEVELS, "Total"]
        for ci, h in enumerate(heads, 1):
            c = d.cell(row=top + 1, column=ci, value=h)
            c.font, c.fill, c.alignment, c.border = F(bold=True, color="FFFFFF"), HEAD_FILL, Alignment(horizontal="center"), THIN
        for ri, lab in enumerate(row_labels):
            r = top + 2 + ri
            d.cell(row=r, column=1, value=lab).font = F(bold=True)
            d.cell(row=r, column=1).border = THIN
            for li, lv in enumerate(LEVELS):
                col = get_column_letter(2 + li)
                f = f"=COUNTIFS({crit},{rng('CEFR Level')},\"{lv}\"" + (f",{extra},\"{lab}\"" if extra else "") + ")"
                c = d[f"{col}{r}"]
                c.value, c.number_format, c.border, c.alignment, c.font = f, "#,##0", THIN, Alignment(horizontal="center"), F()
            tc = d.cell(row=r, column=2 + len(LEVELS), value=f"=SUM(B{r}:{get_column_letter(1 + len(LEVELS))}{r})")
            tc.font, tc.number_format, tc.border, tc.alignment = F(bold=True), "#,##0", THIN, Alignment(horizontal="center")
        tr = top + 2 + len(row_labels)
        d.cell(row=tr, column=1, value="Total").font = F(bold=True)
        for ci in range(2, 3 + len(LEVELS)):
            col = get_column_letter(ci)
            c = d[f"{col}{tr}"]
            c.value, c.font, c.fill, c.number_format, c.border, c.alignment = f"=SUM({col}{top + 2}:{col}{tr - 1})", F(bold=True), PALE, "#,##0", THIN, Alignment(horizontal="center")
        d.cell(row=tr, column=1).fill = PALE
        return tr

    end1 = table(17, "Filtered: questions by difficulty and CEFR level", DIFFICULTY, "Difficulty", rng("Difficulty"))
    end2 = table(end1 + 2, "Filtered: questions by length and CEFR level", LENGTHS, "Question length", rng("Question Length"))
    end3 = table(end2 + 2, "Filtered: questions by usage and CEFR level", USAGE, "Usage", rng("Usage"))

    # Chart of the filtered counts by level (the difficulty table's total row).
    ch = BarChart()
    ch.type, ch.style, ch.title = "col", 10, "Filtered questions by CEFR level"
    ch.y_axis.title, ch.x_axis.title = "Questions", "CEFR level"
    ch.add_data(Reference(d, min_col=2, max_col=1 + len(LEVELS), min_row=end1), from_rows=True, titles_from_data=False)
    ch.set_categories(Reference(d, min_col=2, max_col=1 + len(LEVELS), min_row=18))
    ch.legend = None
    ch.height, ch.width = 7.5, 16
    d.add_chart(ch, "J17")

    # ---- Whole bank (no filter) ----
    top = end3 + 3
    d.cell(row=top, column=1, value="Whole question bank").font = F(size=13, bold=True, color=NAVY)

    def simple(top, title, labels, header_col, criteria):
        d.cell(row=top, column=1, value=title).font = F(size=12, bold=True, color=NAVY)
        for ci, h in enumerate([header_col, "Questions"], 1):
            c = d.cell(row=top + 1, column=ci, value=h)
            c.font, c.fill, c.border = F(bold=True, color="FFFFFF"), HEAD_FILL, THIN
        for i, lab in enumerate(labels):
            r = top + 2 + i
            d.cell(row=r, column=1, value=lab).border = THIN
            d.cell(row=r, column=1).font = F()
            c = d.cell(row=r, column=2, value=criteria(lab))
            c.number_format, c.border, c.font = "#,##0", THIN, F()
        return top + 1 + len(labels)

    e = simple(top + 2, "By test (questions in its sets / bank questions it can use)", [name for _, name in TESTS], "Test",
               lambda name: f'=COUNTIFS(INDEX({full},0,MATCH("{name}",{hdr_row},0)),"In this test")')
    d.cell(row=top + 3, column=3, value="Bank, can use").font = F(bold=True, color="FFFFFF")
    d.cell(row=top + 3, column=3).fill = HEAD_FILL
    for i, (_, name) in enumerate(TESTS):
        c = d.cell(row=top + 4 + i, column=3, value=f'=COUNTIFS(INDEX({full},0,MATCH("{name}",{hdr_row},0)),"<>",INDEX({full},0,MATCH("{name}",{hdr_row},0)),"<>In this test")')
        c.number_format, c.border, c.font = "#,##0", THIN, F()
    tests_top = top + 2
    e2 = simple(e + 2, "By skill sheet", SKILLS, "Skill", lambda s: f'=COUNTIFS({rng("Skill")},"{s}")')
    skills_top = e + 2
    e3 = simple(e2 + 2, "By CEFR level", LEVELS, "CEFR level", lambda lv: f'=COUNTIFS({rng("CEFR Level")},"{lv}")')
    levels_top = e2 + 2
    e4 = simple(e3 + 2, "By question type", types, "Question type", lambda t: f'=COUNTIFS({rng("Question Type")},"{t}")')

    for ttl, t0, cnt, anchor in [("Questions in each test's sets", tests_top, len(TESTS), f"J{tests_top}"), ("Questions by skill sheet", skills_top, len(SKILLS), f"J{skills_top + 16}"), ("Questions by CEFR level", levels_top, len(LEVELS), f"J{levels_top + 28}")]:
        c = BarChart()
        c.type, c.style, c.title = "bar", 10, ttl
        c.add_data(Reference(d, min_col=2, min_row=t0 + 2, max_row=t0 + 1 + cnt), titles_from_data=False)
        c.set_categories(Reference(d, min_col=1, min_row=t0 + 2, max_row=t0 + 1 + cnt))
        c.legend = None
        c.height, c.width = 7, 16
        d.add_chart(c, anchor)

    # ---- How to read ----
    how = wb.create_sheet("How to read")
    how.column_dimensions["A"].width = 120
    lines = [
        ("How to use this file", True),
        ("All questions: the first sheet: every question in one table. Use the filter buttons in the header row.", False),
        ("Dashboard: pick a test, skill, question type or usage in the yellow cells. The tables recount the questions by CEFR level, difficulty, length and usage.", False),
        ("Test sheets (English Placement ... Level Test): the questions in that test's sets, real test forms first, then mock and practice sets. The Level Test has no fixed sets, so its sheet lists the bank questions it draws from. Bank questions other tests can use are on All questions: filter the test's column for 'Can be used'.", False),
        ("Skill sheets (Speaking, Listening, Reading, Writing): every question is on one sheet, by what the test taker does: speaks, listens and chooses or types, reads and chooses or fills a gap, or writes. 'Skills Scored' lists every skill the question is scored on.", False),
        ("", False),
        ("Columns", True),
        ("Question ID: the first 8 characters of the question's ID in the system; it never changes.", False),
        ("Question: what the test taker hears or reads. The right option is marked with a check mark; 'Answer:' shows the expected answer.", False),
        ("Test Type: the test whose set the question is in, or 'Question bank' when it isn't in a fixed set.", False),
        ("Difficulty: Easy, Medium or Hard compared with the other questions of the same type and CEFR level, from the text (length, sentence length, structure, word length, less common words, speech speed). Not yet from test takers' answers.", False),
        ("Word Count: words the test taker hears or reads (not the answer). Question Length: Short, Medium or Long compared with questions of the same type. Audio: recording length.", False),
        ("Usage: where the question is used: Assessment (real test), Mock test, Practice test, or Question bank (Practice Modules, level tests and new tests). Practice Test, Mock Test and Assessment columns name the sets.", False),
        ("One column per test (English Placement ... Level Test): 'In this test' = in one of that test's sets; 'Can be used' = a bank question of a type the test uses; 'Reserved' = kept for level tests.", False),
        ("Status: all questions are approved; none has a teacher review recorded yet. Teachers can set Reviewed or Needs correction from the dropdown.", False),
        ("Not included: the 202 LanguageCert-style questions, which are hidden in the app and not part of Spica's tests.", False),
    ]
    for text, bold in lines:
        how.append([text])
        how.cell(row=how.max_row, column=1).font = F(bold=bold, size=12 if bold else 10)
        how.cell(row=how.max_row, column=1).alignment = WRAP

    order = ["All questions", "Dashboard", "How to read", *[name for _, name in TESTS if name in wb.sheetnames], *SKILLS, "Lists"]
    wb._sheets = [wb[name] for name in order]
    wb.active = 0
    wb.save(ql.XLSX)
    counts = Counter(r[2] for r in rows)
    print(f"saved {ql.XLSX}: {n} questions; " + ", ".join(f"{s} {counts[s]}" for s in SKILLS))


if __name__ == "__main__":
    main()
