import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, RotateCcw, MessageCircle, Type, Lightbulb, Sparkles, CheckCircle2 } from "lucide-react";
import { HERO_GRADIENT, LearnerCard } from "@/components/learner/LearnerHero";
import { StatCard } from "@/components/staff/StaffKit";
import { Mascot } from "@/components/Mascot";
import { Button } from "@/components/Button";
import { startCoachSession, sendCoachMessage, endCoachSession, type CoachTurn } from "@/api/coach";

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

  useEffect(() => {
    startCoachSession()
      .then((res) => {
        setSessionId(res.sessionId);
        setTurns(res.turns);
      })
      .finally(() => setLoading(false));
  }, []);

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
    try {
      await endCoachSession(sessionId);
      const res = await startCoachSession();
      setSessionId(res.sessionId);
      setTurns(res.turns);
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
            <p className="text-sm text-muted m-auto">{t("tutor.loading")}</p>
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
                      className={`max-w-[72%] px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
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
          {turns.length <= 2 && !loading && (
            <div className="flex gap-2 flex-wrap">
              {STARTERS.slice(0, 3).map((q) => (
                <button key={q} onClick={() => setText(q)} className="text-xs font-medium px-3 py-1.5 rounded-pill bg-navy/10 text-navy-deep hover:bg-navy/20 transition-colors cursor-pointer">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 rounded-pill border border-rule-strong px-4 py-1.5 focus-within:border-navy transition-colors">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={loading || sending}
              placeholder={t("tutor.inputPlaceholder")}
              className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed py-1.5"
            />
            <Button onClick={handleSend} disabled={loading || sending || !text.trim()} className="shrink-0 !rounded-full !px-3 !py-2">
              <Send size={16} strokeWidth={2.2} />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <StatCard index={0} variant="pastel" palette="terracotta" icon={MessageCircle} label="Your messages" value={mine.length} />
          <StatCard index={0} variant="pastel" palette="moss" icon={Type} label="Words used" value={words} />
        </div>

        <LearnerCard title="Talk about…" icon={Lightbulb} color="#c9965c">
          <div className="flex flex-col gap-2">
            {STARTERS.map((q) => (
              <button
                key={q}
                onClick={() => setText(q)}
                className="text-left text-sm text-ink px-3.5 py-2.5 rounded-input bg-paper/70 hover:bg-navy/10 border border-transparent hover:border-navy/30 transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        </LearnerCard>

        <LearnerCard title="Tips" icon={Sparkles} color="var(--color-success)">
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
  "Can you help me practise a job interview?",
  "Let's talk about my weekend.",
  "How do I order food politely at a restaurant?",
  "Ask me questions about my hometown.",
  "Help me describe my daily routine.",
];

const TIPS = [
  "Answer in full sentences, not single words.",
  "Try a new word you learned today.",
  "Ask the tutor to correct your grammar.",
  "Keep going for at least five replies.",
];
