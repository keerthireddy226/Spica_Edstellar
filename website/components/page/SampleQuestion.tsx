"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Eye, Headphones, Mic, Timer, Volume2 } from "lucide-react";

// A real practice question, played the way the Spica test plays it: press Play
// when ready, the recording plays once, and the answer timer starts when it ends.
export interface Sample {
  audio: string;
  task: string;
  instruction: string;
  seconds: number;
  answerBy: "speak" | "type";
  answer: string;
  // Conversations: the two people are announced as Speaker A and Speaker B.
  speakers?: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, "").replace(/\s+/g, " ").trim();

export function SampleQuestion({ s }: { s: Sample }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [stage, setStage] = useState<"ready" | "playing" | "answer" | "done">("ready");
  const [left, setLeft] = useState(s.seconds);
  const [typed, setTyped] = useState("");
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (stage !== "answer") return;
    const id = setInterval(() => setLeft((l) => Math.max(0, l - 1)), 1000);
    return () => clearInterval(id);
  }, [stage]);
  useEffect(() => {
    if (left === 0) setStage("done");
  }, [left]);
  useEffect(() => () => audio.current?.pause(), []);

  function play() {
    if (stage !== "ready") return;
    const a = new Audio(s.audio);
    audio.current = a;
    a.onended = () => setStage("answer");
    a.onerror = () => setStage("answer");
    setStage("playing");
    a.play().catch(() => setStage("answer"));
  }

  const correct = s.answerBy === "type" && typed.trim() !== "" && norm(typed) === norm(s.answer);
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div className="sq">
      <div className="sq-top">
        <span className="sq-task">{s.task}</span>
        <span className="sq-pills">
          {stage === "ready" && (
            <span className="sq-pill">
              <Volume2 size={14} aria-hidden="true" /> Press Play when you are ready
            </span>
          )}
          {stage === "playing" && (
            <span className="sq-pill" role="status">
              <Headphones size={14} aria-hidden="true" /> Listening… the timer starts after the recording
            </span>
          )}
          <span className="sq-pill plain">Question 1 of 1</span>
          {(stage === "answer" || stage === "done") && (
            <span className={`sq-timer${left <= 5 ? " low" : ""}`} role="timer">
              <Timer size={15} aria-hidden="true" /> {mm}
            </span>
          )}
        </span>
      </div>
      <p className="sq-instr">{s.instruction}</p>

      <div className="sq-body">
        <div className="sq-hear">
          <span className="sq-label">1 · Listen</span>
          {s.speakers && (
            <span className="sq-speakers" aria-hidden="true">
              <i>A</i>
              <i>B</i>
            </span>
          )}
          <button className="sq-play" onClick={play} disabled={stage !== "ready"} aria-label="Play the recording">
            <Volume2 size={22} aria-hidden="true" />
          </button>
          {stage === "playing" ? (
            <span className="sq-bars" aria-hidden="true">
              <b />
              <b />
              <b />
              <b />
            </span>
          ) : (
            <small>{stage === "ready" ? "The recording plays once." : "This recording has been played."}</small>
          )}
        </div>

        <div className="sq-say">
          <span className="sq-label">2 · {s.answerBy === "speak" ? "Answer out loud" : "Type what you heard"}</span>
          {stage === "ready" || stage === "playing" ? (
            <p className="muted">Play the question first, then answer here.</p>
          ) : s.answerBy === "speak" ? (
            <p className="sq-mic">
              <Mic size={18} aria-hidden="true" /> In the test you press the microphone and speak. Here, say your answer out loud, then check it.
            </p>
          ) : (
            <>
              <input className="sq-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type the sentence…" aria-label="Your answer" />
              {typed.trim() !== "" && (
                <p className={correct ? "sq-ok" : "muted"}>{correct ? <><Check size={16} aria-hidden="true" /> Exactly right.</> : "Check every word, then compare below."}</p>
              )}
            </>
          )}
          {(stage === "answer" || stage === "done") && (
            <button className="btn ghost small" onClick={() => setShown(true)} disabled={shown}>
              <Eye size={15} aria-hidden="true" /> Show the answer
            </button>
          )}
          {shown && (
            <p className="sq-answer">
              <b>Answer:</b> {s.answer}
            </p>
          )}
        </div>
      </div>
      <p className="sq-note">A real question from Spica&apos;s practice tests. Real test questions are never shown.</p>
    </div>
  );
}
