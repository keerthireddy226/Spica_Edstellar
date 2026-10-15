import { useCallback, useEffect, useRef, useState } from "react";
import {
  ackProctorMessage,
  getProctoringSetup,
  getProctoringStatus,
  sendProctoringEvents,
  sendSnapshot,
  uploadSegment,
  type ProctoringEvent,
  type SegmentKind,
  type ProctoringSetup,
} from "@/api/proctoring";
import { blobToBase64, profileTyping, recordSegments, watchCamera, watchSpeech } from "@/lib/proctorSensors";

// What the learner is told right away when something is picked up. Each
// code maps to a sentence in ProctoringOverlay.
export type ProctorWarning =
  | "tab_hidden"
  | "paste_blocked"
  | "copy_blocked"
  | "fullscreen_exit"
  | "multi_monitor"
  | "no_face"
  | "multiple_people"
  | "phone"
  | "camera_off"
  | "second_tab"
  | "offline"
  | "camera_covered"
  | "camera_frozen"
  | "background_speech"
  | "screen_share_stopped"
  | "screen_not_entire";

const FLUSH_MS = 5000;
const STATUS_MS = 15000;
const SNAPSHOT_MS = 30000;
const LIVE_SNAPSHOT_MS = 20000;
// Strict mode checks the camera about four times a minute.
const STRICT_SNAPSHOT_MS = 15000;
const SEGMENT_MS = 30000;
// One input event adding this many characters at once is pasted or injected
// text, not typing.
const BURST_CHARS = 25;

export interface ProctoringState {
  loading: boolean;
  setup: ProctoringSetup | null;
  // Every pre-test step is done; the test may show.
  ready: boolean;
  markReady: () => void;
  refreshSetup: () => Promise<ProctoringSetup | null>;
  warning: ProctorWarning | null;
  dismissWarning: () => void;
  message: string | null;
  ackMessage: () => void;
  terminated: boolean;
  terminateReason: string | null;
  cameraStream: MediaStream | null;
  enterFullscreen: () => void;
  // Screen recording: the shared screen, and asking for it (needs a click).
  screenStream: MediaStream | null;
  startScreenShare: () => Promise<"ok" | "not_entire" | "denied">;
}

function usesCamera(s: ProctoringSetup | null): boolean {
  if (!s) return false;
  const p = s.policy;
  return p.webcamMonitoring || p.liveMonitoring || p.videoRecording || (p.faceMatch && !s.biometricOptOut);
}

function snapshotsWanted(s: ProctoringSetup): boolean {
  const p = s.policy;
  return p.webcamMonitoring || p.liveMonitoring || (p.faceMatch && !s.biometricOptOut);
}

// The learner side of a proctored session: the setup, then, while active,
// the lockdown listeners, camera snapshots, event upload and the proctor's
// messages. Nothing here ends a test by itself; it records and tells the
// learner, and a reviewer decides.
export function useProctoring(sessionId: string | null, active: boolean): ProctoringState {
  const [setup, setSetup] = useState<ProctoringSetup | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState<ProctorWarning | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [terminated, setTerminated] = useState(false);
  const [terminateReason, setTerminateReason] = useState<string | null>(null);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const queueRef = useRef<ProctoringEvent[]>([]);
  const lastLoggedRef = useRef<Record<string, number>>({});

  const refreshSetup = useCallback(async () => {
    if (!sessionId) return null;
    const s = await getProctoringSetup(sessionId).catch(() => null);
    setSetup(s);
    return s;
  }, [sessionId]);

  useEffect(() => {
    setSetup(null);
    setReady(false);
    setTerminated(false);
    setMessage(null);
    if (!sessionId) return;
    setLoading(true);
    getProctoringSetup(sessionId)
      .then((s) => {
        setSetup(s);
        setTerminated(s.terminated);
        // Nothing to set up and nothing to enforce up front: start straight away.
        if (!s.proctored) setReady(true);
      })
      // The test still runs if proctoring can't be reached; the server
      // refuses answers if a required step is missing.
      .catch(() => setReady(true))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const running = Boolean(sessionId && setup?.proctored && ready && active && !terminated);
  const policy = setup?.policy;

  const log = useCallback((type: string, detail?: ProctoringEvent["detail"], warn?: ProctorWarning) => {
    // Same event within 2 s is one event (blur and visibilitychange often fire together).
    const now = Date.now();
    if (now - (lastLoggedRef.current[type] ?? 0) < 2000) return;
    lastLoggedRef.current[type] = now;
    queueRef.current.push({ type, at: new Date(now).toISOString(), detail });
    if (warn) setWarning(warn);
  }, []);

  // Recorded segments and clips: one retry after a failed upload.
  const sendSegment = useCallback(
    async (kind: SegmentKind, blob: Blob, mimeType: string, seq?: number, durationMs?: number) => {
      if (!sessionId) return;
      const dataBase64 = await blobToBase64(blob);
      const body = { kind, dataBase64, mimeType, seq, durationMs };
      await uploadSegment(sessionId, body).catch(() => new Promise((r) => setTimeout(r, 10_000)).then(() => uploadSegment(sessionId, body).catch(() => {})));
    },
    [sessionId],
  );

  // Upload queued events every few seconds and when the page is hidden.
  useEffect(() => {
    if (!running || !sessionId) return;
    const flush = () => {
      const batch = queueRef.current.splice(0, 50);
      if (batch.length) sendProctoringEvents(sessionId, batch).catch(() => queueRef.current.unshift(...batch));
    };
    const timer = setInterval(flush, FLUSH_MS);
    window.addEventListener("pagehide", flush);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [running, sessionId]);

  // Lockdown: copy, cut, paste and the context menu are off; leaving the
  // tab, losing focus and screenshot keys are recorded.
  useEffect(() => {
    if (!running || !policy) return;
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof DocumentEventMap>(target: Document | Window, type: K, fn: (e: DocumentEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      cleanups.push(() => target.removeEventListener(type, fn as EventListener, opts));
    };
    if (policy.lockdown) {
      on(document, "copy", (e) => {
        e.preventDefault();
        log("copy_blocked", undefined, "copy_blocked");
      });
      on(document, "cut", (e) => {
        e.preventDefault();
        log("cut_blocked", undefined, "copy_blocked");
      });
      on(document, "paste", (e) => {
        e.preventDefault();
        log("paste_blocked", undefined, "paste_blocked");
      });
      on(document, "drop", (e) => {
        e.preventDefault();
        log("paste_blocked", { via: "drop" }, "paste_blocked");
      });
      on(document, "contextmenu", (e) => {
        e.preventDefault();
        log("context_menu");
      });
      on(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden") log("tab_hidden", undefined, "tab_hidden");
      });
      on(window as unknown as Document, "blur", () => log("window_blur"));
      on(document, "keydown", (e) => {
        const k = e.key;
        if (k === "PrintScreen" || (e.metaKey && e.shiftKey && ["3", "4", "5", "s", "S"].includes(k))) log("print_screen", { key: k }, "tab_hidden");
        if (k === "F12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["I", "J", "C", "i", "j", "c"].includes(k))) {
          e.preventDefault();
          log("devtools");
        }
      });
      // Pasted or injected text that slipped past the paste block.
      on(document, "input", (e) => {
        const ie = e as InputEvent;
        const added = ie.data?.length ?? 0;
        if (ie.inputType === "insertReplacementText" || ie.inputType === "insertFromPaste" || added >= BURST_CHARS) log("typing_burst", { chars: added, kind: ie.inputType ?? "" });
      });
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      cleanups.push(() => {
        document.body.style.userSelect = prevSelect;
      });
    }
    if (policy.requireFullscreen) {
      on(document, "fullscreenchange", () => {
        if (!document.fullscreenElement) log("fullscreen_exit", undefined, "fullscreen_exit");
      });
    }
    on(window as unknown as Document, "offline" as keyof DocumentEventMap, () => log("offline", undefined, "offline"));
    return () => cleanups.forEach((c) => c());
  }, [running, policy, log]);

  // A second screen (Chrome and Edge report it) and the same test open twice.
  useEffect(() => {
    if (!running || !policy || !sessionId) return;
    const scr = window.screen as Screen & { isExtended?: boolean } & Partial<EventTarget>;
    const checkScreens = () => {
      if (policy.multiMonitorCheck && scr.isExtended) log("multi_monitor", undefined, "multi_monitor");
    };
    checkScreens();
    scr.addEventListener?.("change", checkScreens);
    let channel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(`spica-proctor-${sessionId}`);
      channel.onmessage = (e) => {
        if (e.data === "hello") channel?.postMessage("here");
        log("second_tab", undefined, "second_tab");
      };
      channel.postMessage("hello");
    }
    return () => {
      scr.removeEventListener?.("change", checkScreens);
      channel?.close();
    };
  }, [running, policy, sessionId, log]);

  // Camera on for the whole test: frames go to the server at an uneven
  // interval so they can't be timed, the picture is watched for a covered
  // or frozen lens, and the video is recorded in segments if asked.
  useEffect(() => {
    if (!running || !sessionId || !setup || !usesCamera(setup)) return;
    const p = setup.policy;
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stops: (() => void)[] = [];
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const base = p.mode === "strict" ? STRICT_SNAPSHOT_MS : p.liveMonitoring ? LIVE_SNAPSHOT_MS : SNAPSHOT_MS;
    const capture = async () => {
      if (stopped || !video.videoWidth) return;
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 960 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
      const r = await sendSnapshot(sessionId, image).catch(() => null);
      if (r?.warning && !stopped) setWarning(r.warning);
    };
    const schedule = (first = false) => {
      const delay = first ? 4000 : base * (0.6 + Math.random() * 0.8);
      timer = setTimeout(async () => {
        await capture();
        if (!stopped) schedule();
      }, delay);
    };
    // The video recording carries sound too when the microphone is monitored.
    const withAudio = p.videoRecording && p.audioMonitoring;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, facingMode: "user" }, audio: withAudio ? { echoCancellation: true, noiseSuppression: true } : false })
      .then(async (s) => {
        if (stopped) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        setCameraStream(s);
        s.getVideoTracks()[0]?.addEventListener("ended", () => log("camera_off", undefined, "camera_off"));
        video.srcObject = s;
        await video.play().catch(() => {});
        if (snapshotsWanted(setup)) schedule(true);
        stops.push(
          watchCamera(
            s,
            () => log("camera_covered", undefined, "camera_covered"),
            () => log("camera_frozen", undefined, "camera_frozen"),
          ),
        );
        if (p.videoRecording) {
          stops.push(
            recordSegments(s, { kind: "video", segmentMs: SEGMENT_MS, videoBitsPerSecond: 300_000, audioBitsPerSecond: 32_000 }, (blob, mime, seq, ms) =>
              sendSegment("video_segment", blob, mime, seq, ms),
            ),
          );
        }
      })
      .catch(() => log("camera_off", { reason: "denied" }, "camera_off"));
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stops.forEach((f) => f());
      stream?.getTracks().forEach((t) => t.stop());
      setCameraStream(null);
    };
  }, [running, sessionId, setup, log, sendSegment]);

  // Microphone between answers: talking or whispering is flagged and a
  // short clip kept for the reviewer.
  useEffect(() => {
    if (!running || !sessionId || !setup?.policy.audioMonitoring) return;
    let stream: MediaStream | null = null;
    let stopWatch: (() => void) | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        s.getAudioTracks()[0]?.addEventListener("ended", () => log("mic_off"));
        stopWatch = watchSpeech(s, (clip, mime) => {
          log("background_speech", undefined, "background_speech");
          if (clip) sendSegment("audio_clip", clip, mime);
        });
      })
      .catch(() => log("mic_off", { reason: "denied" }));
    return () => {
      stopped = true;
      stopWatch?.();
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [running, sessionId, setup?.policy.audioMonitoring, log, sendSegment]);

  // The shared screen, recorded in segments. Stopping the share is recorded
  // and the learner is asked to share again.
  useEffect(() => {
    if (!running || !screenStream || !setup?.policy.screenRecording) return;
    const track = screenStream.getVideoTracks()[0];
    const onEnded = () => {
      log("screen_share_stopped", undefined, "screen_share_stopped");
      setScreenStream(null);
    };
    track?.addEventListener("ended", onEnded);
    const stop = recordSegments(screenStream, { kind: "video", segmentMs: SEGMENT_MS, videoBitsPerSecond: 250_000 }, (blob, mime, seq, ms) =>
      sendSegment("screen_segment", blob, mime, seq, ms),
    );
    return () => {
      track?.removeEventListener("ended", onEnded);
      stop();
    };
  }, [running, screenStream, setup?.policy.screenRecording, log, sendSegment]);

  // Typing rhythm, as timing statistics only.
  useEffect(() => {
    if (!running || !setup?.policy.typingPattern || setup.biometricOptOut) return;
    return profileTyping((profile) => {
      queueRef.current.push({ type: "typing_profile", at: new Date().toISOString(), detail: profile });
    });
  }, [running, setup?.policy.typingPattern, setup?.biometricOptOut]);

  // Stop sharing the screen once the test is over.
  useEffect(() => {
    if (active || !screenStream) return;
    screenStream.getTracks().forEach((t) => t.stop());
    setScreenStream(null);
  }, [active, screenStream]);

  const startScreenShare = useCallback(async (): Promise<"ok" | "not_entire" | "denied"> => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5, displaySurface: "monitor" } as MediaTrackConstraints, audio: false });
      const surface = s.getVideoTracks()[0]?.getSettings().displaySurface;
      // Only the whole screen shows everything the learner sees; a window or
      // tab would hide other apps.
      if (surface && surface !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        log("screen_not_entire", { surface }, "screen_not_entire");
        return "not_entire";
      }
      setScreenStream(s);
      setWarning((w) => (w === "screen_share_stopped" || w === "screen_not_entire" ? null : w));
      return "ok";
    } catch {
      return "denied";
    }
  }, [log]);

  // The proctor's messages and a session ended by the proctor.
  useEffect(() => {
    if (!sessionId || !setup?.proctored || !ready || !active) return;
    let stopped = false;
    const poll = () =>
      getProctoringStatus(sessionId)
        .then((s) => {
          if (stopped) return;
          if (s.message) setMessage(s.message);
          if (s.terminated) {
            setTerminated(true);
            setTerminateReason(s.terminateReason);
          }
        })
        .catch(() => {});
    poll();
    const timer = setInterval(poll, STATUS_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, setup?.proctored, ready, active]);

  // Leaving fullscreen when it's required: the overlay offers a button back.
  const enterFullscreen = useCallback(() => {
    document.documentElement.requestFullscreen?.().catch(() => log("fullscreen_denied"));
    setWarning((w) => (w === "fullscreen_exit" ? null : w));
  }, [log]);

  // Turning off: leave fullscreen once the test is over.
  useEffect(() => {
    if (active) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, [active]);

  return {
    loading,
    setup,
    ready,
    markReady: () => setReady(true),
    refreshSetup,
    warning,
    dismissWarning: () => setWarning(null),
    message,
    ackMessage: () => {
      setMessage(null);
      if (sessionId) ackProctorMessage(sessionId).catch(() => {});
    },
    terminated,
    terminateReason,
    cameraStream,
    enterFullscreen,
    screenStream,
    startScreenShare,
  };
}
