# Assessment engine: design (Phase 0)

Status: Phase 1 built (2026-10-16); decisions D1-D9 taken as recommended. See
section 14 for what Phase 1 delivered.

## 1. Goal and scope

Spica becomes an engine that prepares people for, and simulates, major English
exams, and lets organizations run that preparation toward a target level by a date.

| In scope now | Not now |
|---|---|
| Exam families: **Versant** (5 existing products) and **LanguageCert** | Linguaskill (adaptive) and Cambridge: the design leaves room for them |
| Segments: individuals, companies (employee skills + recruitment), universities (readiness + admissions) | Government, visa and immigration tests |
| Practice mode and mock exam mode on every test | Real, certified exams: Spica only prepares and estimates |
| AI-generated questions: automatic checks for practice, human approval for mocks | Phoneme-level pronunciation scoring (possible later as an optional paid coach) |
| AI feedback report: writing, reading, listening, speaking at word level | |

Wording rule everywhere: "Versant-style practice", "LanguageCert-style mock", and
"estimated" for any level or score. Spica never presents a result as an official
Pearson or LanguageCert score.

## 2. What exists and is reused

| Area | Today | Reuse |
|---|---|---|
| Questions | `items`: 4,618 approved (2,878 practice pool, 1,470 exam pool, 270 placement), 19 question types (`item_types`) with skills, input method, timers. Already has generation columns: `pipeline_version`, `prompt_version`, `filters_passed`, `reviewer_id`, `review_decision`, `review_rationale`, `difficulty`, `topic`, `cefr_level`, `skill_tag`. | Keep the table; add tags (section 3). The review columns become the approval queue. |
| Exams | `exams` (25 sets: 5 products x 5) -> `exam_parts` (section label + question type) -> `items.exam_part_id`. Products are hard-coded (`PRODUCT_CODE_PREFIX`, `VERSANT_PRODUCTS`). Randomized forms draw each section from all 5 sets. | Existing sets become fixed forms of the Versant test types. |
| Delivery | `sessions` (`session_type` placement / mocktest / practice), Test ID + Attempt ID, device check, consent, proctoring, background grading. Note: `sessions.mode` already exists with another meaning (coach / exam). | New column `delivery_mode` (practice / mock) instead of reusing `mode`. |
| Scoring | Per-question grading (exact match, word diff, Gemini rubric), intelligibility for speaking, CEFR per skill + headline (`placement/levels.ts`), adaptive placement engine. | Unchanged; family score scales are added on top. |
| Audio | Google TTS, en-US Neural2 voices only (`voice/googleTts.ts`). | Add en-GB, en-IN, en-AU voices: LanguageCert is UK-based and listening should not be US-only. |
| Organizations | `tenants.type` cohort / individual_free, `category` company / university, `products` skills / recruitment, `plan_tier` starter / business / enterprise, batches, job openings, credits. | Add segment-specific plans and per-learner quotas (section 8). |
| Jobs | `job_queue` with retries and periodic jobs. | Generation runs as queued jobs. |

**Content risk found:** 71 approved practice questions (`pipeline_version =
'sourced-v2'`, from `seeds/006_versant_sourced_bank.sql`) were taken from Pearson's
official Versant test-taker guides (2024) and a test-prep website; the seed file says
so and each one's `topic` cites its source. 39 of them are in module practice sets.
They must be replaced with original questions before selling. See decision D1. (The
117 `styled-v2` questions were written in that style, not copied.)

## 3. Data model (additive migrations only)

```
exam_families          id, name ("Versant"), publisher, delivery (fixed | adaptive),
                       label_template ("{name}-style"), score_scale jsonb, active
test_types             id, family_id, code ("lc-4skills"), name, skills[],
                       cefr_min, cefr_max, duration_minutes, delivery (fixed | adaptive),
                       status (live | coming_soon), sort_order
blueprint_sections     id, test_type_id, sort_order, label, item_type_id,
                       item_count, seconds (section timer, null = per question),
                       level_rule jsonb   -- e.g. {"spread": {"B1": 2, "B2": 3, "C1": 1}}
item_tags              item_id, test_type_id, domain (general | banking | insurance |
                       bpo | it | healthcare | academic ...), use_case (general |
                       recruitment | admission), approved_for (practice | mock),
                       exposure_count, retired_at
item_explanations      item_id, explanation jsonb   -- why each option is right/wrong,
                       where the answer is (quote / audio timestamp); made at generation
forms                  id, test_type_id, delivery_mode (practice | mock), domain,
                       status (draft | approved | retired), approved_by, approved_at
form_items             form_id, section_id, item_id, sort_order
item_exposures         user_id, item_id, session_id, seen_at, delivery_mode
generation_jobs        id, test_type_id, item_type_id, level, domain, use_case,
                       requested, produced, passed, failed, cost_usd, status
programs               id, tenant_id, segment, use_case, domain, test_type_id,
                       target_overall, target_skills jsonb, cohort_kind (batch | job |
                       university_program), cohort_id, starts_on, target_date, status
program_members        program_id, user_id, joined_at, latest_level, on_track
schedule_items         program_id, user_id, due_on, kind (practice | mock), status,
                       session_id
plan_quotas            segment, tier, practice_per_month, mocks_per_month,
                       report_level (summary | full), extras jsonb
feedback_reports       session_id, status, model, input_tokens, output_tokens,
                       cost_usd, report jsonb, created_at
attempt_feedback       attempt_id, errors jsonb   -- per-question corrections
sessions (+)           delivery_mode, test_type_id, form_id, program_id
tenants (+)            segment (company | university), already has category
```

Existing Versant sets are migrated in, not rebuilt: each of the 5 products becomes a
`test_type`, its `exam_parts` become `blueprint_sections`, and each of its 5 sets becomes
an approved `form`. The hard-coded product lists are then read from `test_types`.

## 4. Exam catalogue (Phase 1)

| Family | Test type | Skills | CEFR | Delivery |
|---|---|---|---|---|
| Versant | English Speaking and Listening | S, L | A1-C2 | fixed |
| Versant | English 4-Skills Essentials | S, L, R, W | A1-C2 | fixed |
| Versant | Writing | W (+L, R) | A1-C2 | fixed |
| Versant | Professional English | S, L, R, W | A1-C2 | fixed |
| Versant | English Placement | S, L, R, W | A1-C2 | fixed |
| LanguageCert | 4 Skills (the three modules below) | S, L, R, W | A1-C2 | fixed |
| LanguageCert | Listening & Reading | L, R | A1-C2 | fixed (paper); the computer version is adaptive |
| LanguageCert | Listening & Reading | L, R | A1-B1 | fixed (paper only) |
| LanguageCert | Writing: one report, article or review, 200-250 words | W | A1-C2 | fixed |
| LanguageCert | Speaking: 3 parts | S | A1-C2 | fixed |

Times, from languagecert.org (checked 2026-10-16), stored in `test_types.formats`:

| Test | Paper | Computer / online |
|---|---|---|
| Listening & Reading A1-C2 | 2 h (Listening 50 min, Reading 1 h 10) | 1 h-1 h 30 (adaptive, about 58 questions) |
| Listening & Reading A1-B1 | about 1 h 10 (Listening 30, Reading 40) | paper only |
| Writing A1-C2 | 30 min, 1 task | 30 min, 1 task |
| Speaking A1-C2 | 10-14 min | 10-14 min (online, live examiner) |
| 4 Skills | about 2 h 40-2 h 44 | about 1 h 40-2 h 15 (online: one session) |

The older Writing format (60 minutes, a 60-100 word message plus a 200-250 word
text) was retired by LanguageCert; Spica follows the current one.

LanguageCert needs question types Spica doesn't have yet. The list below is generic,
so it can serve other families later. Exact section counts and timings must come from
LanguageCert's public specifications (decision D2):

| New question type | Skill | Input |
|---|---|---|
| Listening multiple choice (short dialogue / long talk) | L | radio |
| Listening gap fill (notes completion) | L | text |
| Reading gap fill (missing sentence or word) | R | radio / text |
| Reading matching (headings / people to texts) | R | select |
| Writing task 1 (short functional text) and task 2 (essay / report) | W | textarea (`email_writing` and `summary_and_opinion` cover part of it) |
| Speaking interview (short personal questions) | S | mic (`open_questions` covers it) |
| Speaking long turn (talk on a topic with prep time) | S | mic, prep timer |
| Speaking discussion (respond to a prompt and follow-up) | S | mic |

LanguageCert test types show as "coming soon" until their questions exist (Phase 4),
unless a starter bank is generated earlier (decision D3).

## 5. Practice mode and mock exam mode (Phase 2)

| | Practice | Mock exam |
|---|---|---|
| Timer | Shown as a guide | Enforced per question or per section; the answer is submitted at 0:00 |
| Navigation | Back, skip, pause and resume later (the session stays open up to 14 days) | Forward only; one sitting; leaving the tab or closing the page doesn't stop the clock; a disconnect resumes at the same point with the remaining time |
| Feedback | After each question (correct answer, explanation, corrections) | None during the test; the full report at the end |
| Monitoring | Device check, consent, face checks | Everything the organization's policy turns on |
| Questions | Random draw from the practice pool, avoiding recent repeats | An approved mock form the person hasn't seen (fewest seen questions first) |
| Limits | Practice quota per month | Mock quota per month, at most one open mock at a time |
| Result | Per-question review + skill summary | Exam-style report: estimated level overall and per skill, estimated family score band, readiness against the target |

Server-side enforcement for mocks: the server times each question from when it
is first shown and records an answer that comes after its limit (plus 15 s for
uploads) as unanswered; the whole mock also has a deadline. The client timer is
only for display and to send the answer at 0:00. See section 15.

## 6. Question generation pipeline (Phase 4)

Runs as `generation.batch` jobs on the existing queue. One job = N questions of one
question type, level, domain and use case for one test type.

1. **Brief**: blueprint section + CEFR descriptors for the level (vocabulary, grammar,
   text length, speech rate) + domain context (e.g. banking: account opening, KYC, loan
   queries) + use case + 5 examples of approved items of that type (style, not content).
2. **Generate** (LLM): structured JSON per question type: stem, passage or audio
   script, options, answer key, explanation, target level, topic, domain.
3. **Automatic checks** (each recorded in `filters_passed`):
   - Schema and length limits per question type.
   - Answer key: a second model call answers the question without the key; it must
     agree, and for multiple choice exactly one option may be defensible.
   - Level: vocabulary profile against word-frequency bands (the
     `vocab_band_checked` column already exists) + a model level estimate; both
     within one level of the target.
   - Near-duplicates: embedding similarity against the bank (and against known
     published exam material, if provided) under a threshold.
   - Sensitivity and bias: no stereotypes, names and places varied across regions
     (India, UK, US, Africa, Asia), no medical, legal or political advice, no real
     brands.
   - Listening: script -> TTS in a mix of accents (en-GB, en-IN, en-US, en-AU),
     speech rate per level, audio length within the section timing.
4. **Status**:
   - Passed all checks -> approved for **practice**.
   - Any check failed -> review queue (never used until a person approves it).
   - Wanted for **mocks** -> review queue always; a content reviewer approves,
     edits or rejects (staff permission "Content review"). Mock forms are then
     assembled from approved items and approved as a whole (balance of levels,
     topics, accents).
5. **In use**: exposure is counted; questions seen by many learners, or with
   statistics that look wrong (almost everyone right or wrong, or strong learners
   failing it), are retired or sent back to review.

Bank size target per test type and domain: at least 10 non-overlapping mock forms,
plus a practice pool about 3x that.

## 7. AI feedback report (Phase 5)

Built after the test from stored results, mostly without new AI calls:

| Skill | Method | Shown to the learner |
|---|---|---|
| Reading, listening | `item_explanations` written at generation time (no cost at report time) | Why the chosen answer is wrong, the quote or audio moment with the answer |
| Writing | One LLM call per written answer: errors with character positions, the correction, the type (spelling, grammar, vocabulary, punctuation, task) and a one-line reason. British, Indian and American spellings never count as errors. | The answer with errors marked, corrections, a rewritten model answer |
| Speaking, known target text (repeat, read aloud, sentence build) | Word-level alignment of the transcript with the target (same word-diff as typing scoring) | "You said *work* instead of *walk*", skipped and added words, the correct word played with TTS. An accent never triggers it; only a different or missing word does. |
| Speaking, open answers | The intelligibility and fluency scores already stored, plus the grading comment | Notes on clarity, pace, fillers, content covered |
| Whole test | One LLM call over the structured results: skill analysis against the target level, and the 3 things to practise next, linked to practice sets | Summary page + per-question review |

Report levels by plan: "summary" = levels and the 3 next steps; "full" = everything.

## 8. Segments, plans and quotas (Phase 3; universities in Phase 7)

Quotas are per learner per calendar month, configurable in `plan_quotas`, enforced by
the API (a clear "monthly limit reached, resets on <date>" message) and shown in the UI.

| Segment | Tier | Practice / month | Mocks / month | Report |
|---|---|---|---|---|
| Individuals | Free | 2 | 1 sample | Summary |
| Individuals | Plus | Unlimited | 2 | Full |
| Companies: skills | Starter | 4 per learner | 1 | Full |
| Companies: skills | Business | Unlimited | 2 | Full + manager view |
| Companies: skills | Enterprise | Unlimited | 4 + custom domains + API | Full + API |
| Companies: recruitment | Credits | 1 sample per candidate | The assessment itself (1 credit) | Recruiter report |
| Universities | Campus | Unlimited | 1 every 2 weeks per student | Full |
| Universities | Admissions | None | Credit-based admission tests | Admissions report |

**Programs (organization set-up):** use case, domain, exam family + test type, target
level (overall and per skill), cohort (batch, job opening or university program),
target date. Spica builds each member's schedule: one practice every few days and a
mock every 2-4 weeks, depending on the time left and the gap to the target, capped by
the quota.

## 9. Organization monitoring (Phase 6)

- Program dashboard: members, latest estimated level per skill, trend across mocks,
  on track / at risk (projected level by the target date below the target), last
  activity.
- Drill-down to a person's mock reports (the same report the learner sees, plus
  integrity status).
- Alerts: at risk, inactive 14 days, missed mock. Export CSV.
- Recruiters: candidate reports per job opening (exists; gains the new report).
- Universities: admissions results per program, with the human review step.

## 10. Costs (estimates to confirm with current Gemini pricing)

Token estimates per unit; multiply by the current price per million tokens of the
model used (today `gemini-3.5-flash-lite` for grading; generation may need a
stronger model for quality):

| Unit | Calls | Tokens (approx.) |
|---|---|---|
| 1 generated question, reading or listening | generate + answer check + level check | 4-6k |
| 1 generated question, writing or speaking prompt | generate + level check | 2-3k |
| 1 listening question's audio | TTS | 300-1,500 characters |
| 1,000 generated questions | | about 4-5 million tokens + TTS for listening |
| 1 feedback report (4-skills test) | 1 call per written answer + 1 summary | 8-15k |

Each `generation_jobs` row and each `feedback_reports` row records its real cost, so
the estimates are replaced with measured numbers after the first runs.

## 11. Decisions needed before Phase 1

| # | Decision | Recommendation |
|---|---|---|
| D1 | The 71 questions taken from Pearson's guides and a test-prep site | Retire them and generate original replacements in Phase 1 (before any sale) |
| D2 | LanguageCert test specifications (sections, question counts, timings per level) | Take them from LanguageCert's public test specifications; someone on your side confirms them |
| D3 | LanguageCert content before Phase 4: wait, or generate a small starter bank in Phase 1 | Generate a starter bank (practice only) so LanguageCert can be tried early |
| D4 | Which domains first for recruitment | Banking, BPO, IT (then insurance, healthcare) |
| D5 | Who reviews mock questions (content reviewers) and how many per week | Name 1-2 reviewers; about 200 questions per week |
| D6 | Generation model: stay on Flash-Lite or use a stronger model for generation only | Stronger model for generation (quality matters more than cost there); Flash-Lite for checks |
| D7 | Estimated family scores: show only CEFR, or also an estimated Versant / LanguageCert score band | CEFR + a band, only where the publisher's CEFR concordance is public |
| D8 | Plans: are the quotas and the university tiers in section 8 right? | Confirm or adjust before Phase 3 |
| D9 | Free individuals: keep the existing free signup, or require Plus for mocks only | Keep free with the quotas above |

## 12. Phases

| Phase | Builds | Size |
|---|---|---|
| 1 | Exam catalogue (Versant migrated, LanguageCert added), test-type pages replacing hard-coded products, new question types' screens | 2-3 days |
| 2 | Practice vs mock modes, server-enforced timers, exposure tracking, mock forms | 2-3 days |
| 3 | Programs (org set-up, schedules), segments and quotas | 3 days |
| 4 | Generation pipeline, checks, review queue, form assembly, accented TTS | 4-5 days |
| 5 | Feedback report (writing, reading/listening, speaking word-level, summary) | 3 days |
| 6 | Organization monitoring dashboards and alerts | 2 days |
| 7 | University segment (Campus, Admissions) | 2 days |

Each phase ships on its own, with tests, a browser check, translations of new
screens, and an update to this file.

## 13. Risks

- **Intellectual property**: copying exam questions or implying official scores.
  Mitigated by original generation, near-duplicate checks, the "-style" and
  "estimated" wording, and the D1 audit.
- **Generated question quality**: a wrong answer key or a mislevelled item hurts
  trust. Mitigated by the second-model answer check, level checks, human approval
  for mocks, item statistics and retirement.
- **Score validity**: mock levels are estimates; without calibration against real
  exam results they can drift. Plan: collect learners' real exam results (opt-in) to
  compare and recalibrate.
- **Fairness**: speaking stays on intelligibility; accented TTS in listening; names
  and contexts from many regions; the accent calibration in `GRADING.md` still
  applies.
- **Cost**: generation is a one-off per bank; reports scale with tests taken. Both
  are measured per row from day one.

## 14. Phase 1: built

- **Catalogue** (`migrations/1794300000000_exam-catalogue.sql`, `src/catalogue/`):
  `exam_families`, `test_types`, `blueprint_sections`, `exams.test_type_id`. The
  practice-test list, organization settings, recruitment and the consent screen
  read test types from it.
- **LanguageCert question types** (`migrations/1794400000000_languagecert-item-types.sql`):
  15 types from the LTE handbooks (Listening & Reading v9.0, Speaking v4.0,
  October 2025); grouped questions (`mcq_group`), preparation time
  (`item_types.prep_seconds`), word ranges on writing tasks. Layouts follow the
  paper-based tests; the adaptive A1-C2 Listening & Reading comes with the
  adaptive engine.
- **Starter bank** (`seeds/content/languagecert/*.json`, loaded with
  `scripts/loadExamSets.ts`): LR-001 (110 marks), LB-001 (72), L4-001 (4 skills),
  LW-001/002, LS-001/002. All original; each Listening & Reading key was
  confirmed by an independent blind answer pass (292 of 292 agreed). Listening
  audio in mixed US, British, Indian and Australian voices
  (`scripts/generateItemAudio.ts --accent=mix`).
- **D1 done**: the 71 copied questions are retired and replaced by original ones
  in the same places (`seeds/content/original-v1-replacements.json`,
  `scripts/replaceSourcedItems.ts`).

Still open from Phase 1: two-voice dialogues (each listening script is read by
one voice, with "Speaker A/B" spoken); more sets per test type (Phase 4
generation). (LanguageCert estimated scores: done in Phase 2, on mock reports.)

## 15. Phase 2: built

- **Modes** (`migrations/1794600000000_practice-and-mock-modes.sql`,
  `src/practiceTests/modes.ts`): `sessions.delivery_mode` is `practice` or
  `mock`. A learner practises one set, or starts a mock of a test type; a
  candidate's assessment is always a mock. Existing sessions were marked
  practice, and candidates' sessions mock.
- **Mock form**: laid out like the test type's first set (same sections, same
  number of questions); each section's questions come from every set, groups
  the learner has seen least first (seen = answered, or shown in
  `session_item_views`); questions sharing a passage stay together. One open
  mock at a time (409 `mock_in_progress`).
- **Timing**: each question's limit = its answer time + two plays of its
  recording + 5 s + reading time (two-phase) + preparation time (speaking).
  With measured recording lengths (see section 17: stored lengths used to be
  double), LanguageCert A1-B1 Listening comes to 32 minutes (published: 30),
  A1-C2 Listening to 54 (published: 50), and Speaking 9.6 minutes
  (published: 10-14). The clock starts on the server when a
  question is first shown (`POST /session/:id/view`), so a reload or a closed
  tab doesn't stop it. The whole mock must end within the sum of its limits +
  30 s per part + 10 minutes. An answer after a question's limit + 15 s, or
  after the deadline, is saved as unanswered. Mock exams are forward only
  (409 `already_answered`). At the end, questions never reached are recorded
  as unanswered.
- **Practice feedback**: after each answer, the correct option(s), model text or
  key points, and the AI grader's one-sentence reason (`scores.reason`, now
  stored for every AI-graded answer). A recorded answer's feedback is fetched
  when its background grading finishes (`GET /session/:id/feedback/:itemId`).
- **Monitoring**: practice sessions get no proctoring policy
  (`practicePolicy`, `sessionPolicy`); the consent screen asks with the mode.
  Mocks keep the organization's policy.
- **Report**: a mock's report shows the family's published score range for the
  estimated level overall and per skill (LanguageCert: C2 90-100, C1 75-89, B2
  60-74, B1 40-59, A2 20-39, A1 10-19). Versant publishes no scale in
  `exam_families.score_scale` yet.

Still open from Phase 2: practice still runs set by set, not a random draw
avoiding recent repeats; monthly practice and mock quotas come with Phase 3;
"readiness against the target" needs Phase 3's programs; an untouched open
practice session holding questions retired since it started is replaced by a
fresh one, but one already started keeps them.

## 16. Phase 3: built

- **Monthly limits** (`migrations/1794700000000_programs-and-quotas.sql`,
  `src/programs/quotas.ts`): `plan_quotas` holds practice tests and mock exams
  per calendar month (UTC) for each segment and tier, as in section 8:
  individuals Free 2 / 1 and Plus unlimited / 2; companies Starter 4 / 1,
  Business unlimited / 2, Enterprise unlimited / 4; universities Campus
  unlimited / 2. A learner's row: an organization's learners by its plan tier
  (universities are all Campus until Phase 7), individuals Plus while a paid
  plan runs. Enforced when a practice test or mock starts (403
  `quota_reached` with the reset date); resuming an open one never counts
  again. Candidates have no limits (their assessment is the test). Free
  individuals can now open practice tests and take their monthly mock (the
  page used to be Plus only). Super Admins edit the limits on Plans & pricing;
  Admins see them.
- **Programs** (`src/programs/`): an Org Admin sets a goal for one batch:
  test type, target level (and optional per-skill targets), field, start and
  target dates. One active program per batch; everyone in the batch follows
  it, including people who join later.
- **Schedules** (`schedule.ts`): per member, from the gap between their
  latest level (latest mock of that test type, else the placement test) and
  the target: gap 2+ = a practice test every 3 days and a mock every 2 weeks;
  gap 1 = every 4 days / 3 weeks; at target = weekly / every 4 weeks. Unknown
  level = a first mock within 3 days. A final mock 3 days before the target
  date. Capped by the learner's monthly limits (the final mock is kept first).
  A finished test with at least one answer ticks off the earliest missed or
  next-week item of its kind; after a mock the rest of the plan is redone. An
  hourly job marks past items missed, completes programs past their date and
  plans newcomers.
- **Screens**: Org Admin > Programs (list, create, members with latest level,
  done/missed and next test; change target level or date and replan; mark
  completed, reopen, archive). Learners see "Your program" and this month's
  counts on Practice Tests; start buttons turn off at the limit (an unfinished
  set can still be resumed). The individual Plans page shows each tier's
  limits.
- `sessions.result` now keeps each practice test's level, skill levels,
  percentage and score band; `sessions.program_id` links a test to the
  program it counted towards.

Still open from Phase 3: "1 sample per candidate" for recruitment and the
university Admissions tier (Phase 7); the report level (summary / full) is
stored but used from Phase 5; the program field (banking, BPO, IT) picks
questions once Phase 4 generates domain questions; on track / at risk and
alerts come with Phase 6 monitoring; Managers don't see programs yet.

## 17. Phase 4: built

- **Jobs** (`migrations/1794800000000_question-generation.sql`,
  `src/generation/`): staff with the Content review permission ask for N
  questions of one type, level and field for a test type (Question bank >
  Write questions). A job writes them in batches of 5 and checks each one; it
  runs outside the job queue's worker (a job takes minutes and would hold up
  speaking grading), records a heartbeat, and is resumed by the
  `generation.resume` job after a restart. Tokens are counted per job.
- **Models**: questions are written by `GEMINI_GENERATION_MODEL` (default
  `gemini-3.5-flash`; the Gemini key in use is on the free tier, where Pro
  models have no quota, so D6's stronger model needs billing first) and
  checked by `GEMINI_CHECK_MODEL` (default `gemini-3.5-flash-lite`).
  Busy-model (503) and rate-limit (429) answers are retried with backoff.
- **Brief** (`brief.ts`): the type's format, CEFR descriptors for the level,
  the field's context, diversity rules (names and places across regions, no
  brands, advice or upsetting content, the key spread across positions), the
  topics already used at that level, and 2 approved questions of the type as a
  guide to format. Each question comes with an explanation (why the key is
  right, the words that give it away, why each option is right or wrong).
- **Checks** (`checks.ts`, recorded in `items.filters_passed`):
  format (the rules of `scripts/validateExamSets.py`, ported);
  answer key (the check model answers blind; it must agree and find no other
  defensible option); level (the check model's estimate within one level of
  the target); sensitivity and clarity (the same call); near-duplicates
  (gemini-embedding-001, 768 dimensions, cosine against the bank and the
  batch, threshold 0.92: distinct questions measured at most 0.86-0.92, copies
  1.0); recording (listening: recorded once the rest passed, length within
  the type's limit). Not built: the vocabulary-band check (no word-frequency
  list in the repo yet; the level estimate stands in).
- **Status**: every check passed = approved for practice. Anything failed =
  the review queue, not used. Mocks use only questions a person approved for
  them (`items.mock_approved`; the Phase 2 mock form now draws only those).
  The 4,818 questions already approved when this shipped were marked approved
  for mocks ("Approved before review" in the queue) so existing mocks keep
  working; reviewers can go through them and remove any from mocks. To make
  them all wait for a person instead:
  `UPDATE items SET mock_approved = false WHERE review_decision = 'grandfathered';`
- **Review** (Question bank > Review): needs review, waiting for mock
  approval, approved before review, rejected. A reviewer sees the question
  with the key marked, the explanation, every check with its notes, the
  recordings, and answer statistics; edits the JSON; approves for practice,
  for practice and mocks, removes from mocks, rejects; or runs the checks
  again. Every decision is in the audit log.
- **Recordings** (`voice/scriptAudio.ts`): a dialogue's A and B turns are read
  by a man and a woman (the learner's chosen voice reads A), with a pause
  between turns, one accent per recording rotated across US, British, Indian
  and Australian, slower at A1-A2 (0.85-0.9) and slightly faster at C2.
- **Sets** (Question bank > Sets, `assembly.ts`): a new set copies the test
  type's first set (parts, types, counts, per-question time limits) and takes
  approved questions not yet in a set, matching each slot's level where it
  can; a mock-ready set uses only mock-approved questions. It goes live for
  practice at once.
- **In use** (`stats.ts`, daily `content.statistics` job): with 30 or more
  scored answers, a question whose average score is 95%+ or 10%- or whose
  score goes down as learners' overall result goes up goes back to review
  (not one a person reviewed in the last 90 days).

Still open from Phase 4: Versant question types (only the 14 LanguageCert-style
types can be written); whole-form approval of mocks (questions are approved
one by one and mock forms are drawn per learner as in Phase 2); the
vocabulary-band check; comparing against published exam material (none
provided); cost in money (tokens are recorded; prices depend on the plan).
- **Recording lengths fixed**: every stored recording length
  (`item_audio.duration_ms`, 5,118 rows) was double the real one: it was
  estimated from the file size at 32 kbps, but Google's MP3s are 64 kbps.
  Lengths are now measured from the MP3 frames (`voice/mp3.ts`) and the
  stored ones were corrected (`scripts/fixAudioDurations.ts`).
