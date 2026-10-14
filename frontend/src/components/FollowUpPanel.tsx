import { useEffect, useMemo, useState } from "react";
import { X, Send, AlertTriangle } from "lucide-react";
import { Button } from "@/components/Button";
import {
  ENGAGEMENT_CLASS,
  ENGAGEMENT_LABEL,
  getLearnerEngagement,
  sendReminders,
  setAutoReminders,
  timeAgo,
  type EngagementOverview,
  type EngagementStatus,
  type LearnerEngagement,
} from "@/api/notifications";

const FOLLOW_UP: EngagementStatus[] = ["not_started", "inactive", "slow"];
const ORDER: EngagementStatus[] = ["not_started", "inactive", "slow", "on_track", "achieved"];

const TEMPLATES: Record<EngagementStatus, { title: string; message: (l: LearnerEngagement) => string }> = {
  not_started: {
    title: "Your English practice is ready",
    message: () => "Your access is active. Start with the placement test — it takes about 10 minutes and builds your personal plan.",
  },
  inactive: {
    title: "Let's get back to practice",
    message: (l) =>
      `You haven't practised in ${l.lastActiveAt ? timeAgo(l.lastActiveAt).replace(" ago", "") : "a while"}.${l.targetCefr ? ` Your batch goal is ${l.targetCefr}.` : ""} A 15-minute session today gets you back on track.`,
  },
  slow: {
    title: "A little extra practice this week",
    message: (l) => `You're a bit behind the path to ${l.targetCefr ?? "your goal"}. Try 20 minutes a day this week — it adds up fast.`,
  },
  on_track: { title: "Great progress — keep it up", message: () => "You're on track. Keep your daily practice going." },
  achieved: { title: "You reached your goal!", message: (l) => `Congratulations on reaching ${l.targetCefr ?? "your goal"}. Keep practising to stay sharp.` },
};

function name(l: LearnerEngagement): string {
  return [l.firstName, l.lastName].filter(Boolean).join(" ") || l.email;
}

function ReminderModal({ learners, onClose, onSent }: { learners: LearnerEngagement[]; onClose: () => void; onSent: (summary: string) => void }) {
  // One template per batch of recipients: use the most common status.
  const dominant = ORDER.reduce((best, s) =>
    learners.filter((l) => l.status === s).length > learners.filter((l) => l.status === best).length ? s : best,
  );
  const tpl = TEMPLATES[dominant];
  const [title, setTitle] = useState(tpl.title);
  const [message, setMessage] = useState(tpl.message(learners[0]));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cooling = learners.filter((l) => l.canRemindAt);

  async function send() {
    setSending(true);
    setError(null);
    try {
      const { results } = await sendReminders(learners.map((l) => l.id), title.trim(), message.trim());
      const sent = results.filter((r) => r.status === "sent").length;
      const skipped = results.filter((r) => r.status === "cooldown").length;
      onSent(`Reminder sent to ${sent} learner${sent === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped (reminded in the last 48h)` : ""}.`);
    } catch {
      setError("Couldn't send reminders.");
      setSending(false);
    }
  }

  const inputClass = "w-full rounded-input border border-rule bg-paper px-3 py-2 text-sm text-ink focus:border-navy focus:outline-none";
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-surface border border-rule rounded-card shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-rule">
          <h2 className="font-display font-bold text-lg text-ink">
            Send reminder{learners.length > 1 ? ` to ${learners.length} learners` : ` to ${name(learners[0])}`}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-ink transition-colors cursor-pointer">
            <X size={20} />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Subject</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-muted">Message</label>
            <textarea rows={4} value={message} onChange={(e) => setMessage(e.target.value)} className={inputClass} />
            <p className="text-xs text-muted">Sent by email and shown in their Spica notifications, signed with your name.</p>
          </div>
          {cooling.length > 0 && (
            <p className="text-xs text-navy-deep bg-warning/10 rounded-input px-3 py-2">
              {cooling.length} of them {cooling.length === 1 ? "was" : "were"} reminded in the last 48 hours and will be skipped.
            </p>
          )}
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="flex items-center gap-3">
            <Button onClick={send} disabled={sending || !title.trim() || !message.trim() || cooling.length === learners.length} className="flex-1 flex items-center justify-center gap-2">
              <Send size={15} /> {sending ? "Sending…" : "Send reminder"}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Who needs a nudge, and the tools to send one. Shared by the Org Admin
// (whole organization) and Manager (their batches) Learners pages — the
// server scopes the data by role.
export function FollowUpPanel() {
  const [data, setData] = useState<EngagementOverview | null>(null);
  const [filter, setFilter] = useState<EngagementStatus | "follow_up">("follow_up");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reminding, setReminding] = useState<LearnerEngagement[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    getLearnerEngagement()
      .then((d) => {
        setData(d);
        setSelected(new Set());
      })
      .catch(() => {});
  }
  useEffect(load, []);

  const rows = useMemo(() => {
    if (!data) return [];
    return data.learners
      .filter((l) => (filter === "follow_up" ? FOLLOW_UP.includes(l.status) : l.status === filter))
      .sort((a, b) => Number(b.needsAttention) - Number(a.needsAttention) || ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  }, [data, filter]);

  if (!data || data.learners.length === 0) return null;

  const counts = Object.fromEntries(ORDER.map((s) => [s, data.learners.filter((l) => l.status === s).length])) as Record<EngagementStatus, number>;
  const followUpCount = FOLLOW_UP.reduce((n, s) => n + counts[s], 0);
  const needsAttention = data.learners.filter((l) => l.needsAttention).length;
  const selectable = rows.filter((l) => !l.canRemindAt);
  const allSelected = selectable.length > 0 && selectable.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display font-bold text-ink">Follow up with learners</h2>
          <p className="text-xs text-muted mt-0.5">
            {followUpCount} need a nudge{needsAttention ? ` · ${needsAttention} still stuck after 2+ reminders` : ""}
          </p>
        </div>
        {data.batches.length > 0 && (
          <div className="flex flex-col items-end gap-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Automatic reminders</p>
            <div className="flex flex-wrap justify-end gap-1.5">
              {data.batches.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-xs text-ink bg-paper-warm rounded-pill px-2.5 py-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={b.autoReminders}
                    onChange={async (e) => {
                      const enabled = e.target.checked;
                      setData((d) => (d ? { ...d, batches: d.batches.map((x) => (x.id === b.id ? { ...x, autoReminders: enabled } : x)) } : d));
                      await setAutoReminders(b.id, enabled).catch(load);
                    }}
                    className="accent-navy"
                  />
                  {b.name}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-muted">Not started: day 3 & 7 · Inactive: day 7 & 14</p>
          </div>
        )}
      </div>

      {notice && <p className="text-sm text-success bg-success/10 border border-success/25 rounded-input px-3 py-2">{notice}</p>}

      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          onClick={() => setFilter("follow_up")}
          className={`px-3 py-1.5 rounded-pill text-xs font-semibold cursor-pointer ${filter === "follow_up" ? "bg-navy text-white" : "bg-paper-warm text-muted hover:text-ink"}`}
        >
          Needs a nudge · {followUpCount}
        </button>
        {ORDER.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-pill text-xs font-semibold cursor-pointer ${filter === s ? "bg-navy text-white" : "bg-paper-warm text-muted hover:text-ink"}`}
          >
            {ENGAGEMENT_LABEL[s]} · {counts[s]}
          </button>
        ))}
        {selected.size > 0 && (
          <Button
            onClick={() => setReminding(data.learners.filter((l) => selected.has(l.id)))}
            className="ml-auto !px-3 !py-1.5 !text-xs flex items-center gap-1.5"
          >
            <Send size={13} /> Remind {selected.size}
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nobody here right now.</p>
      ) : (
        <div className="border border-rule rounded-input overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-xs font-semibold uppercase tracking-wide text-muted bg-paper-warm/50">
                <th className="px-3 py-2 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((l) => l.id)))}
                    className="accent-navy"
                  />
                </th>
                <th className="px-3 py-2">Learner</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last active</th>
                <th className="px-3 py-2">Level</th>
                <th className="px-3 py-2">Reminders</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b border-rule last:border-0">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      disabled={!!l.canRemindAt}
                      onChange={() => toggle(l.id)}
                      className="accent-navy disabled:opacity-40"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <p className="text-ink font-medium flex items-center gap-1.5">
                      {l.needsAttention && <AlertTriangle size={13} className="text-error shrink-0" aria-label="Needs a personal follow-up" />}
                      {name(l)}
                    </p>
                    <p className="text-xs text-muted">{l.batchName ?? "No batch"}</p>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-pill whitespace-nowrap ${ENGAGEMENT_CLASS[l.status]}`}>{ENGAGEMENT_LABEL[l.status]}</span>
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{timeAgo(l.lastActiveAt)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {l.currentCefr ?? "—"}
                    {l.targetCefr ? ` → ${l.targetCefr}` : ""}
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap text-xs">
                    {l.remindersSent ? `${l.remindersSent} · last ${timeAgo(l.lastRemindedAt)}` : "None"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setReminding([l])}
                      disabled={!!l.canRemindAt}
                      title={l.canRemindAt ? `Reminded recently — available ${new Date(l.canRemindAt).toLocaleString()}` : "Send reminder"}
                      className="text-xs font-semibold text-navy hover:underline cursor-pointer disabled:text-muted disabled:no-underline disabled:cursor-not-allowed"
                    >
                      {l.canRemindAt ? "Reminded" : "Remind"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reminding && (
        <ReminderModal
          learners={reminding}
          onClose={() => setReminding(null)}
          onSent={(summary) => {
            setReminding(null);
            setNotice(summary);
            load();
          }}
        />
      )}
    </div>
  );
}
