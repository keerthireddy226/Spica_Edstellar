// Shared by placement and practice routes — same item shape either way,
// `skills` included only when the caller's query actually selected it.
export function toItemPayload(row: {
  id: string;
  item_type_id: string;
  content: unknown;
  skills?: string[];
  input_method: string;
  instruction_text: string;
  question_instruction: string;
  timer_seconds: number | null;
  two_phase_read_seconds: number | null;
  two_phase_write_seconds: number | null;
  // Only selected where the screen needs them (practice tests).
  prep_seconds?: number | null;
  min_words?: number | null;
  max_words?: number | null;
}) {
  return {
    id: row.id,
    itemTypeId: row.item_type_id,
    content: row.content,
    ...(row.skills ? { skills: row.skills } : {}),
    inputMethod: row.input_method,
    instructionText: row.instruction_text,
    questionInstruction: row.question_instruction,
    timerSeconds: row.timer_seconds,
    twoPhaseReadSeconds: row.two_phase_read_seconds,
    twoPhaseWriteSeconds: row.two_phase_write_seconds,
    prepSeconds: row.prep_seconds ?? null,
    minWords: row.min_words ?? null,
    maxWords: row.max_words ?? null,
  };
}
