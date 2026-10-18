-- Up Migration
-- Most Sentence Completion questions have no word to change: the old wording
-- ("the correct form of the word shown") confused learners when none was shown.
UPDATE item_types SET instruction_text = 'Read the sentence and type the missing word. If a word is shown in brackets, use the correct form of it.'
WHERE id = 'sentence_completion';

-- Down Migration
UPDATE item_types SET instruction_text = 'Complete the sentence by filling in the blank with the correct form of the word shown.'
WHERE id = 'sentence_completion';
