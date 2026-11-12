"""Question profile, part 2: AI judgements (Gemini) for each approved question.
Grammar points with their CEFR level, what the task asks of the test taker,
topic familiarity, how demanding it is, the AI's own level estimate, whether
the question fits its level, problems, and (multiple choice) distractor quality.

  GEMINI_API_KEY=... PROFILE_DB_URL=... python ai_judge.py OUT_DIR [--limit N]

Resumable: answers are kept in OUT_DIR/ai.jsonl and questions already judged
are skipped. Prints the tokens used, to work out the cost.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

import psycopg

sys.path.insert(0, os.path.dirname(__file__))
from measure_questions import as_text, extract  # noqa: E402

OUT = sys.argv[1]
LIMIT = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
MODEL = os.environ.get("GEMINI_PROFILE_MODEL", "gemini-3.5-flash")
BATCH = 15
URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

PROMPT = """You are an experienced CEFR test developer reviewing questions of an English test.
For each question below, judge it as it is used (the type says what the test taker does; "heard" text is played as audio).
Return one result per question, with the same id:
- vocab_cefr: the CEFR level of the vocabulary, as learner word lists (English Vocabulary Profile style) would place it
- hard_words: words above the stated level, up to 5 (empty if none)
- grammar_points: up to 4 main grammar structures the test taker must understand or produce, each with its usual CEFR level (e.g. "present perfect (B1)")
- task_demand: one of "repeat or copy", "literal understanding", "main idea", "inference", "functional response", "describe or narrate", "opinion or argument", "summarise"
- topic_familiarity: one of "everyday", "work", "academic", "abstract"
- cognitive_load: 1 (very light) to 5 (very heavy), for a learner at the stated level
- ai_cefr: the CEFR level you would give the question (A1, A2, B1, B2, C1, C2)
- fit: "fits", "too easy" or "too hard" for its stated level
- issues: short note of real problems (more than one right answer, wrong key, unnatural or incorrect English, unclear question, cultural bias), or "" if none
- distractors: for multiple choice only, "good", "weak" or "ambiguous"; otherwise ""
Be strict and brief."""

SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "id": {"type": "STRING"},
            "vocab_cefr": {"type": "STRING"},
            "hard_words": {"type": "ARRAY", "items": {"type": "STRING"}},
            "grammar_points": {"type": "ARRAY", "items": {"type": "STRING"}},
            "task_demand": {"type": "STRING"},
            "topic_familiarity": {"type": "STRING"},
            "cognitive_load": {"type": "INTEGER"},
            "ai_cefr": {"type": "STRING"},
            "fit": {"type": "STRING"},
            "issues": {"type": "STRING"},
            "distractors": {"type": "STRING"},
        },
        "required": ["id", "vocab_cefr", "hard_words", "grammar_points", "task_demand", "topic_familiarity", "cognitive_load", "ai_cefr", "fit", "issues", "distractors"],
    },
}


def describe(row) -> dict:
    iid, t, tname, cefr, content, answer = row
    p = extract(t, content or {}, answer or {})
    q = {"id": iid, "type": tname, "level": cefr, "mode": p["mode"], "text": p["stimulus"][:2500]}
    if p["question"]:
        q["question"] = p["question"][:600]
    if isinstance(p["options"], list):
        q["options"] = [as_text(o)[:200] for o in p["options"]]
        if isinstance(p["correct_index"], int):
            q["key"] = p["correct_index"] + 1
    a = answer if isinstance(answer, dict) else {}
    accepted = a.get("acceptable_answers")
    key = a.get("correct") or a.get("exact") or (accepted[0] if isinstance(accepted, list) and accepted else None)
    if isinstance(key, str):
        q["expected_answer"] = key[:400]
    return q


def call(batch: list) -> tuple:
    body = {
        "contents": [{"role": "user", "parts": [{"text": PROMPT + "\n\nQuestions:\n" + json.dumps(batch, ensure_ascii=False)}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseSchema": SCHEMA,
            "temperature": 0.2,
            # Short reasoning is enough for these judgements and costs far less.
            **({"thinkingConfig": {"thinkingLevel": os.environ["GEMINI_THINKING"]}} if os.environ.get("GEMINI_THINKING") else {}),
        },
    }
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"content-type": "application/json", "x-goog-api-key": os.environ["GEMINI_API_KEY"]})
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            u = data.get("usageMetadata", {})
            return json.loads(text), u.get("promptTokenCount", 0), u.get("candidatesTokenCount", 0) + u.get("thoughtsTokenCount", 0)
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:300]
            if e.code in (429, 500, 503) and attempt < 5:
                wait = 30 * (attempt + 1)
                print(f"  {e.code}, waiting {wait}s: {msg[:120]}", flush=True)
                time.sleep(wait)
                continue
            raise RuntimeError(f"{e.code}: {msg}")
        except (json.JSONDecodeError, KeyError) as e:
            if attempt < 5:
                time.sleep(5)
                continue
            raise
    raise RuntimeError("no answer")


def main():
    path = os.path.join(OUT, "ai.jsonl")
    done = set()
    if os.path.exists(path):
        with open(path) as f:
            done = {json.loads(line)["id"] for line in f if line.strip()}
    with psycopg.connect(os.environ["PROFILE_DB_URL"]) as conn:
        rows = conn.execute(
            """SELECT i.id::text, i.item_type_id, it.name, i.cefr_level, i.content, i.answer_set
               FROM items i JOIN item_types it ON it.id = i.item_type_id WHERE i.status = 'approved'
               ORDER BY md5(i.id::text)"""
        ).fetchall()
    todo = [r for r in rows if r[0] not in done]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f"{len(done)} already judged, {len(todo)} to do with {MODEL}", flush=True)
    tin = tout = 0
    with open(path, "a") as f:
        for i in range(0, len(todo), BATCH):
            batch = [describe(r) for r in todo[i : i + BATCH]]
            results, a, b = call(batch)
            tin += a
            tout += b
            ids = {q["id"] for q in batch}
            for res in results:
                if res.get("id") in ids:
                    f.write(json.dumps(res, ensure_ascii=False) + "\n")
            f.flush()
            print(f"  {min(i + BATCH, len(todo))}/{len(todo)}  tokens in {tin:,} out {tout:,}", flush=True)
    print(json.dumps({"questions": len(todo), "tokens_in": tin, "tokens_out": tout}), flush=True)


if __name__ == "__main__":
    main()
