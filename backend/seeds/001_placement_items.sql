-- Seed content for the placement test's 10 item types (6 spoken, from the
-- Versant English Test; 4 typed, from the Versant Writing Test). 2 items per
-- type, hand-authored as a starter set. All items land as status='draft' —
-- per the items table's intended workflow, a reviewer still needs to approve
-- each one (set review_decision + reviewer_id) before it's usable in a real
-- session. The 6 mic-based types need real audio recorded/generated for
-- item_audio before they're actually playable; this only seeds the text.
-- Re-runnable: safe to run against any environment via
--   psql "$DATABASE_URL" -f seeds/001_placement_items.sql

BEGIN;

INSERT INTO item_types (id, name, skills, input_method, instruction_text, question_instruction, timer_seconds, min_words, max_words, estimated_seconds) VALUES
('reading', 'Reading', ARRAY['speaking'], 'mic',
  'Read the sentence below aloud, as naturally as you can.',
  'Read this sentence aloud.', 15, NULL, NULL, 25),
('repeats', 'Repeats', ARRAY['listening','speaking'], 'mic',
  'You will hear a sentence once. Repeat it back exactly as you heard it.',
  'Repeat the sentence you just heard.', 15, NULL, NULL, 25),
('short_answer', 'Short Answer Questions', ARRAY['listening','speaking'], 'mic',
  'You will hear a short question. Answer it in a few words.',
  'Answer the question you just heard.', 10, NULL, NULL, 20),
('sentence_builds', 'Sentence Builds', ARRAY['listening','speaking'], 'mic',
  'You will hear three groups of words in random order. Say them back as one correct sentence.',
  'Put the word groups you just heard into a correct sentence, and say it aloud.', 20, NULL, NULL, 30),
('story_retelling', 'Story Retelling', ARRAY['listening','speaking'], 'mic',
  'You will hear a short story. Retell it in your own words.',
  'Retell the story you just heard, in your own words.', 60, NULL, NULL, 90),
('open_questions', 'Open Questions', ARRAY['speaking'], 'mic',
  'Answer the question with your own opinion. Speak for about 40 seconds.',
  'Give your answer.', 45, NULL, NULL, 60),
('dictation', 'Dictation', ARRAY['listening','writing'], 'text',
  'You will hear a sentence. Type exactly what you hear, word for word.',
  'Type exactly what you hear.', 30, NULL, NULL, 40),
('sentence_completion', 'Sentence Completion', ARRAY['reading', 'writing'], 'text',
  'Complete the sentence by filling in the blank with the correct form of the word shown.',
  'Fill in the blank.', 20, NULL, NULL, 30),
('passage_reconstruction', 'Passage Reconstruction', ARRAY['reading','writing'], 'textarea',
  'The passage below has a few grammar or word-choice errors. Rewrite it correctly.',
  'Find and correct the errors in this passage.', 60, 15, 60, 90),
('free_writing', 'Free Writing', ARRAY['writing'], 'textarea',
  'Respond to the prompt in 2-3 sentences.',
  'Write your response.', 90, 15, 50, 110)
ON CONFLICT (id) DO NOTHING;

-- Reading (read aloud) — pronunciation only, no listening component
INSERT INTO items (item_type_id, content, status, pipeline_version, topic) VALUES
('reading', '{"text": "The train to the city center leaves every fifteen minutes during rush hour."}', 'draft', 'manual', 'travel'),
('reading', '{"text": "Despite the heavy rainfall, the outdoor concert continued as scheduled."}', 'draft', 'manual', 'events');

-- Repeats — hear it, repeat it exactly
INSERT INTO items (item_type_id, content, answer_set, status, pipeline_version, topic) VALUES
('repeats', '{"text": "Can you tell me what time the meeting starts tomorrow?"}', '{"exact": "Can you tell me what time the meeting starts tomorrow?"}', 'draft', 'manual', 'work'),
('repeats', '{"text": "The company decided to postpone the product launch until next quarter."}', '{"exact": "The company decided to postpone the product launch until next quarter."}', 'draft', 'manual', 'work');

-- Short Answer Questions — hear a question, answer in a few words
INSERT INTO items (item_type_id, content, answer_set, status, pipeline_version, topic) VALUES
('short_answer', '{"question": "What do you call the meal you eat in the morning?"}', '{"acceptable_answers": ["breakfast"]}', 'draft', 'manual', 'daily-life'),
('short_answer', '{"question": "What foldable item do you open above your head to stay dry when it rains?"}', '{"acceptable_answers": ["an umbrella", "umbrella"]}', 'draft', 'manual', 'daily-life');

-- Sentence Builds — hear 3 jumbled word groups, speak them in correct order
INSERT INTO items (item_type_id, content, answer_set, status, pipeline_version, topic) VALUES
('sentence_builds', '{"groups": ["to the store", "she went", "yesterday afternoon"]}', '{"correct": "She went to the store yesterday afternoon.", "alternates": ["Yesterday afternoon, she went to the store.", "Yesterday afternoon she went to the store."]}', 'draft', 'manual', 'daily-life'),
('sentence_builds', '{"groups": ["is studying", "for her exam", "my sister"]}', '{"correct": "My sister is studying for her exam."}', 'draft', 'manual', 'education');

-- Story Retelling — hear a short story, retell it in your own words
INSERT INTO items (item_type_id, content, status, pipeline_version, topic) VALUES
('story_retelling', '{"story": "Maria left home a little late and missed her usual bus. Instead of waiting for the next one, she decided to walk to the metro station, which took about ten minutes. She caught a train just in time and actually arrived at work five minutes earlier than usual."}', 'draft', 'manual', 'daily-life'),
('story_retelling', '{"story": "On his way to lunch, Daniel found a wallet lying on the sidewalk. He opened it, found an ID card, and walked to the address printed on it. The owner, an elderly man, was so relieved that he invited Daniel in for tea to thank him."}', 'draft', 'manual', 'daily-life');

-- Open Questions — ~40s spoken opinion
INSERT INTO items (item_type_id, content, status, pipeline_version, topic) VALUES
('open_questions', '{"prompt": "Do you think it is better to live in a big city or a small town? Why?"}', 'draft', 'manual', 'opinion'),
('open_questions', '{"prompt": "What is one skill you would like to learn, and why does it interest you?"}', 'draft', 'manual', 'opinion');

-- Dictation — type exactly what is heard
INSERT INTO items (item_type_id, content, answer_set, word_count, status, pipeline_version, topic) VALUES
('dictation', '{"text": "Please remember to bring your identification card to the appointment."}', '{"exact": "Please remember to bring your identification card to the appointment."}', 10, 'draft', 'manual', 'appointments'),
('dictation', '{"text": "The museum will be closed for renovations until early next year."}', '{"exact": "The museum will be closed for renovations until early next year."}', 11, 'draft', 'manual', 'events');

-- Sentence Completion — typed grammar item
INSERT INTO items (item_type_id, content, answer_set, status, pipeline_version, topic) VALUES
('sentence_completion', '{"sentence": "If he ___ (practice) every day, he would improve much faster.", "hint_word": "practice"}', '{"acceptable_answers": ["practiced"]}', 'draft', 'manual', 'grammar'),
('sentence_completion', '{"sentence": "By the time we arrived, the movie ___ (already / start).", "hint_word": "already / start"}', '{"acceptable_answers": ["had already started"]}', 'draft', 'manual', 'grammar');

-- Passage Reconstruction / Error Correction — fix a short passage with grammar errors
INSERT INTO items (item_type_id, content, answer_set, status, pipeline_version, topic) VALUES
('passage_reconstruction', '{"passage": "Yesterday I go to the market and buy some fresh vegetable. The prices was higher than last week, but I still found good deal."}', '{"corrected": "Yesterday I went to the market and bought some fresh vegetables. The prices were higher than last week, but I still found a good deal."}', 'draft', 'manual', 'daily-life'),
('passage_reconstruction', '{"passage": "She have been working at that company since three years. Her manager say she is one of the best employee on the team."}', '{"corrected": "She has been working at that company for three years. Her manager says she is one of the best employees on the team."}', 'draft', 'manual', 'work');

-- Free Writing — short typed response to a prompt
INSERT INTO items (item_type_id, content, status, pipeline_version, topic) VALUES
('free_writing', '{"prompt": "Describe your typical morning routine in 2-3 sentences."}', 'draft', 'manual', 'daily-life'),
('free_writing', '{"prompt": "Write a short message to a friend inviting them to an event this weekend."}', 'draft', 'manual', 'social');

COMMIT;
