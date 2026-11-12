"""Technical documents for the Spica tests: a Test Description and Validation
Summary for English Placement, English Speaking & Listening, English Writing,
Professional English and the Level Tests, in the same layout as the English 4
Skills Essentials document (which provides the shared sections and the style).

Numbers (parts, items, timing, banks, levels, prompt lengths) come from the
question bank; the 4 Skills document's shared sections are reused word for word
with the test's name.

  PROFILE_DB_URL=... python tech_docs.py PROFILE_DIR FOUR_SKILLS.html OUT_DIR
"""

import html as H
import json
import os
import re
import sys
from collections import Counter, defaultdict

import psycopg

PROFILE_DIR, TEMPLATE, OUT_DIR = sys.argv[1], sys.argv[2], sys.argv[3]
LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"]
SKILLS = ["speaking", "listening", "reading", "writing"]
SK = {"speaking": "S", "listening": "L", "reading": "R", "writing": "W"}
DATE = "12 November 2026"
VERSION = "Version 0.9 (draft) · " + DATE
NUM = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten"}

# ---------------------------------------------------------------- question types

# Per question type: how it works, an example, what is scored, the answer key
# and the item specification. {time} is filled from the type's time limit.
TYPES = {
    "repeats": dict(
        answer="Spoken",
        desc="The test taker hears a sentence and repeats it exactly. Sentences range from short, simple statements to longer sentences with more complex structure, and are presented in approximate order of difficulty. The test taker has {time} to answer. To repeat a sentence accurately, the test taker must recognise the words as they are spoken, hold the meaning and structure in mind, and reproduce them clearly.",
        ex="<b>Examples</b><br>1. The meeting starts at nine.<br>2. Please send me the report before you leave today.<br>3. If the delivery arrives late again, we will need to find another supplier.",
        hears="A spoken sentence", does="Says it back exactly", scored="Words and word order; pronunciation; fluency",
        key="Repeats: the exact sentence.",
        spec=("Spoken sentence, {w} words", "Spoken repetition", "Exact sentence", "Content against key; pronunciation, fluency, rate"),
        length="sentence", scoring="spoken",
    ),
    "sentence_builds": dict(
        answer="Spoken",
        desc="The test taker hears three short groups of words in a jumbled order and must say them back as one correct sentence. The test taker has {time} to answer. The task requires understanding each group, working out how the groups fit together grammatically, and saying the complete sentence fluently.",
        ex="<b>Example</b><br>Heard: \"to the client\" … \"she explained\" … \"the new price\"<br>Possible answer: \"She explained the new price to the client.\"",
        hears="Three spoken word groups, jumbled", does="Says one correct sentence", scored="Correct sentence (any correct order accepted); pronunciation; fluency",
        key="Sentence Builds: the correct sentence plus every other grammatical order of the three groups.",
        spec=("Three spoken word groups ({w} words in all)", "Spoken sentence", "Correct sentence and alternates", "Content against key; pronunciation, fluency, rate"),
        length="full sentence", scoring="spoken",
    ),
    "conversations": dict(
        answer="Spoken",
        desc="The test taker hears a short conversation between two speakers, labelled Speaker A and Speaker B, followed by a question about it. The answer is spoken, and a word or short phrase is enough. The task measures the ability to follow a conversation at a natural pace and pick out the information asked for.",
        ex="<b>Example</b><br>Speaker A: \"Can we move our call to Thursday?\"<br>Speaker B: \"Thursday is fine, but not before eleven.\"<br>Question: \"When can Speaker B talk on Thursday?\"<br>Answer: \"After eleven.\"",
        hears="A short two-speaker conversation and a question", does="Answers in a word or phrase", scored="Correct information; intelligibility",
        key="Conversations: a list of accepted answers covering natural ways of giving the same information (\"the mountains\", \"to the mountains\", \"mountains\").",
        spec=("Two-speaker dialogue and question, {w} words", "Spoken word or phrase", "Accepted answers", "Content against key; intelligibility"),
        length="conversation and question", scoring="spoken", with_question=True,
    ),
    "reading": dict(
        name="Read Aloud", answer="Spoken",
        desc="The test taker sees a short text on screen and reads it aloud, clearly and at a natural pace, for up to {time}; finishing the text is not required. The task measures reading, pronunciation and fluency: to read a text aloud well, the test taker must recognise the words quickly and group them into meaningful phrases.",
        ex="<b>Example (A2)</b><br>\"Pablo's sister is getting married in June. The wedding is going to be in a garden by the river. About a hundred people are coming. Pablo is going to make a short speech, and he is quite nervous about it.\"",
        hears="A short written text", does="Reads it aloud", scored="Words read correctly; pronunciation; fluency",
        key="Read Aloud: the text itself.",
        spec=("Written text, {w} words", "Spoken reading", "The text", "Words read correctly; pronunciation, fluency, rate"),
        length="text", scoring="spoken",
    ),
    "sentence_completion": dict(
        answer="Typed",
        desc="The test taker reads a sentence with a gap and types the missing word. Where a base word is shown next to the sentence, the test taker types the form of that word that completes the sentence correctly (for example, a plural, a past tense, a comparative, or a noun made from a verb). The test taker has {time} for each item. The task measures reading comprehension and grammatical accuracy: to answer, the test taker must understand the whole sentence, work out what the grammar and meaning require, and spell the word correctly.",
        ex="<b>Examples</b><br>1. \"He's been working here ___ five years.\" → for<br>2. \"The manager ___ the new schedule yesterday.\" (explain) → explained<br>3. \"This route is much ___ than the old one.\" (quick) → quicker",
        hears="A written sentence with a gap (and sometimes a base word)", does="Types the missing word", scored="Correct word and spelling",
        key="Sentence Completion: the accepted words for the gap, built during item development and blind review.",
        spec=("Written sentence, {w} words, with one gap", "Typed word", "Accepted words", "Match after spelling normalisation"),
        length="sentence", scoring="completion",
    ),
    "dictation": dict(
        answer="Typed",
        desc="The test taker hears a sentence (it can be played up to twice) and types it exactly. The test taker has {time} for each item. Dictation requires accurate listening, knowledge of how words are spelled and how sentences are structured, and the ability to hold a sentence in memory while typing it. Standard British, American and Indian spellings are all accepted.",
        ex="<b>Example</b><br>Heard: \"The new office will open next month.\"<br>Typed: The new office will open next month.",
        hears="A spoken sentence, up to two plays", does="Types it exactly", scored="Every word, in order, correctly spelled",
        key="Dictation: the exact sentence.",
        spec=("Spoken sentence, {w} words, up to two plays", "Typed sentence", "Exact sentence", "Word-by-word match after case, punctuation and spelling normalisation"),
        length="sentence", scoring="dictation",
    ),
    "passage_reconstruction": dict(
        answer="Typed",
        desc="The test taker reads a short passage for 30 seconds. The passage then disappears, and the test taker has 90 seconds to write it again in their own words, keeping its meaning. Answers between 15 and 60 words are expected. The task measures reading comprehension and the ability to write clear, accurate sentences that keep the key information of the original.",
        ex="<b>Example passage</b><br>\"Maria ordered thirty chairs for the training room. When they arrived, five were damaged. She called the supplier, who agreed to replace them by the end of the week at no extra cost.\"",
        hears="A short written passage (30 seconds)", does="Rewrites it from memory in their own words", scored="Key points kept; grammar and vocabulary",
        key="Passage Reconstruction: the key points that a complete reconstruction must keep.",
        spec=("Written passage, {w} words", "Typed text, 15–60 words", "Key points", "Rubric: key points, grammar, vocabulary"),
        length="passage", scoring="rubric", time_label="30 s reading, 90 s writing",
    ),
    "typing": dict(
        answer="Typed",
        desc="The test taker copies a passage shown on screen as quickly and accurately as possible for {time}. The task also lets the test taker become used to the keyboard before the scored writing tasks. It measures the speed and accuracy of typing, which affect every written task at work.",
        ex="<b>Example</b><br>\"Good communication is one of the most valuable skills in any workplace. Employees who communicate clearly with coworkers and supervisors tend to complete projects more efficiently…\"",
        hears="A written passage", does="Copies it by typing", scored="Words typed correctly (accuracy) within the time",
        key="Typing: the passage itself.",
        spec=("Written passage, {w} words", "Typed copy", "The passage", "Word-by-word comparison with the passage"),
        length="passage", scoring="typing",
    ),
    "summary_and_opinion": dict(
        answer="Typed",
        desc="The test taker reads a passage that presents a point of view, summarises the author's opinion in 25 to 50 words, and then gives and supports their own opinion, in at least 50 words in total. The test taker has {time}. The task measures reading of a longer text and the ability to summarise accurately and argue clearly in writing.",
        ex="<b>Example</b><br>A passage about working from home versus working in an office, giving both sides. The test taker summarises the author's view, then says which they prefer and why.",
        hears="A written passage with an opinion", does="Writes a summary and their own opinion", scored="Accurate summary; clear own opinion; length; grammar and vocabulary",
        key="Summary and Opinion: the author's main opinion, used by the rubric to judge the summary.",
        spec=("Written passage, {w} words", "Typed summary and opinion, at least 50 words", "Author's opinion", "Rubric: summary, own opinion, length, grammar, vocabulary"),
        length="passage", scoring="rubric",
    ),
    "email_writing": dict(
        answer="Typed",
        desc="The test taker reads a workplace situation and writes an email of at least 100 words that covers every point asked for. The test taker has {time}. The task measures real business writing: covering the task, organising the message clearly, using the right tone, and writing grammatically with suitable vocabulary.",
        ex="<b>Example</b><br>\"A regular customer, Mrs. Chen, complained that a recent online order arrived late and slightly damaged. Write an email to her apologising for the issue and offering a solution. Cover: an apology for the delay, an apology for the damage, and an offer to make it right.\"",
        hears="A written workplace situation", does="Writes an email of at least 100 words", scored="Task covered; organisation and tone; grammar and vocabulary; length",
        key="Email Writing: the points the email must cover, stated in the task.",
        spec=("Written situation, {w} words", "Typed email, at least 100 words", "Points to cover", "Rubric: task, organisation, tone, grammar, vocabulary, length"),
        length="situation", scoring="rubric",
    ),
    "response_selection": dict(
        answer="Chosen",
        desc="The test taker hears a sentence and chooses the most natural reply from three written options, within {time}. The task measures quick listening and understanding of what makes a natural, relevant reply.",
        ex="<b>Example</b><br>Heard: \"We're over budget this quarter.\"<br>a) By how much? &nbsp; b) That's a nice colour. &nbsp; c) The meeting starts at noon.<br>Answer: a",
        hears="A spoken sentence and three replies", does="Chooses the best reply", scored="Correct option",
        key="Response Selection: one correct option; the position of the correct option is balanced across items.",
        spec=("Spoken sentence, {w} words in all with the options", "Chosen option", "One correct option", "Exact match"),
        length="sentence and options", scoring="choice",
    ),
    "reading_comprehension": dict(
        answer="Chosen",
        desc="The test taker reads a short workplace text, such as a notice, report or email, and a question about it, then chooses the best answer from the options, within {time}. The task measures reading for detail and meaning in the kinds of texts used at work.",
        ex="<b>Example</b><br>\"Quarterly Sales Summary: Region North sold 1,200 units, up 15%. Region South sold 950 units, down 5%. Region East sold 1,500 units, up 20%.\"<br>Question: Which region's sales declined? &nbsp; Answer: Region South",
        hears="A written workplace text, a question and options", does="Chooses the best answer", scored="Correct option",
        key="Reading Comprehension: one correct option; the position of the correct option is balanced across items.",
        spec=("Written text, question and options, {w} words", "Chosen option", "One correct option", "Exact match"),
        length="text, question and options", scoring="choice", with_question=True,
    ),
    "short_answer": dict(
        name="Give a Short Answer", answer="Spoken",
        desc="The test taker hears a short question and answers it in a word or a few words, within {time}. The task measures quick understanding of everyday questions and basic vocabulary.",
        ex="<b>Example</b><br>Heard: \"Is ice hot or cold?\" &nbsp; Answer: \"Cold.\"",
        hears="A short spoken question", does="Answers in a word or a few words", scored="Correct information; intelligibility",
        key="Give a Short Answer: a list of accepted answers.",
        spec=("Spoken question, {w} words", "Spoken word or phrase", "Accepted answers", "Content against key; intelligibility"),
        length="question", scoring="spoken",
    ),
    "passage_comprehension": dict(
        name="Answer Questions About a Passage", answer="Spoken",
        desc="The test taker hears a short story or workplace account, then a question about it, and answers in a few words or a short sentence. The task measures understanding of a longer piece of speech and the ability to answer quickly.",
        ex="<b>Example</b><br>Heard: \"Maria arrived at the office early to prepare for the client presentation. When she opened her laptop, she realised the file was missing from her drive. She quickly called her colleague, who emailed her a backup copy…\"<br>Question: \"What problem did she have?\"",
        hears="A short spoken passage and a question", does="Answers in a few words", scored="Correct information; intelligibility",
        key="Answer Questions About a Passage: a list of accepted answers.",
        spec=("Spoken passage and question, {w} words", "Spoken short answer", "Accepted answers", "Content against key; intelligibility"),
        length="passage and question", scoring="spoken", with_question=True,
    ),
    "story_retelling": dict(
        name="Retell a Passage", answer="Spoken",
        desc="The test taker hears a short story and retells it in their own words, within {time}. The task measures understanding of the main points and the ability to speak at length in connected sentences.",
        ex="<b>Example</b><br>Heard: \"Noor noticed a discrepancy in the monthly report. She traced the error back to a duplicate entry. After correcting the mistake, the figures finally matched. Her manager thanked her for catching it before the audit.\"",
        hears="A short spoken story", does="Retells it in their own words", scored="Main points kept; grammar and vocabulary; pronunciation; fluency",
        key="Retell a Passage: the story's main points, used by the rubric.",
        spec=("Spoken story, {w} words", "Spoken retelling", "Main points", "Rubric on transcript; pronunciation, fluency, rate"),
        length="story", scoring="spoken_rubric",
    ),
    "open_questions": dict(
        name="Give Your Opinion", answer="Spoken",
        desc="The test taker hears a question and gives their own opinion with reasons, speaking for up to {time}. The task measures how well a person can give and explain a view in fluent, organised speech.",
        ex="<b>Example</b><br>\"Do you prefer reading a book or watching a film? Explain why.\"",
        hears="A spoken question", does="Gives and explains an opinion", scored="Relevant, developed answer; grammar and vocabulary; pronunciation; fluency",
        key="Give Your Opinion: no single answer; the rubric judges relevance and development.",
        spec=("Spoken question, {w} words", "Spoken opinion", "None (open task)", "Rubric on transcript; pronunciation, fluency, rate"),
        length="question", scoring="spoken_rubric",
    ),
    "speaking_situations": dict(
        answer="Spoken",
        desc="The test taker hears and reads a workplace situation, has a short time to think, and then says what they would say, within {time}. The task measures whether a person can respond politely, clearly and appropriately in real workplace situations.",
        ex="<b>Example</b><br>\"A colleague keeps interrupting you during meetings. You decide to address it privately. What would you say to him?\"",
        hears="A written and spoken workplace situation", does="Says what they would say", scored="Appropriate, relevant response; grammar and vocabulary; pronunciation; fluency",
        key="Speaking Situations: no single answer; the rubric judges whether the response fits the situation.",
        spec=("Written and spoken situation, {w} words", "Spoken response", "None (open task)", "Rubric on transcript; pronunciation, fluency, rate"),
        length="situation", scoring="spoken_rubric",
    ),
}


def no_conversations(html):
    html = html.replace("Each recording uses a single voice throughout, and in Conversations the two speakers are identified as Speaker A and Speaker B so that the test taker can follow who is speaking.", "Each recording uses a single voice throughout.")
    return re.sub(r"<li><b>Speaker labels\.</b>.*?</li>\s*", "", html, flags=re.S)


def secs(n):
    if n is None:
        return None
    if n >= 120 and n % 60 == 0:
        return f"{n // 60} minutes"
    return f"{n} seconds"


# ---------------------------------------------------------------- tests

TESTS = {
    "placement": dict(
        name="English Placement", slug="English-Placement", minutes=50, skills=SKILLS,
        what="measures how well an adult can understand and use English in all four skills, from beginner to advanced, so that they can be placed at the right level and given the right course or learning plan",
        construct_title="Facility in Spoken and Written English, Across the Full Range",
        construct="The Spica English Placement test measures <i>facility in spoken and written English</i> across the full range of ability, from A1 to C2: how well a person understands spoken and written English on everyday and workplace topics, and how well they respond in speech and in writing. Compared with English 4 Skills Essentials, it has more items and two extended writing tasks (Typing and Summary and Opinion), so that it can place a test taker accurately at any level and give a fuller picture of their writing.",
        uses=["placing learners in English training at the right level, from beginner to advanced;", "a full four-skill check of an employee's or applicant's English at any level;", "measuring progress at the end of a course or programme;", "giving individuals a proctored, checkable statement of their English level (the Spica certificate, valid for 12 months)."],
        compare="an established, widely used four-skill English test",
    ),
    "speakingListening": dict(
        name="English Speaking & Listening", slug="English-Speaking-and-Listening", minutes=17, skills=["speaking", "listening"],
        what="measures how well an adult can understand spoken English and respond in speech, on everyday and workplace topics",
        construct_title="Facility in Spoken English",
        construct="The Spica English Speaking &amp; Listening test measures <i>facility in spoken English</i>: how well a person understands spoken English at a natural pace and how well they respond in speech, intelligibly and without long hesitation. All items are heard, and all answers are spoken: from a single word in reply to a short question, through repeating sentences and answering questions about conversations and short passages, to retelling a story and giving a supported opinion.",
        uses=["screening applicants for roles that depend on spoken English, such as customer service, call centres, sales and front-desk work;", "checking the spoken English of employees and teams;", "measuring progress in speaking and listening at the end of training;", "giving individuals a proctored, checkable statement of their spoken English level (the Spica certificate, valid for 12 months)."],
        compare="an established, widely used test of spoken English",
    ),
    "writing": dict(
        name="English Writing", slug="English-Writing", minutes=35, skills=["writing", "listening", "reading"],
        what="measures how well an adult can write English accurately and effectively on everyday and workplace topics, together with the reading and listening that written work depends on",
        construct_title="Facility in Written English",
        construct="The Spica English Writing test measures <i>facility in written English</i>: how accurately and effectively a person writes English for work, from correct words and sentences to a complete email, together with the reading and listening that written work depends on. No spoken answers are required. Writing is measured by five tasks; Reading and Listening are measured by the tasks that require understanding a written text or a spoken message before writing or choosing a reply.",
        uses=["screening applicants for roles that depend on written English, such as email and chat support, administration, documentation and reporting;", "checking the written English of employees and teams;", "measuring progress in writing at the end of training;", "giving individuals a proctored, checkable statement of their written English level (the Spica certificate, valid for 12 months)."],
        compare="an established, widely used test of written English",
    ),
    "professional": dict(
        name="Professional English", slug="Professional-English", minutes=60, skills=SKILLS,
        what="measures how well an adult can use English in all four skills in professional, workplace situations: reading workplace texts, writing emails, following spoken accounts and responding appropriately in speech",
        construct_title="Facility in Professional English",
        construct="The Spica Professional English test measures <i>facility in English for professional work</i>: how well a person understands and uses spoken and written English in the situations a professional meets at work. Alongside the core tasks (Sentence Completion, Passage Reconstruction, Dictation and Repeats), it includes workplace tasks: reading notices and reports, writing emails, choosing natural replies, answering questions about spoken accounts, responding to workplace situations and retelling a story.",
        uses=["screening applicants for professional, client-facing and office roles that require English in all four skills;", "checking the workplace English of employees and teams, including before promotion or international assignments;", "measuring progress at the end of business English training;", "giving individuals a proctored, checkable statement of their professional English level (the Spica certificate, valid for 12 months)."],
        compare="an established, widely used four-skill English test with a workplace focus",
    ),
}

# ---------------------------------------------------------------- data


def load_data():
    with psycopg.connect(os.environ["PROFILE_DB_URL"]) as conn:
        q = lambda sql, *a: conn.execute(sql, a).fetchall()  # noqa: E731
        layout = {}
        for tt in TESTS:
            first = q("SELECT id FROM exams WHERE test_type_id = %s AND purpose = 'assessment' AND is_active ORDER BY name LIMIT 1", tt)[0][0]
            layout[tt] = q(
                """SELECT ep.sort_order, ep.part_label, it.id, it.name, count(i.id), it.timer_seconds, it.skills
                   FROM exam_parts ep JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved' JOIN item_types it ON it.id = i.item_type_id
                   WHERE ep.exam_id = %s GROUP BY 1, 2, 3, 4, 6, 7 ORDER BY 1""",
                first,
            )
        banks = defaultdict(dict)
        for tt, purpose, forms, items in q(
            """SELECT e.test_type_id, e.purpose, count(DISTINCT e.id), count(i.id) FROM exams e JOIN exam_parts ep ON ep.exam_id = e.id
               JOIN items i ON i.exam_part_id = ep.id AND i.status = 'approved' WHERE e.is_active GROUP BY 1, 2"""
        ):
            banks[tt][purpose] = (forms, items)
        real = defaultdict(set)
        for tt, iid in q(
            """SELECT e.test_type_id, i.id::text FROM exams e JOIN exam_parts ep ON ep.exam_id = e.id JOIN items i ON i.exam_part_id = ep.id
               WHERE e.purpose = 'assessment' AND e.is_active AND i.status = 'approved'"""
        ):
            real[tt].add(iid)
        level_pool = {
            (lv, t): (reserved, total)
            for lv, t, reserved, total in q(
                """SELECT cefr_level, item_type_id, count(*) FILTER (WHERE pool = 'level_test'), count(*) FROM items
                   WHERE status = 'approved' AND exam_part_id IS NULL GROUP BY 1, 2"""
            )
        }
    prof = {}
    for line in open(os.path.join(PROFILE_DIR, "profile.jsonl")):
        r = json.loads(line)
        prof[r["id"]] = r
    return layout, banks, real, prof, level_pool


def word_ranges(ids, prof, types):
    """Prompt length (min–max words) by question type and level."""
    g = defaultdict(list)
    for i in ids:
        p = prof.get(i)
        if not p:
            continue
        w = p["stimulus_words"] + (p["question_words"] if TYPES.get(p["type_id"], {}).get("with_question") else 0)
        if p["type_id"] == "response_selection" or p["type_id"] == "reading_comprehension":
            w = p["stimulus_words"] + p["question_words"] + round((p.get("options") or 0) * (p.get("option_words_avg") or 0))
        g[(p["type_id"], p["cefr"])].append(w)
    out = {}
    for t in types:
        out[t] = {lv: (min(g[(t, lv)]), max(g[(t, lv)])) for lv in LEVELS if g.get((t, lv))}
    return out


def rng(a, b):
    return f"{a}" if a == b else f"{a}–{b}"


# ---------------------------------------------------------------- template blocks


class Blocks:
    """The 4 Skills document cut at every heading. b[key] is one heading and
    its text; b.full(key) also takes the h4 subsections under an h2/h3."""

    def __init__(self, body):
        self.order = []
        for p in re.split(r"(?=<h[234][^>]*>)", body):
            m = re.match(r"<h([234])[^>]*>(.*?)</h[234]>", p, re.S)
            if not m:
                continue
            title = H.unescape(re.sub(r"<[^>]+>", "", m.group(2))).strip()
            key = title.split(" ")[0] if re.match(r"^\d", title) else " ".join(title.split(" ")[:2]).rstrip(".")
            p = re.sub(r"<!--.*?-->", "", p, flags=re.S).replace("</body>", "").replace("</html>", "").rstrip()
            self.order.append((key, int(m.group(1)), p))
        self.map = {k: p for k, _, p in self.order}

    def __getitem__(self, key):
        return self.map[key]

    def __contains__(self, key):
        return key in self.map

    def full(self, key):
        i = next(n for n, (k, _, _) in enumerate(self.order) if k == key)
        out = [self.order[i][2]]
        for k, lvl, p in self.order[i + 1 :]:
            if lvl < 4:
                break
            out.append(p)
        return "\n".join(out)


def template_blocks():
    s = open(TEMPLATE).read()
    return s[: s.find("<body>")], Blocks(s[s.find("<body>") :])


# ---------------------------------------------------------------- html helpers


def table(headers, rows, caption, num_cols=()):
    def cell(tag, i, c):
        cls = ' class="n"' if i in num_cols else ""
        return f"<{tag}{cls}>{c}</{tag}>"

    h = "<table>\n  <tr>" + "".join(cell("th", i, c) for i, c in enumerate(headers)) + "</tr>\n"
    for r in rows:
        if r and r[0] == "__total__":
            h += "  <tr>" + "".join(cell("th", i, c) for i, c in enumerate(r[1:])) + "</tr>\n"
        else:
            h += "  <tr>" + "".join(cell("td", i, c) for i, c in enumerate(r)) + "</tr>\n"
    return h + f'</table>\n<div class="cap">{caption}</div>\n'


def ul(items):
    return "<ul>\n" + "".join(f"  <li>{x}</li>\n" for x in items) + "</ul>\n"


class Doc:
    """Numbers the tables as they are added."""

    def __init__(self):
        self.n = 0

    def t(self, headers, rows, caption, num_cols=()):
        self.n += 1
        return table(headers, rows, f"Table {self.n}. {caption}", num_cols)

    def shared(self, html):
        """A block from the template: its tables get the next numbers, and its
        own references to them follow."""
        mapping = {}
        for old in re.findall(r'<div class="cap">Table (\d+)\.', html):
            self.n += 1
            mapping[old] = self.n
        if not mapping:
            return html
        return re.sub(r"Table (\d+)", lambda m: f"Table {mapping.get(m.group(1), m.group(1))}", html)


# ---------------------------------------------------------------- one test


def build(tt, cfg, layout, banks, real, prof, blocks, head):
    name = cfg["name"]
    parts = []
    for sort, label, tid, tname, n, timer, skills in layout[tt]:
        spec = TYPES[tid]
        parts.append(dict(letter="ABCDEFGHIJKLMNOP"[len(parts)], label=label if tid not in ("repeats",) else "Repeats", type=tid, n=n, timer=timer, skills=[s for s in SKILLS if s in skills], spec=spec))
    total = sum(p["n"] for p in parts)
    nparts = len(parts)
    reported = [s for s in SKILLS if s in cfg["skills"]]
    per_skill = {s: sum(p["n"] for p in parts if s in p["skills"]) for s in reported}
    forms_real, items_real = banks[tt]["assessment"]
    forms_mock, items_mock = banks[tt]["mock"]
    forms_prac, items_prac = banks[tt]["practice"]
    per_form = total
    spoken = [p for p in parts if p["spec"]["answer"] == "Spoken"]
    typed = [p for p in parts if p["spec"]["answer"] == "Typed"]
    chosen = [p for p in parts if p["spec"]["answer"] == "Chosen"]
    ranges = word_ranges(real[tt], prof, [p["type"] for p in parts])
    cefr_counts = Counter(prof[i]["cefr"] for i in real[tt] if i in prof)
    D = Doc()
    sub = lambda html: html.replace("English 4 Skills Essentials", name)  # noqa: E731

    def time_of(p):
        if p["spec"].get("time_label"):
            return p["spec"]["time_label"]
        return secs(p["timer"]) or "Short answer"

    def names(ps):
        n = [p["spec"].get("name") or p["label"] for p in ps]
        return ", ".join(n[:-1]) + " and " + n[-1] if len(n) > 1 else (n[0] if n else "")

    out = [head.replace("English 4 Skills Essentials", name), "<body>\n"]
    out.append(
        f"""<div class="cover">
  <div class="kicker">Spica English Assessment</div>
  <h1>{H.escape(name)}</h1>
  <div class="sub">Test Description and Validation Summary</div>
  <div class="meta">
    {VERSION}<br>
    Sections 1–4 describe the test as delivered today. Section 5 sets out the validation programme; its result tables will be completed when the studies finish.
  </div>
</div>
"""
    )
    toc = re.search(r'<div class="toc">.*?</div>', open(TEMPLATE).read(), re.S).group(0)
    toc = toc.replace("2.5.1 Facility in Spoken and Written English", "2.5.1 " + cfg["construct_title"])
    out.append(toc + "\n")

    skill_names = [s.title() for s in reported]
    skills_text = (", ".join(skill_names[:-1]) + " and " + skill_names[-1]) if len(skill_names) > 1 else skill_names[0]
    answers_need = "a microphone, " if spoken else ""

    # 1 Introduction
    out.append(
        f"""<h2>1. Introduction</h2>
<p>The Spica {H.escape(name)} test is a web-delivered assessment that {cfg['what']}. It is intended for people aged 18 and over and takes about {cfg['minutes']} minutes. The test runs in a standard web browser, so it can be taken at any time and from any location with a computer, {answers_need}headphones or speakers and an internet connection. No human examiner is needed during the test: instructions, timing, recording and scoring are handled by the Spica platform, and the session is remotely proctored.</p>
<p>The test reports an Overall score and {NUM[len(reported)]} skill scores — {skills_text} — each on the Spica Score scale (10–90) with the corresponding level of the Common European Framework of Reference for Languages (CEFR). Results are intended to support decisions such as screening job applicants, checking the English level of employees, placing learners in training, and confirming a learner's level at the end of a course.</p>
<p>This document describes the design of the test, how its content was developed, and how scores are produced (Sections 2–4). Section 5 describes the studies that will provide evidence for the validity, reliability and fairness of the scores. The tables in Section 5 are shown with their planned layout and targets; they will be completed with observed results when the studies finish.</p>
"""
    )

    # 2.1 Design
    modes = []
    if spoken:
        modes.append(f"{NUM[len(spoken)]} require spoken answers")
    if typed:
        modes.append(f"{NUM[len(typed)]} require typed answers")
    if chosen:
        modes.append(f"{NUM[len(chosen)]} require choosing an option")
    multi = sum(1 for p in parts if len([s for s in p["skills"] if s in reported]) > 1)
    out.append(
        f"""<h2 class="section">2. Test Description</h2>
<h3>2.1 Test Design</h3>
<p>The test has {NUM.get(nparts, nparts)} tasks: {names(parts)}. {f"{NUM[multi].capitalize()} of the tasks contribute to more than one skill score, and" if multi else "Each"} each skill score draws on at least two tasks (Table {{T_SKILL}}). Using several independent tasks for each skill means that no single task, and no single question, decides a skill score; this strengthens the reliability of the scores.</p>
<p>{("Of the " + NUM.get(nparts, str(nparts)) + " tasks, " + ", ".join(modes[:-1]) + (" and " if len(modes) > 1 else "") + modes[-1] + ".").replace("tasks, one require", "tasks, one requires").replace("and one require", "and one requires")} {"Spoken tasks measure the ability to understand speech and respond intelligibly at a natural pace. " if spoken else ""}{"Typed tasks measure reading comprehension, accurate listening and the ability to produce correct written English within a time limit. " if typed else ""}{"Choice tasks measure quick understanding of spoken and written English without the need to produce language." if chosen else ""}</p>
"""
    )

    # 2.2 Administration (shared, adjusted)
    adm = D.shared(sub(blocks.full("2.2")))
    adm = adm.replace("Seven parts, each with instructions and an example, in a fixed order.", f"{NUM.get(nparts, str(nparts)).capitalize()} parts, each with instructions and an example, in a fixed order.")
    if not spoken:
        adm = adm.replace("Spoken answers are recorded through the microphone; typed answers are entered on the keyboard.", "Answers are typed on the keyboard or chosen with the mouse; no spoken answers are needed.")
        adm = adm.replace("The platform advises test takers to speak at a normal pace at a steady distance from the microphone, and to give complete answers, since very short or silent answers score low.", "The platform advises test takers to check grammar, spelling and punctuation before moving on, and to give complete answers, since very short answers score low.")
        adm = adm.replace("spoken answers are scored in the background, and the result is released once every answer has a score", "written answers are scored in the background, and the result is released once every answer has a score")
    if not typed and not chosen:
        adm = adm.replace("Spoken answers are recorded through the microphone; typed answers are entered on the keyboard.", "All answers are spoken and recorded through the microphone; no typing is needed.")
        adm = adm.replace("demonstration of how to record and type answers", "demonstration of how to record answers")
    out.append(adm + "\n")

    # 2.3 Format
    out.append(f"<h3>2.3 Test Format</h3>\n<p>The following subsections describe each of the {NUM.get(nparts, nparts)} parts and the abilities needed to answer its items. The examples below are illustrative and do not appear in the live test.</p>\n")
    for p in parts:
        sp = p["spec"]
        title = sp.get("name") or p["label"]
        out.append(f"<h4>Part {p['letter']}: {H.escape(title)}</h4>\n<p>{sp['desc'].format(time=secs(p['timer']) or 'a short time')}</p>\n<div class=\"ex\">{sp['ex']}</div>\n")
    rows = [[f"{p['letter']}. {H.escape(p['spec'].get('name') or p['label'])}", p["spec"]["hears"], p["spec"]["does"], p["spec"]["scored"]] for p in parts]
    out.append(f"<p>Table {D.n + 1} summarises what the test taker does in each part and what is scored.</p>\n")
    t2 = D.t(["Part", "Test taker hears or reads", "Test taker does", "What is scored"], rows, f"Summary of the {NUM.get(nparts, nparts)} parts")
    out.append(t2)

    # Technical requirements table is Table 1 in the shared block: keep numbering consistent.
    # 2.4 Number of items
    rows = [[p["letter"], H.escape(p["spec"].get("name") or p["label"]), p["n"], p["spec"]["answer"], time_of(p)] for p in parts]
    rows.append(["__total__", "", "Total", per_form, "", f"About {cfg['minutes']} minutes"])
    out.append(
        f"""<h3>2.4 Number of Items</h3>
<p>Each test presents {per_form} items in {NUM.get(nparts, nparts)} parts (Table {D.n + 1}). The items are drawn from Spica's secure real-test bank, which holds {NUM.get(forms_real, forms_real)} complete forms ({items_real} items) for this test. Each test taker receives items they have not seen before in any previous Spica test, arranged in the same {NUM.get(nparts, nparts)}-part layout. The selection also takes into account how often each item has been used in real tests: items that have reached their exposure limit are used last (Section 3.4).</p>
"""
        + D.t(["Part", "Task", "Number of items", "Answer", "Time per item"], rows, "Number of items presented per task", (2,))
    )

    # 2.5 Construct
    understand_heard = [p for p in parts if p["type"] in ("repeats", "sentence_builds", "conversations", "dictation", "short_answer", "passage_comprehension", "story_retelling", "response_selection", "open_questions")]
    understand_read = [p for p in parts if p["type"] in ("sentence_completion", "passage_reconstruction", "reading_comprehension", "summary_and_opinion", "reading", "speaking_situations", "email_writing", "typing")]
    para = [f"<h3>2.5 Test Construct</h3>\n<h4>2.5.1 {cfg['construct_title']}</h4>\n<p>A test needs a clear statement of what it measures (Bachman, 1990; Bachman &amp; Palmer, 1996). {cfg['construct']}</p>\n"]
    if understand_heard or understand_read:
        bits = []
        if understand_heard:
            bits.append(f"{names(understand_heard)} present spoken English, which the test taker must process in real time")
        if understand_read:
            bits.append(f"{names(understand_read)} present written English, which must be read and understood within a time limit")
        para.append(f"<p><b>Understanding.</b> {'; '.join(bits)}. Listening and reading draw on shared knowledge of vocabulary, grammar and discourse (Alderson, 2000; Buck, 2001), which is why several tasks contribute to more than one skill.</p>\n")
    if spoken:
        para.append("<p><b>Responding in speech.</b> To take part in a conversation, a speaker must follow what is said, build a response and produce it intelligibly within the short pause that normal turn-taking allows (Levelt, 1989). The spoken tasks sample these processes, from controlled tasks (repeating or building a sentence) to open tasks (answering, retelling, responding to a situation or giving an opinion).</p>\n")
    if typed:
        para.append("<p><b>Responding in writing.</b> The written tasks require accurate spelling, grammar and word choice and, in the longer tasks, the ability to organise and express information clearly in a text that meets the task.</p>\n")
    para.append("<p><b>Pace and intelligibility.</b> Every item has a time limit. People who use English fluently process it with less effort and respond within the time allowed; people who must work out each word consciously run out of time. The time limits therefore help the test separate test takers at different levels." + (" Spoken answers are judged on whether they can be understood, not on how closely they match any particular accent (Section 4.2)." if spoken else "") + "</p>\n")
    out.append("".join(para))
    hold = [p for p in parts if p["type"] in ("repeats", "sentence_builds", "dictation", "story_retelling", "passage_comprehension")]
    if hold:
        m252 = (
            f"<h4>2.5.2 The Role of Memory</h4>\n<p>Some tasks ({names(hold)}) ask the test taker to hold what they heard in mind while answering, and it could be argued that they measure memory rather than language. "
            "The sentences and passages are kept within the length that a proficient user of English holds easily, because such a user stores them as meaningful phrases rather than as separate words. "
            "A learner who has to process each word separately needs much more memory for the same content. Performance on these tasks therefore reflects language ability more than memory capacity."
            + (" Passage Reconstruction" + (" and Retell a Passage ask" if any(p["type"] == "story_retelling" for p in parts) else " asks") if any(p["type"] == "passage_reconstruction" for p in parts) else (" Retell a Passage asks" if any(p["type"] == "story_retelling" for p in parts) else ""))
            + (" for the meaning in the test taker's own words, not a word-for-word copy, so it rewards understanding rather than memorisation." if any(p["type"] in ("passage_reconstruction", "story_retelling") for p in parts) else "")
            + "</p>\n"
        )
    else:
        m252 = "<h4>2.5.2 The Role of Memory</h4>\n<p>No task asks the test taker to reproduce a sentence word for word from memory. Texts stay on screen while they are read, so the tasks measure reading, listening and writing rather than memory.</p>\n"
    out.append(m252 + sub(blocks["2.5.3"]) + "\n")
    rows = [[lv, cefr_counts.get(lv, 0), f"{round(100 * cefr_counts.get(lv, 0) / max(sum(cefr_counts.values()), 1))}%"] for lv in LEVELS]
    rows.append(["__total__", "Total", sum(cefr_counts.values()), "100%"])
    out.append(
        f"""<h4>2.5.4 Alignment with the CEFR</h4>
<p>Every item in the bank is assigned a target CEFR level when it is written, based on the CEFR descriptors for the relevant skill (Council of Europe, 2001, 2020), and is written to the length and language limits for that level. Table {D.n + 1} shows the distribution of levels in the real-test bank. The test is designed to measure most precisely from A2 to C1, the range most relevant to workplace decisions; very high and very low abilities are measured with less precision. Every real-test form contains items from A1 to C2. Formal confirmation of the score boundaries between levels by an expert panel is part of the validation programme (Section 5.6).</p>
"""
        + D.t(["Target CEFR level", "Items in the real-test bank", "Share"], rows, f"Target CEFR level of items in the real-test bank ({NUM.get(forms_real, forms_real)} forms)", (1, 2))
    )

    # 2.6 Delivery modes
    rows = [
        ["Free sample", "Try the format before a real test", "2 per part", "Mock", "Same as real test", "Practice result only"],
        ["Mock test", "Full-length rehearsal while preparing", per_form, "Mock", "Standard", "Predicted level (not a certificate)"],
        ["Real test / final assessment", "Certified measurement of the test taker's level", per_form, "Real", "Strict", "Score report and certificate"],
        ["Candidate test", "Applicant screening for an employer", per_form, "Real", "Strict by default (set by the organisation)", "Report to the employer; certificate if shared"],
    ]
    out.append(
        "<h3>2.6 Test Versions and Delivery Modes</h3>\n<p>The same test design is used in several delivery modes. Only the real test produces a certified result; the other modes help test takers become familiar with the format and prepare.</p>\n"
        + D.t(["Mode", "Purpose", "Items", "Item bank", "Proctoring", "Result"], rows, f"Delivery modes of {H.escape(name)}")
        + "<p>A real test is used up when it starts. It is returned to the test taker only if the test was stopped before any item was shown. Questions and answers from a real test are never shown to the test taker afterwards.</p>\n"
    )
    acc = sub(blocks["2.7"])
    acc = re.sub(r"<p>Planned: a published policy on accommodations.*?</p>", "<p>Test takers with a disability can be given extra time (25%, 50% or double) on every timed part. A recruiter sets it for a candidate when inviting them, and an organisation's administrator sets it for a learner; it applies to tests started from then on. A published policy on further accommodations (for example, a version without spoken answers for test takers who cannot speak) is planned.</p>", acc, flags=re.S)
    out.append(acc + "\n")

    # 3 Content
    c31 = sub(blocks["3.1"])
    c31 = re.split(r"<table>", c31)[0]
    c31 = re.sub(r"<p>Table \d+ shows how the length of prompts.*?</p>\s*$", "", c31.strip(), flags=re.S)
    rows = []
    for p in parts:
        r = ranges.get(p["type"], {})
        if not r:
            continue
        rows.append([f"{H.escape(p['spec'].get('name') or p['label'])} ({p['spec']['length']})", *[rng(*r[lv]) if lv in r else "—" for lv in LEVELS]])
    out.append(
        '<h2 class="section">3. Content Design and Development</h2>\n'
        + c31.replace('<h2 class="section">3. Content Design and Development</h2>', "")
        + f"\n<p>Table {D.n + 1} shows how the length of prompts rises with the target level in the real-test bank. Length is one of several features controlled by level; vocabulary range, grammatical complexity and the amount of inference required also rise.</p>\n"
        + D.t(["Task (what is counted)", *LEVELS], rows, f"Prompt length in words by task and target level (real-test bank, {items_real} items)")
    )
    c32 = sub(blocks["3.2"])
    out.append(c32 + "\n")
    keys = [f"{p['spec'].get('name') or p['label']}: {p['spec']['key'].split(': ', 1)[1]}" for p in parts]
    out.append("<h4>Answer keys</h4>\n<p>Each task has a defined answer key, written with the item and confirmed in blind review:</p>\n" + ul(dict.fromkeys(keys)))
    out.append(sub(blocks["3.3"]) + "\n" + sub(blocks["3.3.1"]) + "\n" + sub(blocks["3.3.2"]) + "\n")
    rows = [["Practice", "Practice tests in the learning area", forms_prac, items_prac], ["Mock", "Mock tests and the free sample of the real test", forms_mock, items_mock], ["Real", "Real tests, final assessments and candidate tests", forms_real, items_real]]
    c34 = sub(blocks["3.4"])
    out.append(
        "<h3>3.4 Item Banks and Test Security</h3>\n<p>Spica keeps separate item banks for different purposes, so that practising for the test never exposes the items used to measure it (Table "
        + str(D.n + 1)
        + ").</p>\n"
        + D.t(["Bank", "Used for", "Forms", "Items"], rows, f"Item banks for {H.escape(name)}", (2, 3))
        + re.search(r"<p>Further security measures.*?</p>", c34, re.S).group(0)
        + "\n"
    )
    rows = []
    for p in parts:
        lv = sorted({prof[i]["cefr"] for i in real[tt] if i in prof and prof[i]["type_id"] == p["type"]}, key=LEVELS.index)
        span = f"{lv[0]}–{lv[-1]}" if lv else "—"
        sk = " and ".join(s for s in [x.title() for x in p["skills"] if x in reported])
        rows.append([f"{p['letter']}. {H.escape(p['spec'].get('name') or p['label'])}", span, f"{sk}, {'all levels' if span == 'A1–C2' else span.replace('–', ' to ')}"])
    out.append(
        f"<h3>3.5 Form Assembly</h3>\n<p>Every real-test form follows the same blueprint: the same {NUM.get(nparts, nparts)} parts in the same order, the same number of items per part, and a similar spread of target levels within each part. Table {D.n + 1} shows the range of levels covered by each part. Within each part, items move from easier to harder.</p>\n"
        + D.t(["Part", "Levels covered", "Main purpose in the level estimate"], rows, "Levels covered by each part")
    )
    out.append(sub(blocks.full("3.6")) + "\n")

    # 4 Scores
    desc = {
        "speaking": "reflects the ability to produce clear, intelligible spoken English: saying sentences accurately and fluently and giving relevant spoken answers.",
        "listening": "reflects the ability to understand spoken English at a conversational pace, from single sentences to conversations and short accounts, and to pick out specific information.",
        "reading": "reflects the ability to understand written sentences and texts on everyday and workplace topics within a time limit.",
        "writing": "reflects the ability to produce accurate written English: correct words and spelling, correct sentences and clear texts that meet the task.",
    }
    w = round(100 / len(reported))
    weights = [[s.title(), f"{w}%" if len(reported) != 3 else "One third"] for s in reported] + [["__total__", "Overall", "100%"]]
    t_w = D.n + 1
    sc = f"""<h2 class="section">4. Score Reporting</h2>
<h3>4.1 Scores and Weights</h3>
<p>The score report contains an Overall score and {NUM[len(reported)]} skill scores, each reported on the Spica Score scale from 10 to 90 together with its CEFR level.</p>
{ul([f"<b>Overall</b> reflects the ability to understand and respond in English on everyday and workplace topics, at a functional pace and in intelligible English. It is the equally weighted average of the {NUM[len(reported)]} skill scores."] + [f"<b>{s.title()}</b> {desc[s]}" for s in reported])}"""
    sc += D.t(["Skill score", "Weight in Overall"], weights, "Weight of each skill score in the Overall score")
    sc += f"<p>The {NUM[len(reported)]} skills are weighted equally, as in every Spica test. Because the skills are weighted rather than the items, a skill does not count for more simply because more items contribute to it. Table {D.n + 1} shows which tasks contribute to each skill score.</p>\n"
    rows = [[f"{p['letter']}. {H.escape(p['spec'].get('name') or p['label'])}", *["✓" if s in p["skills"] else "" for s in reported], p["n"]] for p in parts]
    rows.append(["__total__", "Items per skill", *[per_skill[s] for s in reported], per_form])
    t_skill = D.n + 1
    sc += D.t(["Task", *[s.title() for s in reported], "Items"], rows, "Tasks contributing to each skill score", tuple(range(1, len(reported) + 2)))
    out.append(sc)

    # 4.2 scoring
    kinds = {p["spec"]["scoring"] for p in parts}
    s42 = ["<h3>4.2 How Responses Are Scored</h3>"]
    if kinds & {"spoken", "spoken_rubric"}:
        ctl = []
        rep = [p for p in parts if p["type"] in ("repeats", "sentence_builds")]
        if rep:
            ctl.append(f"the words and word order for {names(rep)}")
        if any(p["type"] == "reading" for p in parts):
            ctl.append("the text for Read Aloud")
        qs = [p for p in parts if p["type"] in ("conversations", "short_answer", "passage_comprehension")]
        if qs:
            ctl.append(f"the accepted answers for {names(qs)}")
        opn = [p for p in parts if p["spec"]["scoring"] == "spoken_rubric"]
        s42.append("<p><b>Spoken responses.</b> Each recorded answer is converted to text by automatic speech recognition that has been instructed to transcribe speakers of any accent and not to \"correct\" what was said. The transcript is then scored for content" + (": against the expected answer for " + ("controlled tasks (" + "; ".join(ctl) + ")") if ctl else "") + (f"{', and' if ctl else ':'} with a fixed rubric for {names(opn)} (relevance and development of the answer, and grammar and vocabulary for the item's level)" if opn else "") + ". The recording is also scored for delivery, which covers how easily the speech can be understood (pronunciation) and how smoothly it flows (fluency), and for speaking rate. A spoken answer counts as correct only when its content meets the standard for the item's level, its pronunciation and fluency are each at least 0.4 on a 0–1 scale, and, for answers of four or more words, its rate is between 70 and 220 words per minute. Accent is not treated as an error; only intelligibility counts. A recording that contains no speech scores zero.</p>")
    typed_bits = []
    if "dictation" in kinds:
        typed_bits.append("Dictation answers are compared with the sentence heard, after ignoring capital letters, punctuation, hyphens and differences between standard spelling varieties, and are scored word by word: each word missed, wrong or added lowers the score.")
    if "completion" in kinds:
        typed_bits.append("Sentence Completion answers are compared with a list of accepted words for each item, built during item development and blind review.")
    if "typing" in kinds:
        typed_bits.append("Typing is compared word by word with the passage shown: the score is the share of the passage typed correctly within the time.")
    if "rubric" in kinds:
        rub = [names([p for p in parts if p["spec"]["scoring"] == "rubric"])]
        typed_bits.append(f"{rub[0]} answers are scored by an automated writing scorer using a fixed rubric for each task: whether the answer does what the task asks (key points kept, points covered, or summary and opinion given), whether it meets the length required, and whether grammar and vocabulary meet the standard for the item's level.")
    if typed_bits:
        s42.append("<p><b>Typed responses.</b> " + " ".join(typed_bits) + " All typed scoring accepts British, American, Indian and other standard spellings.</p>")
    if "choice" in kinds:
        s42.append(f"<p><b>Chosen responses.</b> {names(chosen)} answers are scored right or wrong against the one correct option.</p>")
    s42.append(f"<p><b>From items to skill scores.</b> Each item has a target CEFR level, and the standard an answer must meet rises with that level (Table {D.n + 1}). For each skill, the platform finds the highest CEFR level at which the test taker answered at least the required share of that skill's items correctly, with at least two items at the level. That level places the skill in a band on the Spica Score scale, and the share of all the skill's items answered correctly places the score within the band. Items that were not answered count as incorrect.</p>")
    s42.append(D.t(["Item's target level", *LEVELS], [["Standard an answer must meet (0–1)", "0.60", "0.60", "0.65", "0.70", "0.85", "0.95"]], "Minimum content score for an answer to count as correct, by item level"))
    s42.append("<p>When some answers are still being scored, the result is shown as \"being scored\" and no level or certificate is issued until every answer has a score.</p>")
    out.append("\n".join(s42) + "\n")

    s43 = D.shared(sub(blocks["4.3"]).replace("Scores are reported from 20 to 90.", "Scores are reported from 10 to 90."))
    t_scale = D.n
    out.append(s43)
    # Worked example for this test's skills
    example = {"speaking": ("B2", 68), "listening": ("B1", 60), "reading": ("B1", 55), "writing": ("B2", 62)}
    band = {"A1": (20, 29), "A2": (30, 39), "B1": (40, 54), "B2": (55, 69), "C1": (70, 79), "C2": (80, 90)}
    rows, scores = [], []
    for s in reported:
        lv, pct = example[s]
        lo, hi = band[lv]
        val = round(lo + (hi - lo) * pct / 100)
        scores.append(val)
        rows.append([s.title(), lv, f"{lo}–{hi}", f"{pct}%", f"{lo} + ({hi} − {lo}) × {pct / 100:.2f}", val])
    overall = round(sum(scores) / len(scores))
    ov_level = next(l for l, (a, b) in band.items() if a <= overall <= b)
    rows.append(["__total__", "Overall", "", f"({' + '.join(map(str, scores))}) ÷ {len(scores)}", "", "", f"{overall} ({ov_level})"])
    out.append("<h4>Worked example</h4>\n<p>Table " + str(D.n + 1) + " shows how a set of results becomes a score report (illustrative figures).</p>\n" + D.t(["Skill", "Highest level sustained", "Band", "Skill items correct", "Calculation", "Skill score"], rows, "Worked example of score calculation (illustrative figures)", (5,)))
    out.append(D.shared(sub(blocks["4.4"])) + "\n")
    s45 = sub(blocks["4.5"]).replace("the four skill scores and levels", f"the {NUM[len(reported)]} skill scores and levels")
    if not spoken:
        s45 = s45.replace("; and, for spoken answers, the recording with its transcript, so that a recruiter can hear how the candidate speaks", "")
    out.append(s45 + "\n" + sub(blocks.full("4.6")) + "\n" + sub(blocks.full("4.7")) + "\n" + sub(blocks.full("4.8")) + "\n")
    out.append(f"<h3>4.9 Score Use</h3>\n<p>Scores from the {H.escape(name)} test are suitable for:</p>\n" + ul(cfg["uses"]) + re.search(r"<p>The test is not designed for.*?</p>", blocks["4.9"], re.S).group(0) + "\n")

    # 5 Validation (shared, with this test's skills in the tables)
    def skill_rows(cols, first="Overall"):
        return [[first, *cols]] + [[s.title(), *cols] for s in reported]

    v = []
    v.append(sub(blocks["5."]) if "5." in blocks else "")
    v.append(sub(blocks["5.1"]).replace("covering levels A1 to C1", "covering levels A1 to C2").replace("an established English test", "an established English test of the same skills"))
    v.append(sub(blocks["5.2"]))
    v.append("<h4>5.2.1 Descriptive Statistics</h4>\n<p>Table " + str(D.n + 1) + " will report the mean, standard deviation and range of the Overall and skill scores for the main sample, to show that scores spread across the scale without a floor or ceiling effect.</p>\n" + D.t(["Score", "N", "Mean", "SD", "Min", "Max"], [[r[0], '<span class="tbc-cell">to be completed</span>', "", "", "", ""] for r in skill_rows([""])], "Descriptive statistics for the validation sample"))
    v.append(D.shared(sub(blocks["5.2.2"])))
    v.append("<h4>5.2.3 Test Reliability</h4>\n" + re.search(r"<p>Reliability will be estimated.*?</p>", blocks["5.2.3"], re.S).group(0) + "\n" + D.t(["Score", "Split-half (machine)", "Split-half (human)", "Test–retest", "Target"], [["Overall", "—", "—", "—", "≥ 0.90"]] + [[s.title(), "—", "—", "—", "≥ 0.80"] for s in reported], "Reliability estimates (to be completed)") + re.search(r"<p>Forms will be considered equivalent.*?</p>", blocks["5.2.3"], re.S).group(0) + "\n")
    hdrs = [s.title() for s in reported]
    corr_rows = [[s, *["—" if s == t else "" for t in hdrs], ""] for s in hdrs]
    v.append(f"<h4>5.2.4 Dimensionality: Correlations Among Skill Scores</h4>\n<p>The {NUM[len(reported)]} skill scores are expected to correlate moderately to strongly with each other, because they share underlying language knowledge, but not so highly that they measure the same thing. Table {D.n + 1} will report these correlations. Correlations between about 0.60 and 0.85 would support reporting separate skill scores alongside the Overall score.</p>\n" + D.t(["", *hdrs, "Overall"], corr_rows, "Correlations among skill scores (to be completed)"))
    mh_rows = [["Overall", "—", "—", "—", "r ≥ 0.85"]] + [[s.title(), "—", "—", "—", "r ≥ 0.80; QWK ≥ 0.70"] for s in reported if s in ("speaking", "writing")]
    v.append("<h4>5.2.5 Machine Accuracy</h4>\n" + re.search(r"<p>Spoken and written answers are scored automatically.*?</p>", blocks["5.2.5"], re.S).group(0).replace("Spoken and written answers", "Spoken answers" if not typed else ("Written answers" if not spoken else "Spoken and written answers")).replace("the spoken and written answers", "the spoken answers" if not typed else ("the written answers" if not spoken else "the spoken and written answers")) + "\n" + D.t(["Score", "Machine vs. human (r)", "Human vs. human (r)", "Machine vs. human (QWK)", "Target"], mh_rows, "Agreement between machine and human scores (to be completed)") + (re.search(r"<p>This study will also check speaking scores.*?</p>", blocks["5.2.5"], re.S).group(0) if spoken else "") + "\n")
    for key in ["5.2.6", "5.2.7", "5.3"]:
        b = sub(blocks[key]).replace("all six real forms", f"all {NUM.get(forms_real, forms_real)} real forms").replace("Strictly increasing from A1 to C1", "Strictly increasing from A1 to C2")
        v.append(D.shared(b))
    v.append(D.shared(sub(blocks.full("5.4")).replace("an established, widely used four-skill English test", cfg["compare"])))
    b55 = sub(blocks.full("5.5"))
    if not spoken:
        b55 = b55.replace("Spica already runs a fairness check of speaking scores by first language on its live data; the study will extend it to all items and groups.", "The study will check all items and groups.")
    v.append(D.shared(b55))
    v.append(sub(blocks["5.6"]).replace("(Table 12)", f"(Table {t_scale})"))
    v.append(sub(blocks["5.7"]))
    v.append(D.shared(sub(blocks["5.8"])))
    out.append("\n".join(v) + "\n")

    # 6 Conclusions
    out.append(
        f"""<h2 class="section">6. Conclusions</h2>
<p>The Spica {H.escape(name)} test measures {cfg['construct_title'][0].lower() + cfg['construct_title'][1:]} through {NUM.get(nparts, nparts)} tasks and {per_form} items in about {cfg['minutes']} minutes. Each skill score draws on several independent tasks; the items are written to CEFR-based specifications, checked automatically and by blind review, and drawn from a secure real-test bank that is kept separate from practice material.{" Spoken answers are scored on intelligibility rather than accent" + (", and all standard spellings of English are accepted." if typed else ".") if spoken else " All standard spellings of English are accepted."} Real tests are proctored, flagged sessions are reviewed by people, and certificates can be checked publicly.</p>
<p>The validation programme in Section 5 will provide the evidence needed to support the use of scores for hiring, workforce assessment and training decisions: reliability, agreement with trained examiners, separation of known groups, relation to other measures, and fairness across groups. This document will be updated with the results as each stage is completed.</p>
"""
    )
    out.append(sub(blocks["7."]) + "\n" + D.shared(sub(blocks["Appendix A"])) + "\n")

    # Appendix B
    b = sub(blocks.full("Appendix B"))
    b = b.replace("familiar with the seven parts", f"familiar with the {NUM.get(nparts, nparts)} parts")
    if not any(p["type"] == "passage_reconstruction" for p in parts):
        b = re.sub(r"<li>In Passage Reconstruction.*?</li>\s*", "", b, flags=re.S)
    if not spoken:
        b = re.sub(r"<li>Speak clearly at a normal pace.*?</li>\s*", "", b, flags=re.S)
        b = b.replace("Results usually appear within minutes; spoken answers may take a little longer to score.", "Results usually appear within minutes; written answers may take a little longer to score.")
    if not typed:
        b = re.sub(r"<li>In typed answers.*?</li>\s*", "", b, flags=re.S)
    out.append(b + "\n")

    # Appendix C
    rows = []
    for p in parts:
        r = ranges.get(p["type"], {})
        allw = [x for lo_hi in r.values() for x in lo_hi]
        wr = rng(min(allw), max(allw)) if allw else "—"
        st, resp, key, scoring = p["spec"]["spec"]
        rows.append([H.escape(p["spec"].get("name") or p["label"]), st.format(w=wr), resp, time_of(p), key, scoring, ", ".join(SK[s] for s in p["skills"] if s in reported)])
    out.append('<h2 class="section">Appendix C. Item Specification Summary</h2>\n' + D.t(["Task", "Stimulus", "Response", "Time", "Key", "Scoring", "Skills"], rows, "Item specification summary (S = Speaking, L = Listening, R = Reading, W = Writing)"))
    out.append(sub(blocks.full("8.")) + "\n</body>\n</html>\n")

    doc = "".join(out)
    doc = doc.replace("{T_SKILL}", str(t_skill))
    if not any(p["type"] == "conversations" for p in parts):
        doc = no_conversations(doc)
    caps = [int(x) for x in re.findall(r'<div class="cap">Table (\d+)\.', doc)]
    assert caps == list(range(1, len(caps) + 1)), f"{name}: tables numbered {caps}"
    return doc


# ---------------------------------------------------------------- level tests

LEVEL_BLUEPRINT = [("reading", 3), ("repeats", 4), ("short_answer", 3), ("response_selection", 4), ("reading_comprehension", 4), ("sentence_completion", 5), ("dictation", 4), ("email_writing", 1)]
PASS_OVERALL, PASS_SKILL, RETAKE_DAYS = 70, 50, 7


def build_level(blocks, head, prof, level_pool, type_info):
    name = "Level Tests (A1–C2)"
    D = Doc()
    sub = lambda html: html.replace("English 4 Skills Essentials", "Level Tests")  # noqa: E731
    parts = []
    for i, (tid, n) in enumerate(LEVEL_BLUEPRINT):
        timer, skills, _ = type_info[tid]
        parts.append(dict(letter="ABCDEFGH"[i], label=TYPES[tid].get("name") or type_info[tid][2], type=tid, n=n, timer=timer, skills=[x for x in SKILLS if x in skills], spec=TYPES[tid]))
    total = sum(p["n"] for p in parts)
    per_skill = {sk: sum(p["n"] for p in parts if sk in p["skills"]) for sk in SKILLS}
    title = lambda p: H.escape(p["spec"].get("name") or p["label"])  # noqa: E731
    names = lambda ps: ", ".join(title(p) for p in ps[:-1]) + " and " + title(ps[-1])  # noqa: E731
    time_of = lambda p: secs(p["timer"]) or "Short answer"  # noqa: E731
    pool_ids = {i for i, r in prof.items() if r.get("_reserved")}
    ranges = word_ranges(pool_ids, prof, [p["type"] for p in parts])

    out = [head.replace("English 4 Skills Essentials", name), "<body>\n"]
    out.append(f"""<div class="cover">
  <div class="kicker">Spica English Assessment</div>
  <h1>Level Tests (A1–C2)</h1>
  <div class="sub">Test Description and Validation Summary</div>
  <div class="meta">
    {VERSION}<br>
    Sections 1–4 describe the tests as delivered today. Section 5 sets out the validation programme; its result tables will be completed when the studies finish.
  </div>
</div>
""")
    toc = re.search(r'<div class="toc">.*?</div>', open(TEMPLATE).read(), re.S).group(0)
    for a, b in [("2.4 Number of Items", "2.4 Number of Items and Question Pools"), ("2.5.1 Facility in Spoken and Written English", "2.5.1 Reaching a CEFR Level"), ("2.6 Test Versions and Delivery Modes", "2.6 Delivery"), ("3.4 Item Banks and Test Security", "3.4 Question Pools and Test Security"), ("3.5 Form Assembly", "3.5 Test Assembly"), ("4.1 Scores and Weights", "4.1 Results and Skills"), ("4.3 The Spica Score Scale", "4.3 Pass Rules"), ("4.7 Retakes, Certificates and Score Reviews", "4.7 Retakes and Score Reviews"), ("5.2.4 Dimensionality: Correlations Among Skill Scores", "5.2.4 Dimensionality: Correlations Among Skill Results"), ("5.2.7 Classification Consistency", "5.2.7 Decision Consistency"), ("5.6 Standard Setting", "5.6 Confirming the Pass Marks")]:
        toc = toc.replace(a, b)
    out.append(toc + "\n")

    out.append(f"""<h2>1. Introduction</h2>
<p>The Spica Level Tests are six web-delivered tests, one for each CEFR level from A1 to C2. Each test answers one question: has this person reached the chosen level in all four skills? Instead of placing a person anywhere on the scale, every question in a level test is set at the one level chosen before the test. Each test has {total} questions in eight parts and takes about 35 minutes. The tests are intended for people aged 18 and over and run in a standard web browser on a computer with a microphone, headphones or speakers and an internet connection. No human examiner is needed during the test, and the session is remotely proctored.</p>
<p>The result is <b>passed</b> or <b>not passed</b> for the chosen level, with the share of questions answered correctly in each skill — Speaking, Listening, Reading and Writing. A level test does not produce a Spica Score or a certificate; certificates come only from the full real tests. Level tests are used to confirm a level after training, to check a minimum level for a role, and to let learners check that they are ready before moving up a level or taking a full test.</p>
<p>This document describes the design of the tests, how their content was developed, and how results are produced (Sections 2–4). Section 5 describes the studies that will provide evidence for the validity, reliability and fairness of the pass and not-passed decisions. The tables in Section 5 are shown with their planned layout and targets; they will be completed with observed results when the studies finish.</p>
""")
    spoken = [p for p in parts if p["spec"]["answer"] == "Spoken"]
    typed = [p for p in parts if p["spec"]["answer"] == "Typed"]
    chosen = [p for p in parts if p["spec"]["answer"] == "Chosen"]
    out.append(f"""<h2 class="section">2. Test Description</h2>
<h3>2.1 Test Design</h3>
<p>Each level test has eight tasks: {names(parts)}. The design is the same at every level; only the level of the questions changes. Each skill result draws on at least two tasks (Table {{T_SKILL}}), so that no single task, and no single question, decides whether a skill reaches the level.</p>
<p>Of the eight tasks, {NUM[len(spoken)]} require spoken answers, {NUM[len(typed)]} require typed answers and {NUM[len(chosen)]} require choosing an option. Together they cover the four skills with the kinds of tasks used in Spica's full tests, in a shorter test focused on a single level.</p>
""")
    adm = D.shared(sub(blocks.full("2.2"))).replace("Seven parts, each with instructions and an example, in a fixed order.", "Eight parts, each with instructions and an example, in a fixed order.")
    adm = adm.replace("in certified mode, compares", "compares")
    out.append(adm + "\n")
    out.append("<h3>2.3 Test Format</h3>\n<p>The following subsections describe each of the eight parts and the abilities needed to answer its items. Every question in a level test is at the chosen level; the examples below are at different levels, are illustrative and do not appear in the live tests.</p>\n")
    for p in parts:
        out.append(f"<h4>Part {p['letter']}: {title(p)}</h4>\n<p>{p['spec']['desc'].format(time=secs(p['timer']) or 'a short time')}</p>\n<div class=\"ex\">{p['spec']['ex']}</div>\n")
    out.append(f"<p>Table {D.n + 1} summarises what the test taker does in each part and what is scored.</p>\n")
    out.append(D.t(["Part", "Test taker hears or reads", "Test taker does", "What is scored"], [[f"{p['letter']}. {title(p)}", p["spec"]["hears"], p["spec"]["does"], p["spec"]["scored"]] for p in parts], "Summary of the eight parts"))
    rows = [[p["letter"], title(p), p["n"], p["spec"]["answer"], time_of(p)] for p in parts] + [["__total__", "", "Total", total, "", "About 35 minutes"]]
    pool_rows = []
    for lv in LEVELS:
        reserved = sum(level_pool.get((lv, t), (0, 0))[0] for t, _ in LEVEL_BLUEPRINT)
        bank = sum(level_pool.get((lv, t), (0, 0))[1] for t, _ in LEVEL_BLUEPRINT)
        pool_rows.append([lv, reserved, reserved // total, bank])
    t_items, t_pool = D.n + 1, D.n + 2
    out.append(f"""<h3>2.4 Number of Items and Question Pools</h3>
<p>Each level test presents {total} questions in eight parts (Table {D.n + 1}), all at the chosen level. The questions are chosen when the test starts: first from a pool written only for level tests and never used anywhere else, then from Spica's wider question bank at that level, always preferring questions the test taker has not seen before (Section 3.5). Table {D.n + 2} shows the size of the pools at each level.</p>
""" + D.t(["Part", "Task", "Number of items", "Answer", "Time per item"], rows, "Number of items presented per task", (2,))
        + D.t(["Level", "Questions written only for level tests", "Complete tests from that pool", "Questions of these types in the wider bank"], pool_rows, "Question pools for each level test", (1, 2, 3)))

    out.append(f"""<h3>2.5 Test Construct</h3>
<h4>2.5.1 Reaching a CEFR Level</h4>
<p>A test needs a clear statement of what it measures (Bachman, 1990; Bachman &amp; Palmer, 1996). A Spica level test measures whether a person can <i>do what the CEFR describes at one level, in all four skills</i>: understand spoken and written English of that level's difficulty, and respond in speech and writing to the standard expected at that level (Council of Europe, 2001, 2020). Because every question is at the same level, the test gathers more evidence at that one point of the scale than a test spread across all levels, which makes it efficient for a yes-or-no decision.</p>
<p><b>Understanding.</b> Repeats, Give a Short Answer, Response Selection and Dictation present spoken English; Read Aloud, Reading Comprehension and Sentence Completion present written English. <b>Responding.</b> Read Aloud, Repeats and Give a Short Answer require spoken answers judged on content and intelligibility; Sentence Completion, Dictation and Email Writing require accurate written English, from single words to a complete email.</p>
<p><b>Pace and intelligibility.</b> Every item has a time limit suited to the task, as in the full tests. Spoken answers are judged on whether they can be understood, not on how closely they match any particular accent (Section 4.2).</p>
<h4>2.5.2 The Role of Memory</h4>
<p>Repeats and Dictation ask the test taker to hold a sentence in mind while repeating or typing it. The sentences are kept within the length that a proficient user at the level holds easily, because such a user stores them as meaningful phrases rather than as separate words. Performance on these tasks therefore reflects language ability more than memory capacity.</p>
""" + sub(blocks["2.5.3"]) + f"""
<h4>2.5.4 Alignment with the CEFR</h4>
<p>Every question in the pools is assigned a target CEFR level when it is written, based on the CEFR descriptors for the relevant skill, and is written to the length and language limits for that level (Table {D.n + 1} in Section 3.1). A level test uses questions of only one level, and the standard an answer must meet is the standard for that level (Section 4.2). Whether the pass marks match the CEFR's own description of each level is part of the validation programme (Section 5.6).</p>
""")
    out.append("<h3>2.6 Delivery</h3>\n<p>Level tests are taken in the same proctored mode as Spica's real tests: identity and camera checks, screen sharing, and review of flagged sessions by a person (Section 4.6). A level test is used up when it starts, and is returned only if it was stopped before any question was shown. Questions and answers are not shown afterwards. Learners can prepare at the chosen level with Practice Modules, which use different questions.</p>\n")
    acc = sub(blocks["2.7"])
    acc = re.sub(r"<p>Planned: a published policy on accommodations.*?</p>", "<p>Test takers with a disability can be given extra time (25%, 50% or double) on every timed part, set by their organisation's administrator. A published policy on further accommodations is planned.</p>", acc, flags=re.S)
    out.append(acc + "\n")

    c31 = re.split(r"<table>", sub(blocks["3.1"]))[0]
    c31 = re.sub(r"<p>Table \d+ shows how the length of prompts.*?</p>\s*$", "", c31.strip(), flags=re.S)
    rows = [[f"{title(p)} ({p['spec']['length']})", *[rng(*ranges[p['type']][lv]) if lv in ranges.get(p['type'], {}) else "—" for lv in LEVELS]] for p in parts if ranges.get(p["type"])]
    out.append(c31 + f"\n<p>Table {D.n + 1} shows how the length of prompts rises with the level in the pool written for level tests. Length is one of several features controlled by level; vocabulary range, grammatical complexity and the amount of inference required also rise.</p>\n" + D.t(["Task (what is counted)", *LEVELS], rows, "Prompt length in words by task and level (questions written for level tests)"))
    out.append(sub(blocks["3.2"]) + "\n<h4>Answer keys</h4>\n<p>Each task has a defined answer key, written with the item and confirmed in blind review:</p>\n" + ul([f"{title(p)}: {p['spec']['key'].split(': ', 1)[1]}" for p in parts]))
    out.append(sub(blocks["3.3"]) + "\n" + sub(blocks["3.3.1"]) + "\n" + sub(blocks["3.3.2"]) + "\n")
    out.append(f"""<h3>3.4 Question Pools and Test Security</h3>
<p>Each level has its own pool of questions written only for level tests: enough for four complete tests at each level (Table {t_pool}), never used in practice, mock or real tests. When that pool runs short for a test taker, questions of the same type and level come from Spica's wider question bank, which is also used for Practice Modules. Questions in the real-test forms of the full tests are never used in level tests.</p>
<p>Further security measures: each test taker receives questions they have not seen before wherever possible; every use of a question in a proctored test is counted, and questions that reach their exposure limit are used last; test takers see their results but not the questions or the correct answers; and the test is proctored (Section 4.6).</p>
<h3>3.5 Test Assembly</h3>
<p>A level test is put together when it starts, following a fixed blueprint (Table {t_items}): the same eight parts in the same order, with the same number of questions in each part, all at the chosen level. For each part, the platform takes questions in this order: questions written only for level tests; then questions the test taker has not seen; and, among those, questions that have not reached their exposure limit. Within these rules the choice is random, so two test takers, or one test taker on a second attempt, see a different set of questions.</p>
""")
    out.append(sub(blocks.full("3.6")) + "\n")

    rows = [[f"{p['letter']}. {title(p)}", *["✓" if x in p["skills"] else "" for x in SKILLS], p["n"]] for p in parts] + [["__total__", "Questions per skill", *[per_skill[x] for x in SKILLS], total]]
    t_skill = D.n + 1
    out.append(f"""<h2 class="section">4. Score Reporting</h2>
<h3>4.1 Results and Skills</h3>
<p>A level test reports, for the chosen level, the share of questions answered correctly in each of the four skills and overall, and the decision: passed or not passed. The overall share is the equally weighted average of the four skill shares, as in every Spica test. Table {t_skill} shows which tasks contribute to each skill.</p>
""" + D.t(["Task", "Speaking", "Listening", "Reading", "Writing", "Items"], rows, "Tasks contributing to each skill result", (1, 2, 3, 4, 5)))
    out.append(f"""<h3>4.2 How Responses Are Scored</h3>
<p><b>Spoken responses.</b> Each recorded answer is converted to text by automatic speech recognition that has been instructed to transcribe speakers of any accent and not to "correct" what was said. The transcript is scored for content against the expected answer (the text for Read Aloud, the sentence for Repeats, the accepted answers for Give a Short Answer). The recording is also scored for pronunciation, fluency and speaking rate. A spoken answer counts as correct only when its content meets the standard for the level, its pronunciation and fluency are each at least 0.4 on a 0–1 scale, and, for answers of four or more words, its rate is between 70 and 220 words per minute. Accent is not treated as an error; only intelligibility counts.</p>
<p><b>Typed responses.</b> Dictation answers are compared word by word with the sentence heard, after ignoring capital letters, punctuation and differences between standard spelling varieties. Sentence Completion answers are compared with a list of accepted words. Email Writing answers are scored by an automated writing scorer using a fixed rubric: whether the email covers every point asked for, meets the length required (at least 100 words), and uses grammar and vocabulary of the level's standard.</p>
<p><b>Chosen responses.</b> Response Selection and Reading Comprehension answers are scored right or wrong against the one correct option.</p>
<p><b>The standard for the level.</b> Because every question is at the chosen level, one standard applies to every answer in the test (Table {D.n + 1}). A question that was not answered counts as incorrect. When some answers are still being scored, the result is shown as "being scored" until every answer has a score.</p>
""" + D.t(["Level of the test", *LEVELS], [["Standard an answer must meet (0–1)", "0.60", "0.60", "0.65", "0.70", "0.85", "0.95"]], "Minimum content score for an answer to count as correct, by level"))
    out.append(f"""<h3>4.3 Pass Rules</h3>
<p>A test taker passes a level test when both of these are true:</p>
<ul><li>at least <b>{PASS_OVERALL}%</b> of all questions are answered correctly (the overall share); and</li><li>at least <b>{PASS_SKILL}%</b> of the questions in <b>every</b> skill are answered correctly.</li></ul>
<p>The second rule stops a strong result in some skills from hiding a skill that has not reached the level. Organisations can set their own pass marks in their assessment settings; the values above are Spica's defaults. They are design values and will be reviewed by an expert panel (Section 5.6).</p>
<h4>Worked example</h4>
<p>Table {D.n + 1} shows two illustrative B1 results.</p>
""" + D.t(["Result", "Speaking", "Listening", "Reading", "Writing", "Overall", "Decision"], [["Test taker 1", "80%", "73%", "75%", "70%", "75%", "Passed"], ["Test taker 2", "90%", "87%", "83%", "40%", "75%", "Not passed: Writing below 50%"]], "Worked example of the pass rules (illustrative figures)"))
    out.append(D.shared(sub(blocks["4.4"])) + "\n")
    out.append("""<h3>4.5 Score Reports</h3>
<p>Test takers see the decision (passed or not passed) for the chosen level and the share of questions answered correctly in each skill, with advice on which skills to work on. The questions and correct answers are not shown. Organisations see the same results for each learner, with the integrity status of the session (clear, under review, cleared or violation), and can follow the results of a group. A level test does not produce a certificate or a Spica Score.</p>
""" + sub(blocks.full("4.6")) + f"""
<h3>4.7 Retakes and Score Reviews</h3>
<ul>
  <li>Retakes: after a level test that was not passed, the next level test at the same level opens {RETAKE_DAYS} days later. Each attempt uses questions the test taker has not seen where possible.</li>
  <li>Score reviews: a test taker can request a review once for each result. A member of staff examines the answers and the session, and can confirm the result, change it, or offer a new attempt.</li>
  <li>No certificate is issued from a level test. A test taker who wants a certified level takes one of Spica's full real tests.</li>
</ul>
""" + sub(blocks.full("4.8")) + """
<h3>4.9 Score Use</h3>
<p>Level test results are suitable for:</p>
<ul>
  <li>confirming that a learner has reached a level at the end of a course or training programme;</li>
  <li>checking whether employees or applicants meet a minimum level for a role;</li>
  <li>letting learners check that they are ready before moving up a level or taking a full test.</li>
</ul>
<p>A level test gives a decision about one level, not a placement on the whole scale: a test taker who does not pass B2 may still be at B1, and one who passes B1 may already be at B2. Use English Placement or another full Spica test to find a person's level. Level test results are not certificates and are not designed for immigration, visa or university admission decisions.</p>
""")

    v = [sub(blocks["5."]).replace("the English 4 Skills Essentials test", "the Level Tests").replace("the Level Tests test", "the Level Tests")]
    v.append(sub(blocks["5.1"]).replace("covering levels A1 to C1", "with at least 150 test takers for each level test").replace("who take a second, different form within 14 days", "who take a second level test at the same level within 14 days").replace("an established English test", "a full Spica test or an established English test"))
    v.append(sub(blocks["5.2"]))
    v.append(f"<h4>5.2.1 Descriptive Statistics</h4>\n<p>Table {D.n + 1} will report, for each level test, the number of test takers, the mean and spread of the overall share correct, and the pass rate.</p>\n" + D.t(["Level test", "N", "Mean overall share correct", "SD", "Pass rate"], [[f"{lv}", '<span class="tbc-cell">to be completed</span>', "", "", ""] for lv in LEVELS], "Descriptive statistics by level test"))
    v.append(f"<h4>5.2.2 Standard Error of Measurement</h4>\n<p>The standard error of measurement (SEM) of the overall share correct will be calculated for each level test as SEM = SD × √(1 − reliability). It shows how close to the pass mark a result must be before a different attempt could reasonably give a different decision; results within one SEM of the pass mark will be marked for human review in high-stakes uses.</p>\n" + D.t(["Result", "SEM (percentage points)"], [["Overall share correct, each level test", "to be completed (target ≤ 6)"]], "Standard error of measurement"))
    v.append(f"<h4>5.2.3 Test Reliability</h4>\n<p>Reliability will be estimated for each level test by internal consistency (Cronbach's alpha, and split-half with the Spearman–Brown correction) and by test–retest, using the retest group's two attempts at the same level.</p>\n" + D.t(["Level test", "Internal consistency", "Test–retest", "Target"], [[lv, "—", "—", "≥ 0.80"] for lv in LEVELS], "Reliability estimates (to be completed)"))
    v.append(f"<h4>5.2.4 Dimensionality: Correlations Among Skill Results</h4>\n<p>The four skill shares are expected to correlate moderately to strongly with each other, but not so highly that they measure the same thing. Table {D.n + 1} will report these correlations across all level tests. Correlations between about 0.60 and 0.85 would support the rule that every skill must reach the level.</p>\n" + D.t(["", "Speaking", "Listening", "Reading", "Writing"], [[x, *["—" if x == y else "" for y in ["Speaking", "Listening", "Reading", "Writing"]]] for x in ["Speaking", "Listening", "Reading", "Writing"]], "Correlations among skill results (to be completed)"))
    b525 = sub(blocks["5.2.5"])
    v.append(D.shared(b525))
    v.append(D.shared(sub(blocks["5.2.6"]).replace("it allows all six real forms to be placed on the same scale so that scores from different forms mean the same thing", "it shows whether the questions in each level's pools are of similar difficulty, so that every level test at a level is equally demanding").replace("Strictly increasing from A1 to C1", "Strictly increasing from A1 to C2")))
    v.append(f"<h4>5.2.7 Decision Consistency</h4>\n<p>Because a level test gives a yes-or-no decision, what matters most is how consistently it gives the same decision. Using the retest group, Spica will report the share of test takers who get the same decision on two attempts at the same level, and Cohen's kappa for that agreement. Decision accuracy at the pass mark will also be estimated from the reliability and score distribution.</p>\n" + D.t(["Measure", "Target", "Result"], [["Same decision on two attempts", "≥ 85%", "to be completed"], ["Kappa (decision agreement)", "≥ 0.60", "to be completed"]], "Decision consistency (to be completed)"))
    v.append(f"<h3>5.3 Differentiation Among Known Populations</h3>\n<p>A valid level test should be passed by people known to be at or above its level and failed by people known to be below it. Test takers whose level has been established by a full Spica test or an established English test will take level tests at, above and below that level. Table {D.n + 1} will report pass rates for each group.</p>\n" + D.t(["Group", "N", "Pass rate", "Target"], [["Known to be at or above the test's level", "to be completed", "", "≥ 80%"], ["Known to be one level below", "to be completed", "", "≤ 25%"]], "Pass rates of known populations (to be completed)"))
    v.append(f"<h3>5.4 Relation to Other Measures</h3>\n<p>Level test decisions should agree with other evidence of the same level. Spica will compare decisions with the level given by English Placement and by an established English test taken within 14 days, and, in partner organisations, with managers' ratings of workplace English. Agreement will be reported as the share of matching decisions and as kappa.</p>\n" + D.t(["Comparison", "N", "Agreement", "Kappa"], [["English Placement level", "to be completed", "", ""], ["Established English test", "to be completed", "", ""], ["Manager ratings", "to be completed", "", ""]], "Relation to other measures (to be completed)"))
    v.append(D.shared(sub(blocks.full("5.5"))))
    v.append(f"<h3>5.6 Confirming the Pass Marks</h3>\n<p>The pass marks ({PASS_OVERALL}% overall and {PASS_SKILL}% in every skill) are design values. They will be reviewed by a panel of 10–15 independent experts in English language teaching and assessment, following the procedures in the Council of Europe's manual for relating examinations to the CEFR (Council of Europe, 2009). The panel will judge, question by question, what share a person who has just reached each level would answer correctly, and will recommend a pass mark for each level test. Spica will publish the panel's method, the members' qualifications (without personal details) and any changes made to the pass marks.</p>\n")
    v.append(sub(blocks["5.7"]))
    v.append(D.shared(sub(blocks["5.8"])))
    out.append("\n".join(v) + "\n")
    out.append(f"""<h2 class="section">6. Conclusions</h2>
<p>The Spica Level Tests give a clear passed or not-passed decision for one CEFR level, from A1 to C2, through eight tasks and {total} questions in about 35 minutes. Every question is at the chosen level, each skill draws on several tasks, and a pass requires the level in every skill, not only on average. Questions come first from pools written only for level tests, kept separate from practice and real-test material. Spoken answers are scored on intelligibility rather than accent, all standard spellings are accepted, sessions are proctored and flagged sessions are reviewed by people.</p>
<p>The validation programme in Section 5 will provide the evidence needed to support these decisions: reliability and consistency of the decisions, agreement with trained examiners, pass rates of known groups, agreement with other measures, fairness across groups, and expert review of the pass marks. This document will be updated with the results as each stage is completed.</p>
""")
    out.append(sub(blocks["7."]) + "\n" + D.shared(sub(blocks["Appendix A"])) + "\n")
    b = sub(blocks.full("Appendix B")).replace("Try the free sample to become familiar with the seven parts.", "Practise at the chosen level with Practice Modules to become familiar with the eight parts.")
    b = re.sub(r"<li>In Passage Reconstruction.*?</li>\s*", "<li>In Email Writing, cover every point asked for and write at least 100 words.</li>\n", b, flags=re.S)
    b = b.replace("Share your certificate using its unique code, QR code or the link to LinkedIn.", "A level test does not produce a certificate; take a full Spica real test for a certified level.")
    out.append(b + "\n")
    rows = []
    for p in parts:
        r = ranges.get(p["type"], {})
        allw = [x for lo_hi in r.values() for x in lo_hi]
        wr = rng(min(allw), max(allw)) if allw else "—"
        st, resp, key, scoring = p["spec"]["spec"]
        rows.append([title(p), st.format(w=wr), resp, time_of(p), key, scoring, ", ".join(SK[x] for x in p["skills"])])
    out.append('<h2 class="section">Appendix C. Item Specification Summary</h2>\n' + D.t(["Task", "Stimulus", "Response", "Time", "Key", "Scoring", "Skills"], rows, "Item specification summary (S = Speaking, L = Listening, R = Reading, W = Writing)"))
    out.append(sub(blocks.full("8.")) + "\n</body>\n</html>\n")
    doc = no_conversations("".join(out).replace("{T_SKILL}", str(t_skill)))
    doc = doc.replace("Certificates are issued only for sessions that are clear or cleared, and a certificate is withdrawn if a later review confirms a violation.", "A level test result is released only for sessions that are clear or cleared, and is withdrawn if a later review confirms a violation.")
    doc = doc.replace("<tr><th>Level</th><th>Spica Score</th>", "<tr><th>Level</th>")
    doc = re.sub(r"(<tr><td>(?:Below A1|A1|A2|B1|B2|C1|C2)</td>)<td>\d+–\d+</td>", r"\1", doc)
    doc = doc.replace("with a common set of anchor items shared between forms", "with questions shared between the pools of neighbouring levels as anchors")
    doc = doc.replace("reliability for each form each quarter", "reliability for each level test each quarter")
    doc = doc.replace("Using synthesised voices keeps the speed, clarity and volume of prompts consistent across all forms of the test.", "Using synthesised voices keeps the speed, clarity and volume of prompts consistent across all level tests.")
    caps = [int(x) for x in re.findall(r'<div class="cap">Table (\d+)\.', doc)]
    assert caps == list(range(1, len(caps) + 1)), f"level: tables numbered {caps}"
    return doc


def main():
    head, blocks = template_blocks()
    layout, banks, real, prof, level_pool = load_data()
    os.makedirs(OUT_DIR, exist_ok=True)
    for tt, cfg in TESTS.items():
        doc = build(tt, cfg, layout, banks, real, prof, blocks, head)
        path = os.path.join(OUT_DIR, f"Spica-{cfg['slug']}-Test-Description-and-Validation-Summary.html")
        open(path, "w").write(doc)
        print("wrote", path)
    with psycopg.connect(os.environ["PROFILE_DB_URL"]) as conn:
        type_info = {t: (timer, skills, name) for t, timer, skills, name in conn.execute("SELECT id, timer_seconds, skills, name FROM item_types")}
        for (iid,) in conn.execute("SELECT id::text FROM items WHERE status = 'approved' AND pool = 'level_test' AND exam_part_id IS NULL"):
            if iid in prof:
                prof[iid]["_reserved"] = True
    doc = build_level(blocks, head, prof, level_pool, type_info)
    path = os.path.join(OUT_DIR, "Spica-Level-Tests-Test-Description-and-Validation-Summary.html")
    open(path, "w").write(doc)
    print("wrote", path)


if __name__ == "__main__":
    main()
