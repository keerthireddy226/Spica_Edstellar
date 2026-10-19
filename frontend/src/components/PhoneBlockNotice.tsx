import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Laptop, Link2 } from "lucide-react";
import { Button } from "@/components/Button";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// On a phone, practice tests, mock exams and the level test can't start:
// they run like the real exam, on a computer. Learners keep practising in
// Practice Modules, or copy the link to open on a computer.
export function PhoneBlockNotice({ what }: { what: "tests" | "mock" | "level" }) {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const title =
    what === "level" ? tr("Use a computer for your level test") : what === "mock" ? tr("Use a computer for mock exams") : tr("Use a computer for practice tests");
  const body =
    what === "level"
      ? tr("The level test runs like the real exam, on a computer with a camera and microphone. Open this page on a computer to take it.")
      : tr("Practice tests and mock exams run like the real exam, on a computer with a camera and microphone. On your phone you can keep practising in Practice Modules.");
  return (
    <section className="rounded-card border border-navy/20 bg-navy/5 p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-2xl bg-navy/10 text-navy-deep flex items-center justify-center shrink-0">
          <Laptop size={20} />
        </span>
        <div className="min-w-0">
          <p className="font-display font-bold text-ink">{title}</p>
          <p className="text-sm text-muted">{body}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {what !== "level" && <Button onClick={() => navigate(ROUTES.MODULES)}>{tr("Practise on my phone")}</Button>}
        <Button
          variant="secondary"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).then(() => setCopied(true));
          }}
        >
          <span className="flex items-center gap-1.5">
            <Link2 size={15} /> {copied ? tr("Link copied") : tr("Copy link for my computer")}
          </span>
        </Button>
      </div>
    </section>
  );
}
