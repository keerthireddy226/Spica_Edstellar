-- Up Migration
-- Sentence Completion questions whose answer is more than one word say how
-- many words go in the gap (152 questions expect "must be", "would have"...),
-- and the instruction no longer says "the missing word".
UPDATE items i SET content = i.content || jsonb_build_object('blank_words', w.n)
FROM (
  SELECT id, min(array_length(regexp_split_to_array(trim(a), '\s+'), 1)) AS n
  FROM items, jsonb_array_elements_text(answer_set->'acceptable_answers') a
  WHERE item_type_id = 'sentence_completion'
  GROUP BY id
) w
WHERE i.id = w.id AND w.n > 1;
UPDATE item_types SET instruction_text = 'Read the sentence and type the missing word or words. If a word is shown in brackets, use the correct form of it.'
WHERE id = 'sentence_completion';

-- Down Migration
UPDATE items SET content = content - 'blank_words' WHERE item_type_id = 'sentence_completion';
UPDATE item_types SET instruction_text = 'Read the sentence and type the missing word. If a word is shown in brackets, use the correct form of it.'
WHERE id = 'sentence_completion';
