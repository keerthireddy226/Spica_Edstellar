import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Award, BookOpen, ClipboardCheck } from "lucide-react";
import { getMyAccess, type MyAccess, type Owned } from "@/api/access";
import { formatShortDate } from "@/api/licenses";
import { ROUTES } from "@/constants/routes";
import { tr } from "@/i18n/tr";

// What a learner owns besides a licence or the Plus plan: preparation for
// one test, a real test, a level test. Each says what it opens and until when.
export function useMyAccess(): MyAccess | null {
  const [a, setA] = useState<MyAccess | null>(null);
  useEffect(() => {
    getMyAccess()
      .then(setA)
      .catch(() => setA(null));
  }, []);
  return a;
}

function opens(o: Owned): string {
  if (o.kind === "prep") return tr("Practice tests, mock tests and Practice Modules for this test, then one real test with a certificate.");
  if (o.kind === "assessment") return tr("One real test, strictly proctored, with a score report and a certificate.");
  if (o.kind === "level") return tr("One level test at {{level}}. Pass it for that level's certificate.", { level: o.level ?? "—" });
  return tr("Every test, mock test and Practice Module.");
}

export function OwnedList({ access }: { access: MyAccess }) {
  const items = access.owned.filter((o) => o.kind !== "full");
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      {items.map((o) => {
        const Icon = o.kind === "prep" ? BookOpen : o.kind === "level" ? ClipboardCheck : Award;
        return (
          <div key={o.id} className="flex items-start gap-3 border border-rule rounded-xl px-3.5 py-3">
            <Icon size={18} className="text-navy-deep shrink-0 mt-0.5" />
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-semibold text-ink">{o.name}</span>
              <span className="text-xs text-muted">{opens(o)}</span>
              <span className="text-xs text-ink">
                {tr("Until {{date}}", { date: formatShortDate(o.endsAt) })}
                {o.kind !== "full" && ` · ${o.attemptsLeft === 1 ? tr("1 real test left") : tr("{{n}} real tests left", { n: o.attemptsLeft })}`}
              </span>
            </div>
          </div>
        );
      })}
      {access.attempts.length > 0 && (
        <Link to={ROUTES.MY_TESTS} className="self-start text-sm font-semibold text-navy-deep hover:underline">
          {tr("Go to My tests")}
        </Link>
      )}
    </div>
  );
}
