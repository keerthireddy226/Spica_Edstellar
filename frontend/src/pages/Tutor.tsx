import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, RotateCcw } from "lucide-react";
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

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Mascot variant="coach" size={56} />
        <div className="flex-1 min-w-0">
          <h1 className="font-display font-bold text-xl text-ink">{t("nav.tutor")}</h1>
          <p className="text-xs text-muted">{t("tutor.subtitle")}</p>
        </div>
        <button
          onClick={handleNewConversation}
          disabled={loading || !sessionId}
          className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-ink transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          <RotateCcw size={15} strokeWidth={2} />
          {t("tutor.newConversation")}
        </button>
      </div>

      <div ref={scrollRef} className="bg-surface border border-rule rounded-card p-4 flex flex-col gap-3 h-[420px] overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted m-auto">{t("tutor.loading")}</p>
        ) : (
          <>
            {turns.map((turn, i) => (
              <div key={i} className={`flex ${turn.speaker === "learner" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[75%] rounded-card px-4 py-2.5 text-sm leading-relaxed ${
                    turn.speaker === "learner" ? "bg-accent/15 text-ink" : "bg-paper-warm text-ink"
                  }`}
                >
                  {turn.text}
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-paper-warm rounded-card px-4 py-2.5 text-sm text-muted italic">{t("tutor.typing")}</div>
              </div>
            )}
          </>
        )}
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      <div className="flex items-center gap-3 bg-surface border border-rule rounded-card px-4 py-3">
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
          className="flex-1 bg-transparent text-sm text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <Button onClick={handleSend} disabled={loading || sending || !text.trim()} className="shrink-0 !px-3 !py-2">
          <Send size={16} strokeWidth={2.2} />
        </Button>
      </div>
    </div>
  );
}
