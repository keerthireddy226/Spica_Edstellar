import { useState } from "react";
import { Link } from "react-router-dom";
import type { OrgBatch, OrgCandidate } from "@/api/recruitment";
import { ROUTES } from "@/constants/routes";
import { useAuth } from "@/hooks/useAuth";
import { tr } from "@/i18n/tr";

const STATUS: Record<string, () => string> = {
  invited: () => tr("Invited"),
  started: () => tr("Started"),
  completed: () => tr("Finished"),
  expired: () => tr("Expired"),
};
const INTEGRITY: Record<string, [() => string, string]> = {
  clear: [() => tr("Clear"), "text-success"],
  cleared: [() => tr("Cleared"), "text-success"],
  flagged: [() => tr("Needs review"), "text-warning"],
  violation: [() => tr("Violation"), "text-error"],
  in_progress: [() => tr("In progress"), "text-muted"],
};
const REVIEW: Record<string, () => string> = {
  pending: () => tr("Review requested"),
  in_review: () => tr("Review in progress"),
  upheld: () => tr("Reviewed: score stands"),
  changed: () => tr("Reviewed: re-marked"),
  new_attempt: () => tr("Reviewed: free retake"),
  noted: () => tr("Reviewed: noted"),
};
const ISSUE: Record<string, () => string> = {
  audio: () => tr("audio"),
  camera_mic: () => tr("camera or microphone"),
  slow: () => tr("slow"),
  screen: () => tr("screen sharing"),
  other: () => tr("other"),
};

// Everyone the organization tested: their batch, result, integrity check,
// the feedback they gave after the test, and any score review.
// Totals for a group of candidates: invited, finished, average feedback.
function summary(list: OrgCandidate[]) {
  const rated = list.filter(
    (c) => c.feedback && !c.feedback.skipped && c.feedback.rating != null,
  );
  const avg = rated.length
    ? (
        rated.reduce((n, c) => n + (c.feedback!.rating ?? 0), 0) / rated.length
      ).toFixed(1)
    : null;
  const finished = list.filter((c) => c.status === "completed").length;
  return `${tr("{{n}} invited · {{f}} finished", { n: list.length, f: finished })}${avg ? ` · ${tr("Average feedback {{r}} / 5 from {{n}}", { r: avg, n: rated.length })}` : ""}`;
}

export function OrgCandidatesPanel({
  candidates,
  batches,
}: {
  candidates: OrgCandidate[] | null;
  batches: OrgBatch[];
}) {
  const { user } = useAuth();
  const [shown, setShown] = useState<string>("all");
  const integrityRoute =
    user?.role === "super_admin"
      ? ROUTES.SUPER_INTEGRITY
      : ROUTES.ADMIN_CONSOLE_INTEGRITY;
  if (candidates === null)
    return <p className="text-sm text-muted">{tr("Loading…")}</p>;
  if (candidates.length === 0)
    return <p className="text-sm text-muted">{tr("No candidates yet.")}</p>;
  // Batch by batch, newest batch first.
  const groups = batches
    .map((b) => ({
      batch: b,
      people: candidates.filter((c) => c.jobId === b.id),
    }))
    .filter((g) => g.people.length > 0);
  const visible =
    shown === "all" ? groups : groups.filter((g) => g.batch.id === shown);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">{summary(candidates)}</p>
      <div className="flex flex-wrap gap-2">
        {[
          { id: "all", title: tr("All batches") },
          ...groups.map((g) => g.batch),
        ].map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setShown(b.id)}
            className={`px-3 py-1.5 rounded-pill border text-sm cursor-pointer ${shown === b.id ? "border-navy bg-navy text-white" : "border-rule text-ink hover:bg-paper-warm"}`}
          >
            {b.title}
          </button>
        ))}
      </div>
      {visible.map(({ batch, people }) => (
        <div key={batch.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-display font-bold text-ink">
              {batch.title}
              {batch.status !== "open" && (
                <span className="ml-2 text-xs font-normal text-muted">
                  {tr("Closed")}
                </span>
              )}
            </p>
            <p className="text-xs text-muted">
              {tr("Created {{d}}", {
                d: new Date(batch.createdAt).toLocaleDateString(undefined, {
                  dateStyle: "medium",
                }),
              })}{" "}
              · {summary(people)}
            </p>
          </div>
          <div className="overflow-x-auto border border-rule rounded-input">
            <table className="w-full text-sm">
              <thead className="bg-paper-warm text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">{tr("Candidate")}</th>
                  <th className="px-3 py-2 font-semibold">{tr("Result")}</th>
                  <th className="px-3 py-2 font-semibold">{tr("Integrity")}</th>
                  <th className="px-3 py-2 font-semibold">{tr("Feedback")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((c) => {
                  const integ = c.integrity ? INTEGRITY[c.integrity] : null;
                  const f = c.feedback;
                  return (
                    <tr key={c.id} className="border-t border-rule align-top">
                      <td className="px-3 py-2.5">
                        <p className="font-semibold text-ink">
                          {c.name ?? c.email}
                        </p>
                        {c.name && (
                          <p className="text-xs text-muted">{c.email}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {c.status === "completed" ? (
                          <>
                            <p className="font-semibold text-ink">
                              {c.level ?? "—"}{" "}
                              {c.percent != null && (
                                <span className="font-normal text-muted">
                                  · {c.percent}%
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted">
                              {c.completedAt
                                ? new Date(c.completedAt).toLocaleString(
                                    undefined,
                                    { dateStyle: "medium", timeStyle: "short" },
                                  )
                                : ""}
                            </p>
                          </>
                        ) : (
                          <p className="text-muted">
                            {STATUS[c.status]?.() ?? c.status}
                          </p>
                        )}
                        {c.review && (
                          <p className="text-xs text-navy-deep font-semibold">
                            {REVIEW[c.review]?.() ?? c.review}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {integ ? (
                          <>
                            <p className={`font-semibold ${integ[1]}`}>
                              {integ[0]()}
                            </p>
                            {c.riskScore != null && (
                              <p className="text-xs text-muted">
                                {tr("Risk {{n}}", { n: c.riskScore })}
                              </p>
                            )}
                            {c.sessionId && (
                              <Link
                                to={`${integrityRoute}?session=${c.sessionId}`}
                                className="text-xs underline text-navy-deep"
                              >
                                {tr("Open the review")}
                              </Link>
                            )}
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 min-w-[14rem]">
                        {!f ? (
                          <span className="text-muted">
                            {c.status === "completed" ? tr("Not given") : "—"}
                          </span>
                        ) : f.skipped ? (
                          <span className="text-muted">{tr("Skipped")}</span>
                        ) : (
                          <>
                            <p className="text-ink">
                              {f.rating != null && (
                                <span className="font-semibold">
                                  {"★".repeat(f.rating)}
                                  {"☆".repeat(5 - f.rating)}
                                </span>
                              )}
                              {f.recommend != null && (
                                <span className="text-xs text-muted">
                                  {" "}
                                  ·{" "}
                                  {tr("recommend {{n}}/10", { n: f.recommend })}
                                </span>
                              )}
                            </p>
                            {f.smooth === false && (
                              <p className="text-xs text-error">
                                {tr("Didn't run smoothly")}
                                {f.issues.length > 0 &&
                                  `: ${f.issues.map((i) => ISSUE[i]?.() ?? i).join(", ")}`}
                              </p>
                            )}
                            {f.suggestion && (
                              <p className="text-xs text-ink mt-0.5">
                                “{f.suggestion}”
                              </p>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
