"""Question profile: measures every approved question on the parameters that
matter for the assessment, and writes a spreadsheet.

Part 1 (this file, free): text, vocabulary, sentence structure, recordings,
multiple-choice and task details, and questions that don't fit their level.
Part 2 (ai_judge.py, Gemini): grammar points, task demand, AI level check.

Run with the tools in ~/.venvs/spica-profile:
  PROFILE_DB_URL=postgres://... ~/.venvs/spica-profile/bin/python measure_questions.py OUT_DIR
Reads the database only; never writes to it.
"""

import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict

import psycopg
import spacy
import textstat
from wordfreq import top_n_list, zipf_frequency

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(OUT, exist_ok=True)
LEVELS = ["Pre-A1", "A1", "A2", "B1", "B2", "C1", "C2"]
LEVEL_INDEX = {l: i for i, l in enumerate(LEVELS)}

# Vocabulary bands: how many of the most frequent English words a learner at
# each level knows (Milton 2010, vocabulary size by CEFR level, from
# frequency lists). A word's band is the lowest level whose size covers its
# frequency rank (the more common of the word and its base form).
BAND_LIMITS = [("A1", 1500), ("A2", 2500), ("B1", 3250), ("B2", 3750), ("C1", 4500), ("C2", 10**9)]
RANK = {w: i + 1 for i, w in enumerate(top_n_list("en", 60000))}


def band_of(lemma: str, surface: str = "") -> str:
    ranks = [RANK[w] for w in (lemma.lower(), surface.lower()) if w in RANK]
    if not ranks:
        return "C2"
    r = min(ranks)
    for level, limit in BAND_LIMITS:
        if r <= limit:
            return level
    return "C2"


SPEAKER = re.compile(r"(^|\n|\s)(Speaker\s+)?[A-D]:\s*")
GAP = re.compile(r"_{2,}")


def clean(text: str) -> str:
    return SPEAKER.sub(r"\1", text or "").strip()


def as_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list):
        return " ".join(as_text(x) for x in v)
    if isinstance(v, dict):
        return " ".join(as_text(x) for x in v.values())
    return str(v)


def extract(t: str, c: dict, a: dict) -> dict:
    """What the test taker reads or hears (stimulus), the question, options,
    and the text whose structure is measured."""
    a = a if isinstance(a, dict) else {}
    out = {"stimulus": "", "question": "", "options": None, "correct_index": None, "analysed": "", "mode": ""}
    first_answer = (a.get("acceptable_answers") or [""])[0] if isinstance(a.get("acceptable_answers"), list) else ""
    if t in ("repeats", "dictation", "reading", "typing"):
        out["stimulus"] = c.get("text", "")
        out["mode"] = {"repeats": "heard", "dictation": "heard", "reading": "read aloud", "typing": "read"}[t]
    elif t == "conversations":
        out["stimulus"] = c.get("dialogue", "")
        out["question"] = c.get("question", "")
        out["mode"] = "heard"
    elif t == "sentence_builds":
        out["stimulus"] = " / ".join(c.get("groups") or [])
        out["analysed"] = a.get("correct", "")
        out["mode"] = "heard"
    elif t == "sentence_completion":
        out["stimulus"] = c.get("sentence", "")
        out["analysed"] = GAP.sub(first_answer or "something", out["stimulus"])
        out["mode"] = "read"
    elif t in ("passage_reconstruction", "summary_and_opinion"):
        out["stimulus"] = c.get("passage", "")
        out["mode"] = "read"
    elif t == "passage_comprehension":
        out["stimulus"] = c.get("story", "")
        out["question"] = c.get("question", "")
        out["mode"] = "heard"
    elif t == "story_retelling":
        out["stimulus"] = c.get("story", "")
        out["mode"] = "heard"
    elif t == "reading_comprehension":
        out["stimulus"] = c.get("passage") or c.get("text", "")
        out["question"] = c.get("question", "")
        out["options"] = c.get("options")
        out["correct_index"] = a.get("correctIndex")
        out["mode"] = "read"
    elif t == "reading_selective":
        out["stimulus"] = c.get("text", "")
        out["question"] = c.get("question", "")
        out["mode"] = "read"
    elif t == "response_selection":
        out["stimulus"] = c.get("text", "")
        out["options"] = c.get("options")
        out["correct_index"] = a.get("correctIndex")
        out["mode"] = "heard"
    elif t == "short_answer":
        out["stimulus"] = c.get("question", "")
        out["mode"] = "heard"
    elif t == "speaking_situations":
        out["stimulus"] = c.get("situation", "")
        out["mode"] = "read"
    elif t in ("email_writing", "free_writing", "open_questions", "lc_speak_personal", "lc_speak_followup", "lc_write_task2"):
        out["stimulus"] = c.get("prompt", "")
        out["mode"] = "read"
    elif t in ("lc_speak_discussion", "lc_speak_presentation"):
        out["stimulus"] = c.get("prompt", "") + " " + as_text(c.get("ideas") or c.get("points"))
        out["mode"] = "read"
    elif t.startswith("lc_listen"):
        out["stimulus"] = c.get("audio", "")
        out["question"] = c.get("question", "") or as_text([q.get("question", "") for q in c.get("questions", []) if isinstance(q, dict)])
        out["options"] = c.get("options")
        out["correct_index"] = a.get("correctIndex")
        out["mode"] = "heard"
    elif t.startswith("lc_read"):
        out["stimulus"] = c.get("passage") or c.get("text") or c.get("sentence", "")
        out["question"] = c.get("question", "") or as_text([q.get("question", "") for q in c.get("questions", []) if isinstance(q, dict)])
        out["options"] = c.get("options")
        out["correct_index"] = a.get("correctIndex")
        out["mode"] = "read"
    else:
        out["stimulus"] = as_text(c)
        out["mode"] = "?"
    out["stimulus"] = clean(as_text(out["stimulus"]))
    out["analysed"] = clean(out["analysed"] or GAP.sub("something", out["stimulus"]))
    return out


SUBORDINATE = {"advcl", "relcl", "ccomp", "acl", "csubj", "xcomp"}


def depth(tok) -> int:
    # spaCy makes a new Token object on each access: compare positions.
    d = 0
    while tok.head.i != tok.i and d < 100:
        tok = tok.head
        d += 1
    return d


def tenses(doc) -> list:
    found = set()
    for tok in doc:
        if tok.pos_ not in ("VERB", "AUX"):
            continue
        m = tok.morph
        children = {c.lower_ for c in tok.children if c.dep_ in ("aux", "auxpass")}
        if tok.tag_ == "MD":
            found.add("modal verb")
        if tok.pos_ == "VERB":
            if "will" in children or "'ll" in children:
                found.add("future (will)")
            if tok.tag_ == "VBN" and children & {"has", "have", "'ve", "'s"}:
                found.add("present perfect")
            if tok.tag_ == "VBN" and children & {"had", "'d"}:
                found.add("past perfect")
            if tok.tag_ == "VBG" and children & {"am", "is", "are", "'m", "'re", "'s"}:
                found.add("present continuous")
            if tok.tag_ == "VBG" and children & {"was", "were"}:
                found.add("past continuous")
            if m.get("Tense") == ["Past"] and tok.tag_ == "VBD":
                found.add("past simple")
            if tok.tag_ in ("VBP", "VBZ") and not children:
                found.add("present simple")
        if tok.dep_ in ("auxpass", "nsubjpass"):
            found.add("passive")
    text = doc.text.lower()
    if re.search(r"\bif\b", text):
        if re.search(r"\bwould have\b|\bhad\b.*\bwould\b", text):
            found.add("conditional (unreal past)")
        elif re.search(r"\bwould\b|\bcould\b|\bmight\b", text):
            found.add("conditional (unreal)")
        else:
            found.add("conditional (real)")
    return sorted(found)


def measure(doc, raw_text: str) -> dict:
    sents = [s for s in doc.sents if any(t.is_alpha for t in s)]
    words = [t for t in doc if t.is_alpha]
    content = [t for t in words if t.pos_ in ("NOUN", "VERB", "ADJ", "ADV") and not t.is_stop and "'" not in t.text]
    lemmas = [t.lemma_.lower() for t in content]
    word_bands = [band_of(t.lemma_, t.text) for t in content]
    n = len(words)
    sent_lens = [sum(1 for t in s if t.is_alpha) for s in sents] or [0]
    bands = Counter(word_bands)
    # Vocabulary level: the lowest band covering at least 90% of the content words.
    vocab_level = "A1"
    if lemmas:
        covered = 0
        for level, _ in BAND_LIMITS:
            covered += bands.get(level, 0)
            vocab_level = level
            if covered / len(lemmas) >= 0.9:
                break
    clauses = sum(1 for t in doc if t.pos_ in ("VERB", "AUX") and (t.dep_ in SUBORDINATE or t.dep_ == "ROOT" or (t.dep_ == "conj" and t.pos_ == "VERB")))
    subordinate = sum(1 for t in doc if t.dep_ in SUBORDINATE)
    syllables = textstat.syllable_count(raw_text) if n else 0
    return {
        "words": n,
        "sentences": len(sents),
        "words_per_sentence": round(n / max(len(sents), 1), 1),
        "longest_sentence": max(sent_lens),
        "letters_per_word": round(sum(len(t) for t in words) / n, 2) if n else 0,
        "syllables_per_word": round(syllables / n, 2) if n else 0,
        "readability_ease": round(textstat.flesch_reading_ease(raw_text), 1) if n >= 5 else None,
        "grade_level": round(textstat.flesch_kincaid_grade(raw_text), 1) if n >= 5 else None,
        "unique_word_ratio": round(len({t.lower_ for t in words}) / n, 2) if n else 0,
        "content_words": len(content),
        "rarity_level": vocab_level,
        **{f"words_{lv}_pct": round(bands.get(lv, 0) / len(lemmas) * 100) if lemmas else 0 for lv, _ in BAND_LIMITS},
        "rare_words": ", ".join(sorted({l for l, b in zip(lemmas, word_bands) if b == "C2"})[:12]),
        "_bands": word_bands,
        "clauses_per_sentence": round(clauses / max(len(sents), 1), 2),
        "subordinate_clauses": subordinate,
        "passive": sum(1 for t in doc if t.dep_ in ("auxpass", "nsubjpass")),
        "max_depth": max((depth(t) for t in doc), default=0),
        "grammar_features": ", ".join(tenses(doc)),
    }


def main():
    url = os.environ["PROFILE_DB_URL"]
    with psycopg.connect(url) as conn:
        rows = conn.execute(
            """SELECT i.id::text, i.item_type_id, it.name, it.skills, it.min_words, it.max_words, i.cefr_level, i.pool, i.topic, i.domain,
                 i.difficulty, i.content, i.answer_set, coalesce(i.timer_seconds, it.timer_seconds) AS timer,
                 e.purpose, e.name AS set_name
               FROM items i JOIN item_types it ON it.id = i.item_type_id
               LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id LEFT JOIN exams e ON e.id = ep.exam_id
               WHERE i.status = 'approved' ORDER BY i.item_type_id, i.cefr_level, i.id"""
        ).fetchall()
        audio = defaultdict(list)
        for item_id, duration_ms, accent, voice in conn.execute("SELECT item_id::text, duration_ms, accent, voice_id FROM item_audio"):
            audio[item_id].append((duration_ms, accent, voice))
    print(f"{len(rows)} questions", flush=True)

    nlp = spacy.load("en_core_web_sm", disable=["ner"])
    parts = [extract(r[1], r[11] or {}, r[12] or {}) for r in rows]
    docs = nlp.pipe((p["analysed"] or " " for p in parts), batch_size=256)

    records = []
    for r, p, doc in zip(rows, parts, docs):
        (iid, t, tname, skills, min_w, max_w, cefr, pool, topic, domain, difficulty, content, answer, timer, purpose, set_name) = r
        m = measure(doc, p["analysed"])
        rec = {
            "id": iid,
            "type": tname,
            "type_id": t,
            "skills": ", ".join(skills or []),
            "cefr": cefr,
            "used_in": purpose or ("bank" if pool else "bank"),
            "set": set_name or "",
            "topic": topic or "",
            "domain": domain or "",
            "mode": p["mode"],
            "stimulus_words": len(re.findall(r"[A-Za-z']+", p["stimulus"])),
            "question_words": len(re.findall(r"[A-Za-z']+", p["question"] or "")),
            **m,
        }
        # Recordings: length, speed, accent and voices.
        rec_audio = audio.get(iid, [])
        durations = [d for d, _, _ in rec_audio if d]
        rec["recordings"] = len(rec_audio)
        rec["audio_seconds"] = round(statistics.mean(durations) / 1000, 1) if durations else None
        spoken = len(re.findall(r"[A-Za-z']+", p["stimulus"]))
        rec["speech_rate_wpm"] = round(spoken / (statistics.mean(durations) / 60000)) if durations and spoken else None
        rec["accent"] = ", ".join(sorted({a for _, a, _ in rec_audio if a}))
        rec["speakers"] = len(set(re.findall(r"(?:^|\s)(?:Speaker\s+)?([A-D]):", as_text(content)))) or (1 if rec_audio else None)
        # Multiple choice.
        opts = p["options"] if isinstance(p["options"], list) else None
        if opts:
            lens = [len(re.findall(r"[A-Za-z']+", as_text(o))) for o in opts]
            ci = p["correct_index"]
            rec["options"] = len(opts)
            rec["correct_position"] = (ci + 1) if isinstance(ci, int) else None
            rec["option_words_avg"] = round(statistics.mean(lens), 1)
            others = [x for j, x in enumerate(lens) if j != ci]
            rec["correct_is_longest"] = isinstance(ci, int) and 0 <= ci < len(lens) and bool(others) and lens[ci] >= max(others) + 2
        else:
            rec["options"] = rec["correct_position"] = rec["option_words_avg"] = rec["correct_is_longest"] = None
        # Answer and timing.
        rec["answer_words_min"] = min_w
        rec["answer_words_max"] = max_w
        rec["time_seconds"] = timer
        rec["difficulty_old"] = float(difficulty) if difficulty is not None else None
        records.append(rec)

    flag(records)
    with open(os.path.join(OUT, "profile.jsonl"), "w") as f:
        for rec in records:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(f"measured {len(records)}; flagged {sum(1 for r in records if r['flags'])}", flush=True)


# Questions that don't fit their level: compared with the other questions of
# the same type and level (far outside the middle half), and vocabulary two
# or more bands above the level.
FLAG_METRICS = [
    ("words_per_sentence", "sentences longer", "sentences shorter"),
    ("stimulus_words", "text longer", "text shorter"),
    ("clauses_per_sentence", "structure more complex", "structure simpler"),
    ("speech_rate_wpm", "speech faster", "speech slower"),
]


def flag(records):
    groups = defaultdict(list)
    for r in records:
        groups[(r["type_id"], r["cefr"])].append(r)
    for (_, cefr), rs in groups.items():
        for key, higher, lower in FLAG_METRICS:
            vals = sorted(r[key] for r in rs if isinstance(r[key], (int, float)))
            if len(vals) < 12:
                continue
            q1, q3 = vals[len(vals) // 4], vals[(3 * len(vals)) // 4]
            spread = max(q3 - q1, 0.5)
            for r in rs:
                v = r[key]
                if not isinstance(v, (int, float)):
                    continue
                if v > q3 + 1.5 * spread:
                    r.setdefault("_flags", []).append(f"{higher} than others at {cefr}")
                elif v < q1 - 1.5 * spread:
                    r.setdefault("_flags", []).append(f"{lower} than others at {cefr}")
        for r in rs:
            if cefr in LEVEL_INDEX and r["content_words"] >= 3:
                # General word frequency, not a learner word list: everyday words
                # (umbrella, soup) count as rare, so only clear cases are flagged:
                # 3+ rare words making up at least 25% of the content words, at A1-B1.
                rare = sum(1 for b in r["_bands"] if b == "C2")
                if LEVEL_INDEX[cefr] <= LEVEL_INDEX["B1"] and rare >= 3 and rare / r["content_words"] >= 0.25:
                    r.setdefault("_flags", []).append(f"many rare words for {cefr} ({rare})")
            if r["correct_is_longest"]:
                r.setdefault("_flags", []).append("right option is the longest (a clue)")
    for r in records:
        r["flags"] = "; ".join(r.pop("_flags", []))
        r.pop("_bands", None)


if __name__ == "__main__":
    main()
