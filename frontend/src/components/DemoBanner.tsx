import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Award, Sparkles } from "lucide-react";
import { getMyAccess, type DemoState, type MyAccess } from "@/api/access";
import { tr } from "@/i18n/tr";
import { useAuth } from "@/hooks/useAuth";
import { DetailModal } from "@/components/DetailModal";
import { Button } from "@/components/Button";

const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

// Pop-ups for demo learners (user, 19 Nov 2026): what the demo includes, at
// first sign-in; the 3-day grace once per sign-in; and, if a session is still
// open after the grace, a notice that closes the app.
function DemoPopups({ a }: { a: MyAccess }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const d = a.demo;
  const after = a.demoAfter;
  const key = d ? `spica-demo-welcome:${user?.id}` : after?.phase === "grace" ? `spica-demo-grace:${user?.id}:${after.endedAt}` : null;
  const [open, setOpen] = useState(() => {
    if (after?.phase === "closed") return true;
    if (!key) return false;
    try {
      return !(d ? localStorage : sessionStorage).getItem(key);
    } catch {
      return true;
    }
  });
  if (!open) return null;
  const close = () => {
    try {
      if (key) (d ? localStorage : sessionStorage).setItem(key, "1");
    } catch {
      /* storage blocked: it shows again next time */
    }
    setOpen(false);
  };
  if (after?.phase === "closed")
    return (
      <DetailModal title={tr("Your demo has ended")} icon={Sparkles} onClose={() => {}}>
        <div className="flex flex-col gap-3 text-sm">
          <p>{tr("Your 7-day demo ended on {{d}}, and the 3 days to see your results are over. Ask your organisation's admin for a paid licence to keep practising and take the final assessment.", { d: fmt(after.endedAt) })}</p>
          <div className="flex justify-end">
            <Button onClick={() => logout().finally(() => navigate("/learner/login"))}>{tr("Sign out")}</Button>
          </div>
        </div>
      </DetailModal>
    );
  return (
    <DetailModal title={d ? tr("Welcome to your 7-day demo") : tr("Your demo has ended")} icon={Sparkles} onClose={close}>
      <div className="flex flex-col gap-3 text-sm">
        {d ? (
          <>
            <p>{tr("Until {{d}} you can use English 4 Skills Essentials: Practice Modules, practice tests (Sets 1 and 2) and 1 mock test, which opens after a practice test.", { d: fmt(d.endsAt) })}</p>
            <p>{tr("The demo has no real test and no certificate. After the 7 days you have 3 more days to sign in and see your reports, but not to practise.")}</p>
          </>
        ) : after ? (
          <p>{tr("Your 7-day demo ended on {{d}}. Until {{g}} you can sign in and see your reports, but not practise. After that you need a paid licence to sign in. Ask your organisation's admin about full access.", { d: fmt(after.endedAt), g: fmt(after.graceUntil) })}</p>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={close}>{tr("I understand")}</Button>
        </div>
      </div>
    </DetailModal>
  );
}

// Channel Partner demo learners (stage 3): what the 7-day demo includes and
// what's left, and a "talk to us" note once it has ended.
export function DemoBanner() {
  const [d, setD] = useState<{ demo: DemoState | null; ended: boolean; access: MyAccess } | null>(null);
  const onReport = /report/i.test(useLocation().pathname);
  useEffect(() => {
    getMyAccess()
      .then((a) => setD({ demo: a.demo ?? null, ended: !!a.demoEnded && !a.full && !a.owned.length, access: a }))
      .catch(() => setD(null));
  }, []);
  if (!d || (!d.demo && !d.ended && !d.access.demoAfter)) return null;
  const popups = <DemoPopups a={d.access} />;
  if (!d.demo) {
    const after = d.access.demoAfter;
    return (
      <>
        {popups}
        <div className="mb-4 rounded-card border border-navy/30 bg-navy/10 px-4 py-3 text-sm flex flex-wrap items-center gap-2">
          <Sparkles size={16} className="text-navy shrink-0" />
          <b>{tr("Your 7-day demo has ended.")}</b>
          {onReport && <b className="text-error">{tr("Demo · not an official result")}</b>}
          {after?.phase === "grace" ? (
            <span>{tr("Until {{d}} you can sign in and see your reports, but not practise. Ask your organisation's admin for a paid licence.", { d: fmt(after.graceUntil) })}</span>
          ) : (
            <span>{tr("Your reports stay here. Talk to your organisation or Spica about full access and an official certificate.")}</span>
          )}
        </div>
      </>
    );
  }
  const x = d.demo;
  const days = Math.max(0, Math.ceil((new Date(x.endsAt).getTime() - Date.now()) / 86400000));
  return (
    <>
    {popups}
    <div className="mb-4 rounded-card border border-warning/50 bg-warning/15 px-4 py-3 text-sm flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="flex items-center gap-1.5 font-bold">
        <Sparkles size={16} /> {tr("Demo · {{n}} days left", { n: days })}
      </span>
      {onReport && <span className="font-bold text-error">{tr("Demo · not an official result")}</span>}
      <span>{tr("English 4 Skills Essentials: Practice Modules, practice tests {{p}} of 2 left, mock test {{m}} of 1 left.", { p: x.practiceLeft, m: x.mocksLeft })}</span>
      {x.mocksLeft > 0 && !x.mockUnlocked && <span className="text-muted">{tr("The mock test opens after you finish a practice test.")}</span>}
      <Link to="/certificate/SAMPLE" target="_blank" className="flex items-center gap-1 font-semibold text-navy">
        <Award size={14} /> {tr("No certificate in the demo: see the sample")}
      </Link>
      <span className="text-muted">{tr("Then 3 days to see your results.")}</span>
    </div>
    </>
  );
}
