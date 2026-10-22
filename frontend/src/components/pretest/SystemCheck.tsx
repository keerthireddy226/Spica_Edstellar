import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Mic, Monitor, Play, RotateCcw, Square, Volume2, VolumeX, Wifi, XCircle } from "lucide-react";
import { Button } from "@/components/Button";
import {
  MAX_PING_MS,
  MIN_DOWN_MBPS,
  MIN_UP_MBPS,
  connectionPasses,
  holdForSession,
  measureConnection,
  type ConnectionResult,
  type DeviceCheckResult,
  type DeviceNeeds,
  type NoiseLevel,
} from "@/lib/systemCheck";
import { roomNoiseFrom } from "@/lib/roomNoise";
import { tr } from "@/i18n/tr";

// "active" is waiting on the learner; "running" is the check working by itself.
type RowStatus = "waiting" | "active" | "running" | "pass" | "fail" | "warn";

const RECORD_SECONDS = 4;
const NOISE_SECONDS = 3;
// RMS of the processed mic signal: a test recording that never peaks above
// this heard nothing. Room noise is judged in lib/roomNoise.ts.
const SPEECH_PEAK = 0.05;

function StatusChip({ status }: { status: RowStatus }) {
  if (status === "running") return <Loader2 size={18} className="text-muted animate-spin shrink-0" />;
  if (status === "pass") return <CheckCircle2 size={18} className="text-success shrink-0" />;
  if (status === "fail") return <XCircle size={18} className="text-error shrink-0" />;
  if (status === "warn") return <AlertTriangle size={18} className="text-warning shrink-0" />;
  return <span className={`h-[18px] w-[18px] rounded-full border-2 shrink-0 ${status === "active" ? "border-navy" : "border-rule-strong"}`} />;
}

function Row({ icon, title, status, summary, children }: { icon: ReactNode; title: string; status: RowStatus; summary?: string; children?: ReactNode }) {
  return (
    <div className={`border rounded-card p-4 flex flex-col gap-3 ${status === "waiting" ? "border-rule opacity-60" : "border-rule-strong bg-surface"}`}>
      <div className="flex items-center gap-3">
        <span className="h-9 w-9 rounded-xl bg-paper-warm text-ink flex items-center justify-center shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {summary && <p className="text-xs text-muted">{summary}</p>}
        </div>
        <StatusChip status={status} />
      </div>
      {children && status !== "waiting" && <div className="flex flex-col gap-3 pl-12">{children}</div>}
    </div>
  );
}

function Tips({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 text-xs text-muted flex flex-col gap-1">
      {items.map((t) => (
        <li key={t}>{t}</li>
      ))}
    </ul>
  );
}

function browserName(): "edge" | "firefox" | "chrome" | "safari" | "other" {
  const ua = navigator.userAgent;
  if (ua.includes("Edg/")) return "edge";
  if (ua.includes("Firefox/")) return "firefox";
  if (ua.includes("Chrome/")) return "chrome";
  if (ua.includes("Safari/")) return "safari";
  return "other";
}

function unblockMicSteps(): string[] {
  const b = browserName();
  const steps =
    b === "firefox"
      ? [tr("Click the crossed-out microphone icon in the address bar."), tr("Remove the block, then press Try again.")]
      : b === "safari"
        ? [tr("Open Safari > Settings for This Website."), tr("Set Microphone to Allow, then press Try again.")]
        : [tr("Click the icon to the left of the address bar (site settings)."), tr("Set Microphone to Allow, then reload the page.")];
  return [...steps, tr("Also check your computer's privacy settings allow the browser to use the microphone.")];
}

// A short three-note chime, made in the browser so it doesn't depend on any download.
function playChime(): Promise<void> {
  const ctx = new AudioContext();
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + i * 0.35;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.3, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.65);
  });
  return new Promise((resolve) =>
    setTimeout(() => {
      ctx.close().catch(() => {});
      resolve();
    }, notes.length * 350 + 400),
  );
}

type MicStage = "idle" | "asking" | "denied" | "not_found" | "busy" | "unsupported" | "noise" | "ready" | "recording" | "silent" | "review" | "pass";

// Microphone access, a background-noise reading, and a short test recording
// the learner plays back.
function useMicCheck() {
  const [stage, setStage] = useState<MicStage>("idle");
  const [level, setLevel] = useState(0);
  const [noise, setNoise] = useState<NoiseLevel | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string>("");
  const [clipUrl, setClipUrl] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The same microphone without noise suppression or automatic gain, for the
  // room reading (the processed signal hides steady noise).
  const rawStreamRef = useRef<MediaStream | null>(null);
  const roomAnalyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);

  const release = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    rawStreamRef.current?.getTracks().forEach((t) => t.stop());
    rawStreamRef.current = null;
    roomAnalyserRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }, []);

  // A few seconds of the room while the learner stays silent. Sampled on a
  // timer, not animation frames, so a hidden tab still gets a reading.
  const measureRoom = useCallback(async (): Promise<NoiseLevel> => {
    const analyser = roomAnalyserRef.current;
    if (!analyser) return "quiet";
    const data = new Float32Array(analyser.fftSize);
    const readings: number[] = [];
    const timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      readings.push(Math.sqrt(sum / data.length));
    }, 100);
    await new Promise((r) => setTimeout(r, NOISE_SECONDS * 1000));
    clearInterval(timer);
    return roomNoiseFrom(readings) ?? "quiet";
  }, []);

  useEffect(() => release, [release]);
  useEffect(() => () => {
    if (clipUrl) URL.revokeObjectURL(clipUrl);
  }, [clipUrl]);

  const open = useCallback(
    async (id?: string) => {
      release();
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        setStage("unsupported");
        return;
      }
      setStage("asking");
      let stream: MediaStream;
      try {
        // Same processing as the real test recording, so the test recording sounds like what gets graded.
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(id ? { deviceId: { exact: id } } : {}) },
        });
      } catch (err) {
        const name = err instanceof DOMException ? err.name : "";
        setStage(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" || name === "OverconstrainedError" ? "not_found" : "busy");
        return;
      }
      streamRef.current = stream;
      const deviceId = stream.getAudioTracks()[0]?.getSettings().deviceId ?? id;
      // Without it (a browser that won't open the microphone twice) the room
      // is read from the processed signal, which misses steady noise.
      const raw = await navigator.mediaDevices
        .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } })
        .catch(() => null);
      if (streamRef.current !== stream) {
        raw?.getTracks().forEach((t) => t.stop());
        return; // switched device meanwhile
      }
      rawStreamRef.current = raw;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      // Created after the permission prompt, outside the click: Safari (and
      // Chrome before any click) starts it suspended, and a suspended
      // context's analyser reads silence.
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const roomAnalyser = ctx.createAnalyser();
      roomAnalyser.fftSize = 2048;
      ctx.createMediaStreamSource(raw ?? stream).connect(roomAnalyser);
      roomAnalyserRef.current = roomAnalyser;
      const data = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        peakRef.current = Math.max(peakRef.current, rms);
        setLevel(Math.min(1, rms * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      setDevices(all.filter((d) => d.kind === "audioinput"));
      setDeviceId(deviceId ?? "");

      // A few seconds of silence first: how loud is the room?
      setStage("noise");
      const room = await measureRoom();
      if (streamRef.current !== stream) return; // switched device meanwhile
      setNoise(room);
      setStage("ready");
    },
    [release, measureRoom],
  );

  const record = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      setClipUrl(URL.createObjectURL(new Blob(chunks, { type: mime })));
      setStage(peakRef.current < SPEECH_PEAK ? "silent" : "review");
    };
    peakRef.current = 0;
    setClipUrl(null);
    recorder.start();
    setStage("recording");
    setTimeout(() => recorder.state === "recording" && recorder.stop(), RECORD_SECONDS * 1000);
  }, []);

  // Measures the room again, for a learner who moved somewhere quieter.
  const [noiseBusy, setNoiseBusy] = useState(false);
  const remeasureNoise = useCallback(async () => {
    const stream = streamRef.current;
    if (!stream) return;
    setNoiseBusy(true);
    const room = await measureRoom();
    if (streamRef.current === stream) setNoise(room);
    setNoiseBusy(false);
  }, [measureRoom]);

  return { stage, setStage, level, noise, noiseBusy, devices, deviceId, clipUrl, open, record, release, remeasureNoise };
}

function LevelMeter({ level }: { level: number }) {
  return (
    <div className="h-2.5 w-full rounded-pill bg-paper-warm overflow-hidden" aria-label={tr("Microphone level")}>
      <div className={`h-full rounded-pill transition-[width] duration-75 ${level > 0.15 ? "bg-success" : "bg-muted"}`} style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function browserIssues(needs: DeviceNeeds, phoneOk: boolean): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  const canRecord = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  if (needs.mic && !canRecord) blocking.push(tr("This browser can't record from a microphone here. Use the latest Chrome, Edge, Firefox or Safari."));
  if (needs.speaker && typeof AudioContext === "undefined") blocking.push(tr("This browser can't play the test audio. Use the latest Chrome, Edge, Firefox or Safari."));
  if (!phoneOk && window.innerWidth < 768) warnings.push(tr("Your screen is small. Use a computer or laptop for the test if you can."));
  return { blocking, warnings };
}

// The device check before a test: connection, speakers, microphone and room
// noise. Only a passed check lets the learner continue.
export function SystemCheck({
  needs,
  onPassed,
  onBack,
  phoneOk = false,
}: {
  needs: DeviceNeeds;
  onPassed: (r: DeviceCheckResult) => void;
  onBack?: () => void;
  // Practice Modules work on a phone: no "use a computer" warning.
  phoneOk?: boolean;
}) {
  const [issues] = useState(() => browserIssues(needs, phoneOk));
  const [conn, setConn] = useState<{ status: RowStatus; result?: ConnectionResult }>({ status: "running" });
  const [speaker, setSpeaker] = useState<"idle" | "playing" | "asked" | "pass" | "fail">("idle");
  const mic = useMicCheck();

  const runConnection = useCallback(() => {
    setConn({ status: "running" });
    measureConnection()
      .then((result) => setConn({ status: connectionPasses(result) ? "pass" : "fail", result }))
      .catch(() => setConn({ status: "fail" }));
  }, []);

  useEffect(() => {
    runConnection();
  }, [runConnection]);

  function finish(result: DeviceCheckResult) {
    mic.release();
    holdForSession(result);
    onPassed(result);
  }

  const connOk = conn.status === "pass";
  const speakerOk = !needs.speaker || speaker === "pass";
  const micOk = !needs.mic || mic.stage === "pass";
  const allOk = connOk && speakerOk && micOk && issues.blocking.length === 0;
  const c = conn.result;

  const speakerStatus: RowStatus = !connOk ? "waiting" : speaker === "pass" ? "pass" : speaker === "fail" ? "fail" : speaker === "playing" ? "running" : "active";
  const micActive = connOk && speakerOk;
  // Measured as soon as the microphone opens; a noisy room warns but never blocks.
  const noiseStatus: RowStatus =
    mic.stage === "noise" || mic.noiseBusy ? "running" : mic.noise === "noisy" ? "warn" : mic.noise === "quiet" ? "pass" : "waiting";
  const micStatus: RowStatus = !micActive
    ? "waiting"
    : mic.stage === "pass"
      ? "pass"
      : ["denied", "not_found", "busy", "unsupported", "silent"].includes(mic.stage)
        ? "fail"
        : ["asking", "noise", "recording"].includes(mic.stage)
          ? "running"
          : "active";

  return (
    <Shell onBack={onBack}>
      {issues.blocking.map((m) => (
        <p key={m} className="flex items-start gap-2 text-sm text-error bg-error/10 rounded-input p-3">
          <XCircle size={16} className="shrink-0 mt-0.5" /> {m}
        </p>
      ))}
      {issues.warnings.map((m) => (
        <p key={m} className="flex items-start gap-2 text-sm text-ink bg-warning/15 rounded-input p-3">
          <Monitor size={16} className="shrink-0 mt-0.5" /> {m}
        </p>
      ))}

      <Row
        icon={<Wifi size={18} />}
        title={tr("Internet connection")}
        status={conn.status}
        summary={
          conn.status === "running"
            ? tr("Measuring your connection...")
            : c
              ? tr("Download {{d}} Mbps · upload {{u}} Mbps · delay {{p}} ms", { d: c.downMbps, u: c.upMbps, p: c.pingMs })
              : tr("We couldn't reach the test server.")
        }
      >
        {conn.status === "fail" && (
          <>
            {c && (
              <p className="text-xs text-ink">
                {tr("Needed: at least {{d}} Mbps download, {{u}} Mbps upload, and a delay under {{p}} ms.", { d: MIN_DOWN_MBPS, u: MIN_UP_MBPS, p: MAX_PING_MS })}
              </p>
            )}
            <Tips
              items={[
                tr("Move closer to your Wi-Fi router, or use a network cable."),
                tr("Close video calls, streaming and large downloads on this network."),
                tr("Check you are online, then try again."),
              ]}
            />
            <Button variant="secondary" className="self-start" onClick={runConnection}>
              <RotateCcw size={15} className="inline mr-1.5" />
              {tr("Try again")}
            </Button>
          </>
        )}
      </Row>

      {needs.speaker && (
        <Row
          icon={<Volume2 size={18} />}
          title={tr("Speakers or headphones")}
          status={speakerStatus}
          summary={speaker === "pass" ? tr("You can hear the test audio.") : tr("Headphones are best: the questions are spoken aloud.")}
        >
          {speaker !== "pass" && (
            <>
              <Button
                variant="secondary"
                className="self-start"
                disabled={speaker === "playing"}
                onClick={() => {
                  setSpeaker("playing");
                  playChime().then(() => setSpeaker("asked"));
                }}
              >
                <Play size={15} className="inline mr-1.5" />
                {speaker === "playing" ? tr("Playing...") : speaker === "idle" ? tr("Play a sound") : tr("Play again")}
              </Button>
              {(speaker === "asked" || speaker === "fail") && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-ink">{tr("Did you hear three notes?")}</span>
                  <Button className="!py-1.5" onClick={() => setSpeaker("pass")}>
                    {tr("Yes, I heard them")}
                  </Button>
                  <Button variant="secondary" className="!py-1.5" onClick={() => setSpeaker("fail")}>
                    {tr("No")}
                  </Button>
                </div>
              )}
              {speaker === "fail" && (
                <Tips
                  items={[
                    tr("Turn the volume up and check the sound isn't muted."),
                    tr("If you use headphones, check they're plugged in or connected, and chosen as the sound output."),
                    tr("Then play the sound again."),
                  ]}
                />
              )}
            </>
          )}
        </Row>
      )}

      {needs.mic && (
        <Row
          icon={<Mic size={18} />}
          title={tr("Microphone")}
          status={micStatus}
          summary={mic.stage === "pass" ? tr("Your microphone works.") : tr("Your browser needs microphone access, for spoken answers and to check the room is quiet.")}
        >
          {mic.stage !== "pass" && <MicBody mic={mic} />}
        </Row>
      )}

      {needs.mic && (
        <Row
          icon={<VolumeX size={18} />}
          title={tr("Background noise")}
          status={noiseStatus}
          summary={
            mic.noise === "quiet" && !mic.noiseBusy
              ? tr("The room is quiet.")
              : mic.noise === "noisy" && !mic.noiseBusy
                ? tr("The room sounds noisy.")
                : tr("Measured when the microphone turns on: stay quiet for 3 seconds.")
          }
        >
          {mic.noise === "noisy" && !mic.noiseBusy && (
            <>
              <p role="alert" className="text-xs text-ink bg-warning/15 rounded-input p-3">
                {tr("Background noise can lower your speaking score. Move somewhere quieter or close the windows. Even a fan can be noisy.")}
              </p>
              <Button variant="secondary" className="self-start" disabled={mic.stage === "recording"} onClick={mic.remeasureNoise}>
                <RotateCcw size={15} className="inline mr-1.5" />
                {tr("Check the room again")}
              </Button>
            </>
          )}
          {mic.noiseBusy && <p className="text-sm text-ink">{tr("Stay quiet for a moment while we listen to the room...")}</p>}
        </Row>
      )}

      <Button
        disabled={!allOk}
        onClick={() =>
          finish(
            {
              connection: c!,
              mic: needs.mic ? "ok" : "not_needed",
              speaker: needs.speaker ? "ok" : "not_needed",
              noise: needs.mic ? mic.noise : null,
              at: new Date().toISOString(),
            },
          )
        }
      >
        {/* A noisy room warns but never blocks: the learner may have nowhere quieter. */}
        {!allOk ? tr("Finish the checks to continue") : needs.mic && mic.noise === "noisy" ? tr("Continue anyway") : tr("Continue")}
      </Button>
    </Shell>
  );
}

function MicBody({ mic }: { mic: ReturnType<typeof useMicCheck> }) {
  const { stage } = mic;
  if (stage === "pass") return null;
  if (stage === "idle") {
    return (
      <Button variant="secondary" className="self-start" onClick={() => mic.open()}>
        <Mic size={15} className="inline mr-1.5" />
        {tr("Allow microphone")}
      </Button>
    );
  }
  if (stage === "asking") return <p className="text-sm text-ink">{tr("Your browser is asking for microphone access. Choose Allow.")}</p>;
  if (stage === "unsupported") return <p className="text-sm text-error">{tr("This browser can't record from a microphone here. Use the latest Chrome, Edge, Firefox or Safari.")}</p>;
  if (stage === "denied" || stage === "not_found" || stage === "busy") {
    return (
      <>
        <p className="text-sm text-error">
          {stage === "denied"
            ? tr("Microphone access is blocked.")
            : stage === "not_found"
              ? tr("No microphone was found.")
              : tr("The microphone couldn't start. Another app may be using it.")}
        </p>
        <Tips
          items={
            stage === "denied"
              ? unblockMicSteps()
              : stage === "not_found"
                ? [tr("Plug in a headset or microphone."), tr("Then press Try again.")]
                : [tr("Close other apps that use the microphone, such as video calls."), tr("Then press Try again.")]
          }
        />
        <Button variant="secondary" className="self-start" onClick={() => mic.open()}>
          <RotateCcw size={15} className="inline mr-1.5" />
          {tr("Try again")}
        </Button>
      </>
    );
  }

  return (
    <>
      {mic.devices.length > 1 && (
        <label className="flex flex-col gap-1 text-xs text-muted">
          {tr("Microphone in use")}
          <select
            className="text-sm text-ink bg-surface border border-rule rounded-input px-3 py-2"
            value={mic.deviceId}
            disabled={stage === "recording" || stage === "noise" || mic.noiseBusy}
            onChange={(e) => mic.open(e.target.value)}
          >
            {mic.devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || tr("Microphone {{n}}", { n: i + 1 })}
              </option>
            ))}
          </select>
        </label>
      )}
      <LevelMeter level={mic.level} />
      {stage === "noise" && <p className="text-sm text-ink">{tr("Stay quiet for a moment while we listen to the room...")}</p>}
      {(stage === "ready" || stage === "silent") && (
        <>
          {stage === "silent" ? (
            <p className="text-sm text-error">{tr("We couldn't hear you. Check the right microphone is chosen and isn't muted, then speak a little louder.")}</p>
          ) : (
            <p className="text-sm text-ink">
              {tr("Press Record and say:")} <span className="italic">{tr("“My name is … and I am ready for the test.”")}</span>
            </p>
          )}
          <Button variant="secondary" className="self-start" onClick={mic.record} disabled={mic.noiseBusy}>
            <Mic size={15} className="inline mr-1.5" />
            {stage === "silent" ? tr("Record again") : tr("Record ({{n}} seconds)", { n: RECORD_SECONDS })}
          </Button>
        </>
      )}
      {stage === "recording" && (
        <p className="flex items-center gap-2 text-sm text-error font-semibold">
          <Square size={12} className="fill-current" /> {tr("Recording... speak now")}
        </p>
      )}
      {stage === "review" && mic.clipUrl && (
        <>
          <p className="text-sm text-ink">{tr("Play your recording. Can you hear yourself clearly?")}</p>
          <audio src={mic.clipUrl} controls className="w-full" />
          <div className="flex flex-wrap gap-2">
            <Button className="!py-1.5" onClick={() => mic.setStage("pass")}>
              {tr("Yes, it sounds clear")}
            </Button>
            <Button variant="secondary" className="!py-1.5" onClick={mic.record} disabled={mic.noiseBusy}>
              {tr("Record again")}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

function Shell({ children, onBack }: { children: ReactNode; onBack?: () => void }) {
  return (
    <div className="max-w-2xl mx-auto bg-surface border border-rule rounded-card shadow-sm p-6 sm:p-8 flex flex-col gap-4">
      {onBack && (
        <button onClick={onBack} className="self-start flex items-center gap-1.5 text-sm text-muted hover:text-ink cursor-pointer">
          <ArrowLeft size={16} /> {tr("Back")}
        </button>
      )}
      <div>
        <h1 className="font-display font-bold text-xl text-ink">{tr("Check your device")}</h1>
        <p className="text-sm text-muted mt-1">{tr("A quick check before the test, so nothing goes wrong halfway through.")}</p>
      </div>
      {children}
    </div>
  );
}
