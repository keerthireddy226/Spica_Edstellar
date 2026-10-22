import { tr } from "@/i18n/tr";

// Which question bank an exam belongs to (owner decision 2026-10-22):
// practice sets, mock tests and real tests never share questions.
export type ExamBank = "practice" | "mock" | "assessment";

export function bankLabel(bank: ExamBank | null | undefined): string {
  if (bank === "mock") return tr("Mock bank");
  if (bank === "assessment") return tr("Real-test bank");
  return tr("Practice set");
}
