-- Up Migration
-- LanguageCert Test of English (LTE) question types and test layouts, from the
-- LTE Qualification Handbooks (Listening & Reading v9.0, Speaking v4.0,
-- October 2025) and the published Writing format. Two new answer forms:
--   mcq_group: one recording or text with several multiple-choice questions
--              (content.questions[i].options, answer_set.correct[i]);
--   prep_seconds: preparation time before a spoken answer can start.

ALTER TABLE item_types ADD COLUMN prep_seconds integer;
ALTER TABLE item_types DROP CONSTRAINT item_types_input_method_check;
ALTER TABLE item_types ADD CONSTRAINT item_types_input_method_check
  CHECK (input_method IN ('mic', 'text', 'textarea', 'radio', 'two-phase', 'mcq_group'));

INSERT INTO item_types (id, name, skills, input_method, instruction_text, question_instruction, auto_advance, timer_seconds, min_words, max_words, estimated_seconds, prep_seconds) VALUES
  -- Listening: every recording can be played twice.
  ('lc_listen_mcq', 'Short Utterances', '{listening}', 'radio',
   'You will hear a short statement or question twice. Choose the word or phrase that matches what you hear.',
   'Listen and choose the right answer.', false, 30, NULL, NULL, 30, NULL),
  ('lc_listen_reply', 'Best Reply', '{listening}', 'radio',
   'You will hear something a person says, twice. Choose the best reply.',
   'Listen and choose the best reply.', false, 20, NULL, NULL, 25, NULL),
  ('lc_listen_dialogue', 'Complete the Dialogue', '{listening}', 'radio',
   'You will hear the start of a short conversation, twice. Choose the best way to continue or finish it.',
   'Listen and choose the best response.', false, 20, NULL, NULL, 30, NULL),
  ('lc_listen_conversation', 'Short Conversations', '{listening}', 'mcq_group',
   'You will hear a short conversation twice. Answer the questions about it.',
   'Listen and answer the questions.', false, 60, NULL, NULL, 90, NULL),
  ('lc_listen_long', 'Longer Listening', '{listening}', 'mcq_group',
   'You will hear a longer talk or conversation twice. Answer the questions about it.',
   'Listen and answer the questions.', false, 150, NULL, NULL, 240, NULL),
  -- Reading
  ('lc_read_short', 'Short Texts', '{reading}', 'radio',
   'Read the short text, such as a sign, notice or message. Choose the option that best describes it.',
   'Read and choose the best answer.', false, 60, NULL, NULL, 60, NULL),
  ('lc_read_cloze', 'Gapped Text', '{reading}', 'mcq_group',
   'Read the text. Choose the best word or phrase for each gap.',
   'Choose the best answer for each gap.', false, 300, NULL, NULL, 300, NULL),
  ('lc_read_gap', 'Gapped Sentences', '{reading}', 'radio',
   'Choose the word or phrase that best completes the sentence.',
   'Complete the sentence.', false, 40, NULL, NULL, 40, NULL),
  ('lc_read_long', 'Longer Texts', '{reading}', 'mcq_group',
   'Read the text and answer the questions.',
   'Read and answer the questions.', false, 480, NULL, NULL, 420, NULL),
  -- Writing: 1 hour for both tasks.
  ('lc_write_task1', 'Writing Task 1', '{writing}', 'textarea',
   'Read the situation and write a short message, such as an email or a note. Write 60 to 100 words.',
   'Write your message.', false, 1200, 60, 100, 1200, NULL),
  ('lc_write_task2', 'Writing Task 2', '{writing}', 'textarea',
   'Write a short report, article or review on the topic. Write 200 to 250 words.',
   'Write your text.', false, 2400, 200, 250, 2400, NULL),
  -- Speaking: an examiner asks the questions in the real test; here they are written.
  ('lc_speak_personal', 'Personal Questions', '{speaking}', 'mic',
   'Answer the question about yourself. Speak for about 30 seconds.',
   'Answer the question.', false, 45, NULL, NULL, 45, NULL),
  ('lc_speak_discussion', 'Discussion', '{speaking}', 'mic',
   'Read the situation and the ideas. Say which ideas are best and why, and reach a decision. Speak for about 2 minutes.',
   'Discuss the ideas and decide.', false, 150, NULL, NULL, 170, 20),
  ('lc_speak_presentation', 'Presenting a Topic', '{speaking}', 'mic',
   'You have 30 seconds to prepare. Then talk about the topic for about 2 minutes.',
   'Talk about the topic.', false, 150, NULL, NULL, 180, 30),
  ('lc_speak_followup', 'Follow-up Questions', '{speaking}', 'mic',
   'Answer the question about your topic. Speak for about 30 seconds.',
   'Answer the question.', false, 45, NULL, NULL, 45, NULL);

-- Layouts (one row per section; a grouped question counts once here).
INSERT INTO blueprint_sections (test_type_id, sort_order, label, item_type_id, item_count, minutes) VALUES
  -- Listening & Reading A1-C2: Listening 4 parts / 50 marks (about 50 min), Reading 4 parts / 60 marks (70 min).
  ('lcListeningReading', 1, 'Listening Part 1: Short utterances', 'lc_listen_mcq', 8, NULL),
  ('lcListeningReading', 2, 'Listening Part 2: Best reply', 'lc_listen_reply', 5, NULL),
  ('lcListeningReading', 3, 'Listening Part 2: Complete the dialogue', 'lc_listen_dialogue', 10, NULL),
  ('lcListeningReading', 4, 'Listening Part 3: Short conversations', 'lc_listen_conversation', 6, NULL),
  ('lcListeningReading', 5, 'Listening Part 4: Longer listening', 'lc_listen_long', 3, NULL),
  ('lcListeningReading', 6, 'Reading Part 1: Short texts', 'lc_read_short', 7, NULL),
  ('lcListeningReading', 7, 'Reading Part 2: Gapped texts', 'lc_read_cloze', 3, NULL),
  ('lcListeningReading', 8, 'Reading Part 3: Gapped sentences', 'lc_read_gap', 23, NULL),
  ('lcListeningReading', 9, 'Reading Part 4: Longer texts', 'lc_read_long', 3, NULL),
  -- Listening & Reading A1-B1: Listening 32 marks (about 30 min), Reading 40 marks (40 min).
  ('lcListeningReadingLower', 1, 'Listening Part 1: Short utterances', 'lc_listen_mcq', 8, NULL),
  ('lcListeningReadingLower', 2, 'Listening Part 2: Best reply', 'lc_listen_reply', 6, NULL),
  ('lcListeningReadingLower', 3, 'Listening Part 3: Short conversations', 'lc_listen_conversation', 4, NULL),
  ('lcListeningReadingLower', 4, 'Listening Part 4: Longer listening', 'lc_listen_long', 2, NULL),
  ('lcListeningReadingLower', 5, 'Reading Part 1: Short texts', 'lc_read_short', 8, NULL),
  ('lcListeningReadingLower', 6, 'Reading Part 2: Gapped texts', 'lc_read_cloze', 3, NULL),
  ('lcListeningReadingLower', 7, 'Reading Part 3: Gapped sentences', 'lc_read_gap', 7, NULL),
  ('lcListeningReadingLower', 8, 'Reading Part 4: Longer texts', 'lc_read_long', 2, NULL),
  -- Writing: 2 tasks, 1 hour.
  ('lcWriting', 1, 'Task 1: Short message', 'lc_write_task1', 1, 20),
  ('lcWriting', 2, 'Task 2: Report, article or review', 'lc_write_task2', 1, 40),
  -- Speaking: 3 parts, 10-14 minutes.
  ('lcSpeaking', 1, 'Part 1: Personal questions', 'lc_speak_personal', 3, NULL),
  ('lcSpeaking', 2, 'Part 2: Discussion', 'lc_speak_discussion', 1, NULL),
  ('lcSpeaking', 3, 'Part 3: Presenting a topic', 'lc_speak_presentation', 1, NULL),
  ('lcSpeaking', 4, 'Part 3: Follow-up questions', 'lc_speak_followup', 2, NULL);

-- 4 skills = Listening & Reading A1-C2 + Writing + Speaking, in that order.
INSERT INTO blueprint_sections (test_type_id, sort_order, label, item_type_id, item_count, minutes)
SELECT 'lcFourSkills', row_number() OVER (ORDER BY o, sort_order), label, item_type_id, item_count, minutes
FROM (
  SELECT 1 AS o, sort_order, label, item_type_id, item_count, minutes FROM blueprint_sections WHERE test_type_id = 'lcListeningReading'
  UNION ALL SELECT 2, sort_order, label, item_type_id, item_count, minutes FROM blueprint_sections WHERE test_type_id = 'lcWriting'
  UNION ALL SELECT 3, sort_order, label, item_type_id, item_count, minutes FROM blueprint_sections WHERE test_type_id = 'lcSpeaking'
) s;

-- Down Migration
DELETE FROM blueprint_sections WHERE test_type_id IN ('lcListeningReading', 'lcListeningReadingLower', 'lcWriting', 'lcSpeaking', 'lcFourSkills');
DELETE FROM item_types WHERE id LIKE 'lc\_%';
ALTER TABLE item_types DROP CONSTRAINT item_types_input_method_check;
ALTER TABLE item_types ADD CONSTRAINT item_types_input_method_check
  CHECK (input_method IN ('mic', 'text', 'textarea', 'radio', 'two-phase'));
ALTER TABLE item_types DROP COLUMN prep_seconds;
