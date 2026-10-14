import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ShieldAlert, Check, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/Button";
import { getPendingReviewPlacements, reviewPlacement, type PendingPlacement } from "@/api/adminReview";
import { ROUTES } from "@/constants/routes";

const ADMIN_ROLES = ["admin", "super_admin"];

export function AdminReview() {
  const { user } = useAuth();
  const [placements, setPlacements] = useState<PendingPlacement[] | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  function load() {
    getPendingReviewPlacements()
      .then((res) => setPlacements(res.placements))
      .catch(() => setError("Could not load pending reviews."));
  }

  async function handleVerdict(id: string, verdict: "certified" | "fraud_confirmed") {
    setActingOn(id);
    try {
      await reviewPlacement(id, verdict);
      setPlacements((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch {
      setError("Something went wrong recording that verdict.");
    } finally {
      setActingOn(null);
    }
  }

  if (!user || !ADMIN_ROLES.includes(user.role)) return <Navigate to={ROUTES.DASHBOARD} replace />;

  return (
    <div className="flex flex-col gap-4 w-full max-w-4xl mx-auto">
      <div>
        <h1 className="font-display font-bold text-2xl text-ink">Placement reviews</h1>
        <p className="text-sm text-muted mt-1">
          Placements flagged during a face check — not blocked for the learner, just awaiting a verdict here.
        </p>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {placements === null && !error && <p className="text-sm text-muted">Loading…</p>}

      {placements?.length === 0 && <p className="text-sm text-muted">Nothing pending review right now.</p>}

      {placements?.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded-card p-5 flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-ink">{p.name?.trim() || p.email}</p>
              <p className="text-xs text-muted">
                {p.email}
                {p.org_name ? ` · ${p.org_name}` : " · Individual learner"}
              </p>
              <p className="text-xs text-muted mt-0.5">
                {new Date(p.taken_at).toLocaleString()} &middot; {p.cefr_level} &middot; {p.overall_percent}%
              </p>
            </div>
            <span className="flex items-center gap-1.5 text-xs font-medium text-warning bg-warning/15 rounded-pill px-3 py-1 shrink-0">
              <ShieldAlert size={14} /> {p.flagged_checks.length} flagged check{p.flagged_checks.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {p.flagged_checks.map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-xs bg-paper-warm rounded-input px-3 py-2">
                <span className="font-mono uppercase text-error font-semibold">{c.decision}</span>
                {c.similarityScore !== null && <span className="text-muted">similarity {Number(c.similarityScore).toFixed(2)}</span>}
                <span className="text-muted">{new Date(c.createdAt).toLocaleTimeString()}</span>
                {c.sampleUri && (
                  <a href={c.sampleUri} target="_blank" rel="noreferrer" className="text-navy-deep hover:underline ml-auto">
                    view photo
                  </a>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={() => handleVerdict(p.id, "certified")} disabled={actingOn === p.id} className="flex-1">
              <Check size={15} className="inline mr-1.5" /> Confirm, it's them
            </Button>
            <Button variant="secondary" onClick={() => handleVerdict(p.id, "fraud_confirmed")} disabled={actingOn === p.id} className="flex-1 text-error">
              <X size={15} className="inline mr-1.5" /> Not them
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
