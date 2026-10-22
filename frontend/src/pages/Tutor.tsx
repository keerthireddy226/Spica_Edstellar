import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, RotateCcw, MessageCircle, Type, Lightbulb, Sparkles, CheckCircle2 } from "lucide-react";
import { HERO_GRADIENT, LearnerCard } from "@/components/learner/LearnerHero";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/Button";
import { startCoachSession, sendCoachMessage, endCoachSession, type CoachTurn } from "@/api/coach";

import { tr } from "@/i18n/tr";
// A real, working conversation with Gemini — one ongoing session resumed each visit.
export function Tutor() {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<CoachTurn[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // The conversation couldn't be opened: say so and offer a retry.
  const [startFailed, setStartFailed] = useState(false);

  function openSession() {
    setLoading(true);
    setStartFailed(false);
    startCoachSession()
      .then((res) => {
        setSessionId(res.sessionId);
        setTurns(res.turns);
      })
      .catch(() => setStartFailed(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    openSession();
  }, []);

  // A suggested topic goes into the box, ready to edit or send.
  function pickStarter(q: string) {
    setText(q);
    inputRef.current?.focus();
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, sending]);

  async function handleSend() {
    const message = text.trim();
    if (!message || !sessionId || sending) return;
    setSending(true);
    setError(null);
    setText("");
    setTurns((prev) => [...prev, { speaker: "learner", text: message }]);
    try {
      const res = await sendCoachMessage(sessionId, message);
      setTurns((prev) => [...prev, { speaker: "agent", text: res.reply }]);
    } catch {
      // The optimistic learner turn above was never actually persisted —
      // drop it (and restore the text) rather than leave it looking sent.
      setTurns((prev) => prev.slice(0, -1));
      setText(message);
      setError(t("tutor.sendError"));
    } finally {
      setSending(false);
    }
  }

  async function handleNewConversation() {
    if (!sessionId || !window.confirm(t("tutor.newConversationConfirm"))) return;
    setLoading(true);
    setError(null);
    try {
      await endCoachSession(sessionId);
      const res = await startCoachSession();
      setSessionId(res.sessionId);
      setTurns(res.turns);
    } catch {
      setError(tr("Couldn't start a new conversation. Try again."));
    } finally {
      setLoading(false);
    }
  }

  const mine = turns.filter((x) => x.speaker === "learner");
  const words = mine.reduce((n, x) => n + x.text.trim().split(/\s+/).filter(Boolean).length, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="bg-surface border border-rule rounded-card shadow-sm overflow-hidden flex flex-col h-[calc(100vh-150px)] min-h-[520px]">
        <div className="relative overflow-hidden flex items-center gap-4 px-5 py-4 text-white" style={{ background: HERO_GRADIENT }}>
          <span className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full bg-white/10" />
          <span className="relative h-14 w-14 rounded-2xl ring-2 ring-white/40 flex items-center justify-center shrink-0" style={{ background: "rgba(255,255,255,0.2)" }}>
            <Mascot variant="coach" size={48} />
          </span>
          <div className="relative flex-1 min-w-0">
            <h1 className="font-display font-bold text-xl">{t("nav.tutor")}</h1>
            <p className="text-xs text-white/85 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[#b9e3a8]" /> {t("tutor.subtitle")}
            </p>
          </div>
          <button
            onClick={handleNewConversation}
            disabled={loading || !sessionId}
            className="relative flex items-center gap-1.5 text-sm font-semibold bg-white text-navy-deep rounded-pill px-4 py-2 hover:bg-white/90 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <RotateCcw size={15} strokeWidth={2} />
            <span className="hidden sm:inline">{t("tutor.newConversation")}</span>
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 py-5 flex flex-col gap-4" style={{ background: "color-mix(in srgb, var(--color-paper) 55%, var(--color-surface))" }}>
          {loading ? (
            <p className="text-sm text-muted m-auto flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-navy/60 animate-pulse" /> {t("tutor.loading")}
            </p>
          ) : startFailed ? (
            <div className="m-auto flex flex-col items-center gap-3 text-center max-w-xs">
              <p className="text-sm text-ink">{tr("The tutor couldn't start a conversation right now.")}</p>
              <Button variant="secondary" onClick={openSession}>
                <span className="flex items-center gap-1.5">
                  <RotateCcw size={15} /> {tr("Try again")}
                </span>
              </Button>
            </div>
          ) : (
            <>
              {turns.map((turn, i) => {
                const me = turn.speaker === "learner";
                return (
                  <div key={i} className={`flex items-end gap-2.5 ${me ? "justify-end" : "justify-start"}`}>
                    {!me && (
                      <span className="h-8 w-8 rounded-full bg-surface border border-rule flex items-center justify-center shrink-0 overflow-hidden">
                        <Mascot variant="coach" size={26} />
                      </span>
                    )}
                    <div
                      className={`max-w-[85%] sm:max-w-[72%] px-4 py-2.5 text-sm leading-relaxed shadow-sm whitespace-pre-wrap break-words ${
                        me ? "text-white rounded-2xl rounded-br-md" : "bg-surface text-ink border border-rule rounded-2xl rounded-bl-md"
                      }`}
                      style={me ? { background: "linear-gradient(135deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 75%, black))" } : undefined}
                    >
                      {turn.text}
                    </div>
                  </div>
                );
              })}
              {sending && (
                <div className="flex items-end gap-2.5">
                  <span className="h-8 w-8 rounded-full bg-surface border border-rule flex items-center justify-center shrink-0 overflow-hidden">
                    <Mascot variant="coach" size={26} />
                  </span>
                  <div className="bg-surface border border-rule rounded-2xl rounded-bl-md px-4 py-3 flex gap-1">
                    {[0, 1, 2].map((d) => (
                      <span key={d} className="h-2 w-2 rounded-full bg-navy/50 animate-bounce" style={{ animationDelay: `${d * 0.15}s` }} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {error && <p className="text-sm text-error px-5 pt-2">{error}</p>}

        <div className="border-t border-rule px-4 py-3 flex flex-col gap-2.5 bg-surface">
          {turns.length <= 2 && !loading && !startFailed && (
            <div className="flex gap-2 flex-wrap lg:hidden">
              {STARTERS.slice(0, 3).map((q) => (
                <button key={q} onClick={() => pickStarter(q)} className="text-xs font-medium px-3 py-1.5 rounded-pill bg-navy/10 text-navy-deep hover:bg-navy/20 transition-colors cursor-pointer">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 rounded-pill border border-rule-strong px-4 py-1.5 focus-within:border-navy transition-colors">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={loading || sending || !sessionId}
              placeholder={t("tutor.inputPlaceholder")}
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed py-1.5"
            />
            <Button onClick={handleSend} disabled={loading || sending || !sessionId || !text.trim()} aria-label={tr("Send")} className="shrink-0 !rounded-full !px-3 !py-2">
              <Send size={16} strokeWidth={2.2} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              [MessageCircle, tr("Your messages"), mine.length, "var(--color-navy)"],
              [Type, tr("Words used"), words, "var(--color-accent)"],
            ] as const
          ).map(([Icon, label, value, color]) => (
            <div key={label} className="bg-surface border border-rule rounded-card shadow-sm p-4 flex flex-col gap-2 min-w-0">
              <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white" style={{ background: color }}>
                <Icon size={17} />
              </span>
              <p className="font-display font-bold text-2xl text-ink leading-none mt-1">{value}</p>
              <p className="text-xs text-muted truncate">{label}</p>
            </div>
          ))}
        </div>

        <LearnerCard title={tr("Talk about…")} icon={Lightbulb} color="#c9965c">
          <div className="flex flex-col gap-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => pickStarter(q)}
                className="text-left text-sm text-ink px-3.5 py-2.5 rounded-input bg-paper/70 hover:bg-navy/10 border border-transparent hover:border-navy/30 transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </LearnerCard>

        <LearnerCard title={tr("Tips")} icon={Sparkles} color="var(--color-success)">
          <ul className="flex flex-col gap-2.5 text-sm text-ink">
            {TIPS.map((tip) => (
              <li key={tip} className="flex gap-2">
                <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> {tip}
              </li>
            ))}
          </ul>
        </LearnerCard>
      </div>
    </div>
  );
}

const STARTERS = [
  tr("Can you help me practise a job interview?"),
  tr("Let's talk about my weekend."),
  tr("How do I order food politely at a restaurant?"),
  tr("Ask me questions about my hometown."),
  tr("Help me describe my daily routine."),
];

const TIPS = [
  tr("Answer in full sentences, not single words."),
  tr("Try a new word you learned today."),
  tr("Ask the tutor to correct your grammar."),
  tr("Keep going for at least five replies."),
];
