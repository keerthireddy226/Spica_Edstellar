#!/usr/bin/env bash
# Exports one row per marked answer, for checking how each question behaves
# (share right, time, option choices, fairness) and, later, for statistical
# analysis by a testing specialist (question bank review, 17 November 2026,
# section 5.2).
#
# Anonymous by design: the person is a salted hash, never a name, email or id;
# no recordings and no free-text answers are exported (only the option chosen,
# or the word typed in Sentence Completion and Dictation). Demo, staff and
# deleted accounts are left out.
#
# Usage:
#   DATABASE_URL=... ANSWER_EXPORT_SALT=<secret, keep it the same between exports> \
#     bash scripts/exportAnswerData.sh [output.csv] [since-date, default 2026-01-01]
set -euo pipefail
OUT="${1:-answer-data-$(date +%Y%m%d).csv}"
SINCE="${2:-2026-01-01}"
: "${DATABASE_URL:?set DATABASE_URL}"
: "${ANSWER_EXPORT_SALT:?set ANSWER_EXPORT_SALT (any long secret; reuse it so the same person keeps the same code)}"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v salt="$ANSWER_EXPORT_SALT" -v since="$SINCE" -At <<'SQL' > "$OUT"
\pset footer off
COPY (
  SELECT
    left(i.id::text, 8)                                   AS question_id,
    it.name                                               AS question_type,
    i.cefr_level                                          AS question_level,
    coalesce(tt.name, '')                                 AS test,
    coalesce(e.code, s.composition->>'formCode', '')      AS form,
    coalesce(e.purpose, '')                               AS question_bank,
    s.delivery_mode                                       AS mode,
    left(encode(sha256(convert_to(:'salt' || s.user_id::text, 'UTF8')), 'hex'), 16) AS person,
    left(encode(sha256(convert_to(:'salt' || s.id::text, 'UTF8')), 'hex'), 12)      AS attempt,
    CASE
      WHEN it.input_method = 'radio' AND a.response_text ~ '^[0-9]+$' THEN substr('ABCD', (a.response_text)::int + 1, 1)
      WHEN i.item_type_id IN ('sentence_completion', 'dictation') THEN a.response_text
      ELSE ''
    END                                                   AS answer,
    (a.response_text IS NULL AND a.response_uri IS NULL)  AS not_answered,
    round(sc.content_score::numeric, 3)                   AS mark,
    round((sc.manner_scores->'gemini'->>'pronunciation')::numeric, 3) AS clarity,
    round((sc.manner_scores->'gemini'->>'fluency')::numeric, 3)       AS fluency,
    sc.model_version                                      AS marked_by,
    round(coalesce(a.active_ms, 0) / 1000.0, 1)           AS seconds,
    to_char(a.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
    s.result->>'cefrLevel'                                AS overall_level,
    s.result->>'overallPercent'                           AS overall_percent,
    coalesce(pp.first_language, '')                       AS first_language,
    coalesce(pp.country, '')                              AS country
  FROM attempts a
  JOIN sessions s       ON s.id = a.session_id
  JOIN users u          ON u.id = s.user_id
  JOIN items i          ON i.id = a.item_id
  JOIN item_types it    ON it.id = i.item_type_id
  LEFT JOIN scores sc   ON sc.attempt_id = a.id AND sc.status = 'scored'
  LEFT JOIN exam_parts ep ON ep.id = i.exam_part_id
  LEFT JOIN exams e     ON e.id = ep.exam_id
  LEFT JOIN test_types tt ON tt.id = e.test_type_id
  LEFT JOIN participant_profiles pp ON pp.user_id = s.user_id
  WHERE s.completed_at IS NOT NULL
    AND s.completed_at >= :'since'::date
    AND s.delivery_mode IN ('mock', 'certified', 'sample', 'practice')
    AND u.role IN ('learner', 'candidate')
    AND u.deleted_at IS NULL
    AND coalesce((s.composition->>'demo')::boolean, false) = false
  ORDER BY a.submitted_at
) TO STDOUT WITH (FORMAT csv, HEADER true);
SQL
echo "wrote $(($(wc -l < "$OUT") - 1)) answers to $OUT"
