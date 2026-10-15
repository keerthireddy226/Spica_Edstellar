import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CheckCircle2, IdCard, Lock, Mic, MonitorX, RotateCcw, ScanLine, ShieldCheck, Square, Video } from "lucide-react";
import { Button } from "@/components/Button";
import {
  giveProctoringConsent,
  submitIdentity,
  uploadRoomScan,
  uploadVoiceBaseline,
  type DocumentType,
  type ProctoringSetup,
} from "@/api/proctoring";
import type { ProctoringState } from "@/hooks/useProctoring";
import { tr } from "@/i18n/tr";

type Step = "secure_browser" | "consent" | "identity" | "room" | "voice" | "start";

function stepsFor(s: ProctoringSetup): Step[] {
  const p = s.policy;
  const steps: Step[] = [];
  if (p.secureBrowser && s.secureBrowser !== true) steps.push("secure_browser");
  if (s.consentNeeded) steps.push("consent");
  if (p.idVerification && (!s.identity || s.identity.status === "rejected")) steps.push("identity");
  if (p.roomScan && !s.roomScanDone) steps.push("room");
  if (p.voiceMatch && !s.biometricOptOut && !s.voiceBaselineDone) steps.push("voice");
  steps.push("start");
  return steps;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function Card({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="max-w-lg mx-auto bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-5">
      <div className="flex flex-col items-center text-center gap-2">
        <span className="h-14 w-14 rounded-2xl bg-navy/15 text-navy-deep flex items-center justify-center">{icon}</span>
        <h1 className="font-display font-bold text-xl text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

// The camera for the ID photo and room scan steps, switched off as soon as
// the step closes.
function useStepCamera(enabled: boolean, audio = false) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let s: MediaStream | null = null;
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio })
      .then((got) => {
        if (cancelled) return got.getTracks().forEach((t) => t.stop());
        s = got;
        setStream(got);
        if (videoRef.current) videoRef.current.srcObject = got;
      })
      .catch(() => setError(true));
    return () => {
      cancelled = true;
      s?.getTracks().forEach((t) => t.stop());
      setStream(null);
    };
  }, [enabled, audio]);
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);
  const capture = (): string | null => {
    const v = videoRef.current;
    if (!v?.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  };
  return { videoRef, stream, error, capture };
}

const MONITORED: { key: keyof ProctoringSetup["policy"]; label: () => string }[] = [
  { key: "lockdown", label: () => tr("Copy and paste are turned off; leaving the test tab is recorded") },
  { key: "requireFullscreen", label: () => tr("The test runs in full screen") },
  { key: "multiMonitorCheck", label: () => tr("Second screens are detected (Chrome and Edge)") },
  { key: "webcamMonitoring", label: () => tr("Camera snapshots check that you're present and alone, with no phone in view") },
  { key: "faceMatch", label: () => tr("Your face is compared with your enrolled photo") },
  { key: "voiceMatch", label: () => tr("Your spoken answers are compared with a short voice sample") },
  { key: "roomScan", label: () => tr("A short video of your room before you start") },
  { key: "idVerification", label: () => tr("A photo of your ID document and a selfie") },
  { key: "liveMonitoring", label: () => tr("A proctor may watch live and message you") },
];

function ConsentStep({ setup, sessionId, onDone }: { setup: ProctoringSetup; sessionId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = setup.policy;
  async function accept(biometric: boolean) {
    setBusy(true);
    setError(null);
    try {
      await giveProctoringConsent(sessionId, biometric);
      onDone();
    } catch {
      setError(tr("Could not save your choice. Try again."));
      setBusy(false);
    }
  }
  return (
    <Card icon={<ShieldCheck size={26} />} title={tr("This test is proctored")} subtitle={tr("Your organization uses these checks to make sure results are fair.")}>
      <ul className="flex flex-col gap-2">
        {MONITORED.filter((m) => p[m.key]).map((m) => (
          <li key={m.key} className="flex items-start gap-2 text-sm text-ink">
            <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> {m.label()}
          </li>
        ))}
      </ul>
      <div className="bg-paper-warm rounded-input p-3 text-xs text-muted leading-relaxed flex flex-col gap-1.5">
        <p>{tr("Snapshots, recordings and ID images are kept for {{days}} days, then deleted. Only your organization's reviewers can see them. Nothing is sold or shared.", { days: p.retentionDays })}</p>
        <p>{tr("Nothing here fails you automatically. Anything unusual is checked by a person before any decision.")}</p>
        {p.region === "us" && setup.biometric && (
          <p>{tr("Face and voice data are biometric identifiers. By choosing face and voice matching you give written consent to their collection for this test, under the retention period above.")}</p>
        )}
        {setup.biometric && <p>{tr("You can choose a manual identity check instead of face and voice matching. A reviewer then confirms who you are; it doesn't affect your score.")}</p>}
      </div>
      {error && <p className="text-sm text-error text-center">{error}</p>}
      {setup.biometric ? (
        <div className="flex flex-col gap-2">
          <Button onClick={() => accept(true)} disabled={busy}>
            {tr("I agree, including face and voice matching")}
          </Button>
          <Button variant="secondary" onClick={() => accept(false)} disabled={busy}>
            {tr("I agree, but check my identity manually")}
          </Button>
        </div>
      ) : (
        <Button onClick={() => accept(false)} disabled={busy}>
          {tr("I agree, continue")}
        </Button>
      )}
    </Card>
  );
}

const DOC_TYPES: [DocumentType, () => string][] = [
  ["passport", () => tr("Passport")],
  ["national_id", () => tr("National ID card")],
  ["driving_licence", () => tr("Driving licence")],
  ["other", () => tr("Other photo ID")],
];

function IdentityStep({ sessionId, rejected, onDone }: { sessionId: string; rejected: boolean; onDone: () => void }) {
  const [docType, setDocType] = useState<DocumentType>("passport");
  const [documentImage, setDocumentImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { videoRef, stream, error: camError, capture } = useStepCamera(true);
  async function takeSelfieAndSubmit() {
    const selfie = capture();
    if (!selfie || !documentImage) return;
    setBusy(true);
    setError(null);
    try {
      await submitIdentity({ documentType: docType, documentBase64: documentImage, selfieBase64: selfie, sessionId });
      onDone();
    } catch {
      setError(tr("Could not upload your ID. Try again."));
      setBusy(false);
    }
  }
  return (
    <Card
      icon={<IdCard size={26} />}
      title={tr("Verify your identity")}
      subtitle={documentImage ? tr("Now look at the camera for a selfie.") : tr("Hold your photo ID up to the camera, photo side facing it, and take a picture.")}
    >
      {rejected && <p className="text-sm text-error text-center">{tr("Your last ID check wasn't accepted. Please try again with a clear photo.")}</p>}
      {!documentImage && (
        <label className="flex flex-col gap-1 text-sm text-ink">
          {tr("Document")}
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocumentType)} className="rounded-input border border-rule bg-surface px-3 py-2 text-sm">
            {DOC_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l()}
              </option>
            ))}
          </select>
        </label>
      )}
      <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-card bg-ink aspect-video object-cover" />
      {camError && <p className="text-sm text-error text-center">{tr("Allow camera access in your browser to continue.")}</p>}
      {error && <p className="text-sm text-error text-center">{error}</p>}
      {!documentImage ? (
        <Button onClick={() => setDocumentImage(capture())} disabled={!stream}>
          <Camera size={16} className="inline mr-1.5" />
          {tr("Take ID photo")}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <img src={`data:image/jpeg;base64,${documentImage}`} alt={tr("ID photo")} className="h-24 self-center rounded-lg border border-rule" />
          <Button onClick={takeSelfieAndSubmit} disabled={busy || !stream}>
            <Camera size={16} className="inline mr-1.5" />
            {busy ? tr("Uploading...") : tr("Take selfie and submit")}
          </Button>
          <Button variant="secondary" onClick={() => setDocumentImage(null)} disabled={busy}>
            <RotateCcw size={14} className="inline mr-1.5" />
            {tr("Retake ID photo")}
          </Button>
        </div>
      )}
      <p className="text-xs text-muted text-center">{tr("A reviewer checks your ID. You can start the test while they do.")}</p>
    </Card>
  );
}

const ROOM_SCAN_SECONDS = 12;

function RoomScanStep({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const { videoRef, stream, error: camError } = useStepCamera(true);
  const [left, setLeft] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function record() {
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : MediaRecorder.isTypeSupported("video/webm") ? "video/webm" : "video/mp4";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 350_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = async () => {
      setBusy(true);
      try {
        const blob = new Blob(chunks, { type: mime });
        await uploadRoomScan(sessionId, await blobToBase64(blob), mime);
        onDone();
      } catch {
        setError(tr("Could not upload the room scan. Try again."));
        setBusy(false);
        setLeft(null);
      }
    };
    recorder.start(1000);
    let n = ROOM_SCAN_SECONDS;
    setLeft(n);
    const timer = setInterval(() => {
      n -= 1;
      setLeft(n);
      if (n <= 0) {
        clearInterval(timer);
        recorder.stop();
      }
    }, 1000);
  }
  return (
    <Card icon={<ScanLine size={26} />} title={tr("Show your room")} subtitle={tr("Slowly turn your camera or laptop around the room, then show your desk. It takes {{n}} seconds.", { n: ROOM_SCAN_SECONDS })}>
      <div className="relative">
        <video ref={videoRef} autoPlay playsInline muted className="w-full rounded-card bg-ink aspect-video object-cover" />
        {left !== null && left > 0 && <span className="absolute top-2 right-2 bg-error text-white text-xs font-bold rounded-pill px-2 py-1">● {left}s</span>}
      </div>
      {camError && <p className="text-sm text-error text-center">{tr("Allow camera access in your browser to continue.")}</p>}
      {error && <p className="text-sm text-error text-center">{error}</p>}
      <Button onClick={record} disabled={!stream || left !== null || busy}>
        <Video size={16} className="inline mr-1.5" />
        {busy ? tr("Uploading...") : left !== null ? tr("Recording...") : tr("Start room scan")}
      </Button>
    </Card>
  );
}

const VOICE_PASSAGE =
  "Good communication at work starts with listening. When a colleague explains a problem, I try to repeat the main points back to them, ask one or two clear questions, and agree on the next step before the meeting ends. Writing a short summary afterwards helps everyone remember what was decided and who is responsible for each task.";

function VoiceStep({ sessionId, minSeconds, onDone }: { sessionId: string; minSeconds: number; onDone: () => void }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);
  async function start() {
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setBusy(true);
        try {
          const r = await uploadVoiceBaseline(sessionId, await blobToBase64(new Blob(chunks, { type: mime })), mime);
          if (r.ok) return onDone();
          setMessage(tr("We heard about {{n}} seconds of speech. Read the whole passage again, a little louder.", { n: r.speechSeconds }));
        } catch {
          setMessage(tr("Could not upload the recording. Try again."));
        }
        setBusy(false);
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setMessage(tr("Allow microphone access in your browser to continue."));
    }
  }
  function stop() {
    recorderRef.current?.stop();
    setRecording(false);
  }
  return (
    <Card icon={<Mic size={26} />} title={tr("Record a voice sample")} subtitle={tr("Read the passage aloud at a normal pace. Your spoken answers are compared with it after the test.")}>
      <p className="bg-paper-warm rounded-input p-4 text-sm text-ink leading-relaxed">{VOICE_PASSAGE}</p>
      {message && <p className="text-sm text-error text-center">{message}</p>}
      {!recording ? (
        <Button onClick={start} disabled={busy}>
          <Mic size={16} className="inline mr-1.5" />
          {busy ? tr("Checking...") : tr("Start reading")}
        </Button>
      ) : (
        <Button onClick={stop}>
          <Square size={14} className="inline mr-1.5" />
          {tr("I've finished")}
        </Button>
      )}
      <p className="text-xs text-muted text-center">{tr("At least {{n}} seconds of speech is needed.", { n: minSeconds })}</p>
    </Card>
  );
}

// Everything the organization's policy asks for before a proctored test,
// one step at a time. Steps already done (a resumed session) are skipped.
export function ProctoringGate({ proctor, sessionId }: { proctor: ProctoringState; sessionId: string }) {
  const { setup } = proctor;
  const [checking, setChecking] = useState(false);
  if (!setup) return null;
  const step = stepsFor(setup)[0];
  const next = async () => {
    setChecking(true);
    await proctor.refreshSetup();
    setChecking(false);
  };

  if (checking) return null;

  if (step === "secure_browser") {
    return (
      <Card icon={<Lock size={26} />} title={tr("Open this test in Safe Exam Browser")} subtitle={tr("Your organization requires a locked-down browser for this test.")}>
        <ol className="list-decimal pl-5 text-sm text-ink flex flex-col gap-1.5">
          <li>{tr("Install Safe Exam Browser from safeexambrowser.org (Windows or macOS).")}</li>
          <li>{tr("Open the configuration file your organization sent you. It starts Safe Exam Browser with the right settings.")}</li>
          <li>{tr("Sign in again inside Safe Exam Browser and open this test.")}</li>
        </ol>
        <Button variant="secondary" onClick={next}>
          <MonitorX size={16} className="inline mr-1.5" />
          {tr("Check again")}
        </Button>
      </Card>
    );
  }
  if (step === "consent") return <ConsentStep setup={setup} sessionId={sessionId} onDone={next} />;
  if (step === "identity") return <IdentityStep sessionId={sessionId} rejected={setup.identity?.status === "rejected"} onDone={next} />;
  if (step === "room") return <RoomScanStep sessionId={sessionId} onDone={next} />;
  if (step === "voice") return <VoiceStep sessionId={sessionId} minSeconds={setup.voiceBaselineMinSeconds} onDone={next} />;

  const p = setup.policy;
  return (
    <Card icon={<ShieldCheck size={26} />} title={tr("Ready to start")} subtitle={tr("Monitoring starts when you begin.")}>
      <ul className="flex flex-col gap-2">
        {MONITORED.filter((m) => p[m.key] && !(setup.biometricOptOut && (m.key === "faceMatch" || m.key === "voiceMatch"))).map((m) => (
          <li key={m.key} className="flex items-start gap-2 text-sm text-ink">
            <CheckCircle2 size={16} className="text-success shrink-0 mt-0.5" /> {m.label()}
          </li>
        ))}
      </ul>
      {setup.biometricOptOut && <p className="text-xs text-muted">{tr("You chose a manual identity check. A reviewer will confirm who you are.")}</p>}
      <Button
        onClick={() => {
          if (p.requireFullscreen) document.documentElement.requestFullscreen?.().catch(() => {});
          proctor.markReady();
        }}
      >
        {p.requireFullscreen ? tr("Enter full screen and start") : tr("Start the test")}
      </Button>
    </Card>
  );
}
