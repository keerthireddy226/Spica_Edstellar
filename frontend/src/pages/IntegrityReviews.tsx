import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Eye, IdCard, MessageSquare, Radio, ShieldAlert, ShieldCheck, ShieldX, Square } from "lucide-react";
import { Badge, DetailModal } from "@/components/DetailModal";
import { Button } from "@/components/Button";
import { EmptyNote, FilterPills, PageHeader, Panel, StatCard, StatusPill } from "@/components/staff/StaffKit";
import { ProctoringSettings } from "@/components/proctoring/ProctoringSettings";
import { shortDate } from "@/api/staff";
import { useAuth } from "@/hooks/useAuth";
import {
  decideIdentity,
  decideIntegrity,
  fetchMediaUrl,
  getIdentityReviews,
  getIntegrityDetail,
  getIntegrityReviews,
  getLiveSessions,
  getOrgProctoringPolicy,
  saveOrgProctoringPolicy,
  sendLiveMessage,
  terminateLiveSession,
  type IdentityReviewRow,
  type IntegrityDetail,
  type IntegritySessionRow,
  type IntegrityStats,
  type LiveSessionRow,
  type MrzReading,
} from "@/api/proctoring";
import { tr } from "@/i18n/tr";

// What each risk reason means, for the reviewer. The count shows next to it.
const REASON_TEXT: Record<string, () => string> = {
  tab_hidden: () => tr("Left the test tab"),
  window_blur: () => tr("Test window lost focus"),
  fullscreen_exit: () => tr("Left full screen"),
  paste_blocked: () => tr("Tried to paste"),
  copy_blocked: () => tr("Tried to copy"),
  cut_blocked: () => tr("Tried to cut text"),
  context_menu: () => tr("Opened the right-click menu"),
  print_screen: () => tr("Pressed a screenshot key"),
  multi_monitor: () => tr("A second screen was connected"),
  second_tab: () => tr("The test was open in two tabs"),
  typing_burst: () => tr("Text appeared without typing"),
  camera_off: () => tr("Camera turned off"),
  mic_off: () => tr("Microphone turned off"),
  devtools: () => tr("Tried to open developer tools"),
  away_from_camera: () => tr("Snapshots with no face"),
  multiple_faces: () => tr("Snapshots with more than one face"),
  extra_person: () => tr("Snapshots with another person"),
  face_mismatch: () => tr("Snapshots where the face didn't match"),
  phone_in_view: () => tr("Snapshots with a phone"),
  no_snapshots: () => tr("No camera snapshots arrived"),
  face_check_flagged: () => tr("Face checks flagged"),
  voice_mismatch: () => tr("A different voice answered part of the test"),
  voice_uncertain: () => tr("Voice match uncertain"),
  room_scan_missing: () => tr("No room scan"),
  secure_browser_missing: () => tr("Not taken in Safe Exam Browser"),
  id_missing: () => tr("No ID check submitted"),
  id_rejected: () => tr("ID check rejected"),
  id_pending: () => tr("ID check waiting for review"),
  manual_identity_check: () => tr("Chose a manual identity check"),
  terminated: () => tr("Ended by the proctor"),
  camera_covered: () => tr("Camera covered or dark"),
  camera_frozen: () => tr("Camera picture froze"),
  background_speech: () => tr("Talking heard between answers"),
  screen_share_stopped: () => tr("Stopped sharing the screen"),
  screen_not_entire: () => tr("Shared a window instead of the entire screen"),
  looking_away: () => tr("Snapshots looking away from the screen"),
  video_missing: () => tr("No camera recording"),
  screen_missing: () => tr("No screen recording"),
  typing_inconsistent: () => tr("Typing rhythm changed"),
  typing_uncertain: () => tr("Typing rhythm uncertain"),
  id_expired: () => tr("ID document has expired"),
  id_name_mismatch: () => tr("Name on the ID differs from the account"),
  id_face_differs: () => tr("Face on the ID looks different from the selfie"),
  id_selfie_not_live: () => tr("Selfie may be a photo or screen"),
};

function reasonText(code: string, count: number): string {
  const label = (REASON_TEXT[code] ?? (() => code))();
  return count > 1 ? `${label} (×${count})` : label;
}

const EVENT_TEXT: Record<string, () => string> = {
  tab_hidden: () => tr("Left the test tab"),
  window_blur: () => tr("Window lost focus"),
  fullscreen_exit: () => tr("Left full screen"),
  fullscreen_denied: () => tr("Full screen refused"),
  paste_blocked: () => tr("Paste blocked"),
  copy_blocked: () => tr("Copy blocked"),
  cut_blocked: () => tr("Cut blocked"),
  context_menu: () => tr("Right-click menu"),
  print_screen: () => tr("Screenshot key"),
  multi_monitor: () => tr("Second screen"),
  second_tab: () => tr("Opened in a second tab"),
  typing_burst: () => tr("Text appeared without typing"),
  camera_off: () => tr("Camera off"),
  mic_off: () => tr("Microphone off"),
  offline: () => tr("Went offline"),
  devtools: () => tr("Developer tools"),
  message_seen: () => tr("Read the proctor's message"),
  proctor_message: () => tr("Proctor sent a message"),
  terminated: () => tr("Ended by the proctor"),
  camera_covered: () => tr("Camera covered"),
  camera_frozen: () => tr("Camera froze"),
  background_speech: () => tr("Talking heard"),
  screen_share_stopped: () => tr("Screen sharing stopped"),
  screen_not_entire: () => tr("Shared a window, not the screen"),
};

const DIRECTION_TEXT: Record<string, () => string> = {
  left: () => tr("Looking left"),
  right: () => tr("Looking right"),
  up: () => tr("Looking up"),
  down: () => tr("Looking down"),
};

const TYPING_TEXT: Record<string, () => string> = {
  consistent: () => tr("Same typing rhythm throughout"),
  uncertain: () => tr("Typing rhythm uncertain"),
  inconsistent: () => tr("Typing rhythm changed: check the written answers"),
  insufficient_typing: () => tr("Not enough typing to compare"),
};

// Plays recorded segments one after another, like one continuous video.
function SegmentPlayer({ ids, kind }: { ids: string[]; kind: "video" | "audio" }) {
  const [index, setIndex] = useState(0);
  const [url, setUrl] = useState<string | null>(null);
  const id = ids[index];
  useEffect(() => {
    let made: string | null = null;
    setUrl(null);
    fetchMediaUrl(id).then((u) => {
      made = u;
      setUrl(u);
    });
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [id]);
  const onEnded = () => setIndex((i) => (i + 1 < ids.length ? i + 1 : i));
  return (
    <div className="flex flex-col gap-2">
      {!url ? (
        <div className="w-full max-w-2xl aspect-video bg-paper-warm animate-pulse rounded-lg" />
      ) : kind === "video" ? (
        <video key={id} src={url} controls autoPlay={index > 0} onEnded={onEnded} className="w-full max-w-2xl rounded-lg bg-ink" />
      ) : (
        <audio key={id} src={url} controls autoPlay={index > 0} onEnded={onEnded} className="w-full" />
      )}
      {ids.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {ids.map((x, i) => (
            <button
              key={x}
              onClick={() => setIndex(i)}
              className={`text-[11px] font-mono rounded-pill px-2 py-0.5 cursor-pointer ${i === index ? "bg-navy text-white" : "bg-rule text-muted hover:text-ink"}`}
            >
              {tr("Part {{n}}", { n: i + 1 })}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const VOICE_TEXT: Record<string, () => string> = {
  match: () => tr("Same voice throughout"),
  uncertain: () => tr("Uncertain: listen to the answers"),
  mismatch: () => tr("A different voice answered part of the test"),
  insufficient_audio: () => tr("Not enough speech to compare"),
  error: () => tr("Voice check couldn't run"),
};

const STATUS_TONE = { flagged: "warning", violation: "error", cleared: "success", clear: "success", in_progress: "navy" } as const;
const STATUS_TEXT: Record<string, () => string> = {
  flagged: () => tr("Needs review"),
  violation: () => tr("Violation"),
  cleared: () => tr("Cleared"),
  clear: () => tr("No issues"),
  in_progress: () => tr("In progress"),
};
const BADGE_TONE = { flagged: "warn", violation: "bad", cleared: "good", clear: "good", in_progress: "neutral" } as const;
const RISK_TONE = { low: "success", medium: "warning", high: "error" } as const;
const RISK_TEXT: Record<string, () => string> = { low: () => tr("Low risk"), medium: () => tr("Medium risk"), high: () => tr("High risk") };

const DOC_TEXT: Record<string, () => string> = {
  passport: () => tr("Passport"),
  national_id: () => tr("National ID card"),
  driving_licence: () => tr("Driving licence"),
  other: () => tr("Other photo ID"),
};
const AUTO_TEXT: Record<string, () => string> = {
  likely_same_person: () => tr("Faces look alike"),
  faces_differ: () => tr("Faces look different"),
  no_face_on_document: () => tr("No face found on the document"),
  no_single_face_in_selfie: () => tr("Selfie didn't show one face"),
};

function MediaView({ id, kind, className = "" }: { id: string; kind: "image" | "video" | "audio"; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    fetchMediaUrl(id).then((u) => {
      revoked = u;
      setUrl(u);
    });
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [id]);
  if (!url) return <div className={`bg-paper-warm animate-pulse rounded-lg ${className}`} />;
  if (kind === "video") return <video src={url} controls className={`rounded-lg bg-ink ${className}`} />;
  if (kind === "audio") return <audio src={url} controls className="w-full" />;
  return <img src={url} alt="" className={`rounded-lg object-cover ${className}`} />;
}

// What was read from the document's machine-readable zone.
function MrzDetails({ mrz, liveness }: { mrz: MrzReading | null; liveness: string | null }) {
  const live = liveness === null ? null : Number(liveness);
  return (
    <div className="flex flex-col gap-1.5 text-sm">
      {live !== null && (
        <p className={live < 0.5 ? "text-error" : "text-success"}>{live < 0.5 ? tr("The selfie may be a photo or a screen.") : tr("The selfie looks like a live person.")}</p>
      )}
      {!mrz ? (
        <p className="text-xs text-muted">{tr("No machine-readable zone found. Check the document by eye.")}</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone={mrz.checksumsValid ? "success" : "warning"}>{mrz.checksumsValid ? tr("Check digits valid") : tr("Check digits don't add up")}</StatusPill>
            {mrz.expired !== null && <StatusPill tone={mrz.expired ? "error" : "success"}>{mrz.expired ? tr("Expired") : tr("Not expired")}</StatusPill>}
            {mrz.nameMatches !== null && <StatusPill tone={mrz.nameMatches ? "success" : "warning"}>{mrz.nameMatches ? tr("Name matches the account") : tr("Name differs from the account")}</StatusPill>}
          </div>
          <p className="text-xs text-muted">
            {[mrz.lastName, mrz.firstName].filter(Boolean).join(", ")}
            {mrz.documentNumber ? ` · ${tr("No. {{n}}", { n: mrz.documentNumber })}` : ""}
            {mrz.nationality ? ` · ${mrz.nationality}` : ""}
            {mrz.expirationDate ? ` · ${tr("expires {{d}}", { d: `20${mrz.expirationDate.slice(0, 2)}-${mrz.expirationDate.slice(2, 4)}-${mrz.expirationDate.slice(4, 6)}` })}` : ""}
          </p>
          {!mrz.checksumsValid && <p className="text-xs text-muted">{tr("A blurry photo can cause misread digits; compare the strip on the image.")}</p>}
        </>
      )}
    </div>
  );
}

function ReviewDetail({ sessionId, onClose, onDecided }: { sessionId: string; onClose: () => void; onDecided: () => void }) {
  const [d, setD] = useState<IntegrityDetail | null>(null);
  const [tab, setTab] = useState("summary");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getIntegrityDetail(sessionId)
      .then(setD)
      .catch(() => setError(tr("Could not load this session.")));
  }, [sessionId]);

  async function decide(verdict: "cleared" | "violation") {
    setBusy(true);
    try {
      await decideIntegrity(sessionId, verdict, note.trim() || undefined);
      onDecided();
      onClose();
    } catch {
      setError(tr("Could not save the decision."));
      setBusy(false);
    }
  }
  async function decideId(verdict: "verified" | "rejected") {
    if (!d?.identity) return;
    setBusy(true);
    try {
      await decideIdentity(d.identity.id, verdict);
      setD(await getIntegrityDetail(sessionId));
      onDecided();
    } catch {
      setError(tr("Could not save the decision."));
    } finally {
      setBusy(false);
    }
  }

  if (!d) {
    return (
      <DetailModal title={tr("Test session")} onClose={onClose} icon={ShieldAlert}>
        {error ? <p className="text-sm text-error">{error}</p> : <p className="text-sm text-muted">{tr("Loading...")}</p>}
      </DetailModal>
    );
  }
  const si = d.integrity;
  const snapshots = d.media.filter((m) => m.kind === "snapshot");
  const flaggedSnaps = snapshots.filter((m) => m.face_count !== 1 || m.face_decision === "mismatch" || (m.objects ?? []).some((o) => o.label === "cell_phone"));
  const room = d.media.find((m) => m.kind === "room_scan");
  const baseline = d.media.find((m) => m.kind === "voice_baseline");
  const videoIds = d.media.filter((m) => m.kind === "video_segment").map((m) => m.id);
  const screenIds = d.media.filter((m) => m.kind === "screen_segment").map((m) => m.id);
  const clips = d.media.filter((m) => m.kind === "audio_clip");
  const events = d.events.filter((e) => e.type !== "typing_profile");
  const typing = si.checks?.typing;
  const tabs = [
    { key: "summary", label: tr("Summary") },
    { key: "snapshots", label: tr("Snapshots"), count: snapshots.length },
    { key: "recordings", label: tr("Recordings"), count: videoIds.length + screenIds.length + clips.length },
    { key: "timeline", label: tr("Timeline"), count: events.length },
    { key: "identity", label: tr("Identity, voice and typing") },
  ];

  return (
    <DetailModal
      title={d.session.name.trim() || d.session.email}
      subtitle={[d.session.exam_name ?? (d.session.session_type === "placement" ? tr("Placement test") : tr("Mock exam")), d.session.org_name].filter(Boolean).join(" · ")}
      onClose={onClose}
      icon={ShieldAlert}
      badges={
        <>
          <Badge tone={BADGE_TONE[si.status]}>{STATUS_TEXT[si.status]()}</Badge>
          <Badge tone={si.risk_level === "high" ? "bad" : si.risk_level === "medium" ? "warn" : "good"}>{RISK_TEXT[si.risk_level]()}</Badge>
        </>
      }
      stats={[
        { label: tr("Risk score"), value: si.risk_score },
        { label: tr("Answers"), value: d.session.answers },
        { label: tr("Snapshots"), value: snapshots.length, hint: flaggedSnaps.length ? tr("{{n}} with issues", { n: flaggedSnaps.length }) : undefined },
        { label: tr("Started"), value: shortDate(d.session.started_at) },
      ]}
      tabs={tabs}
      tab={tab}
      onTab={setTab}
    >
      {tab === "summary" && (
        <div className="flex flex-col gap-5">
          <Panel title={tr("Why it was flagged")}>
            {si.reasons.length === 0 ? (
              <EmptyNote>{tr("Nothing unusual was recorded.")}</EmptyNote>
            ) : (
              <ul className="flex flex-col gap-2">
                {si.reasons.map((r) => (
                  <li key={r.code} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2 text-ink">
                      <AlertTriangle size={14} className={r.points >= 15 ? "text-error" : "text-warning"} />
                      {reasonText(r.code, r.count)}
                    </span>
                    <span className="text-xs font-mono text-muted">+{r.points}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {d.placement && (
            <p className="text-sm text-muted">
              {tr("Placement result: {{level}} ({{pct}}%), status: {{status}}", { level: d.placement.cefr_level, pct: d.placement.overall_percent, status: d.placement.status })}
            </p>
          )}
          {si.reviewed_at ? (
            <p className="text-sm text-muted">
              {tr("Decided on {{date}}.", { date: shortDate(si.reviewed_at) })} {si.review_note}
            </p>
          ) : null}
          <div className="flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={tr("Note for the record (optional)")}
              className="rounded-input border border-rule bg-surface px-3 py-2 text-sm"
            />
            {error && <p className="text-sm text-error">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => decide("cleared")} disabled={busy}>
                <ShieldCheck size={16} className="inline mr-1.5" />
                {tr("Clear: no violation")}
              </Button>
              <Button variant="secondary" onClick={() => decide("violation")} disabled={busy}>
                <ShieldX size={16} className="inline mr-1.5" />
                {tr("Confirm violation")}
              </Button>
            </div>
            <p className="text-xs text-muted">{tr("A violation on a placement test withdraws its certification.")}</p>
          </div>
        </div>
      )}

      {tab === "snapshots" && (
        <div className="flex flex-col gap-4">
          {room && (
            <Panel title={tr("Room scan")}>
              <MediaView id={room.id} kind="video" className="w-full max-w-md" />
            </Panel>
          )}
          {snapshots.length === 0 ? (
            <EmptyNote>{tr("No camera snapshots for this session.")}</EmptyNote>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {snapshots.map((m) => {
                const phone = (m.objects ?? []).some((o) => o.label === "cell_phone");
                const issue = m.face_count === 0 ? tr("No face") : (m.face_count ?? 0) > 1 ? tr("{{n}} faces", { n: m.face_count }) : m.face_decision === "mismatch" ? tr("Face mismatch") : phone ? tr("Phone") : null;
                const direction = m.head_direction && m.head_direction !== "center" ? DIRECTION_TEXT[m.head_direction]?.() : null;
                return (
                  <figure key={m.id} className={`rounded-card border ${issue ? "border-error/60" : "border-rule"} bg-surface p-1.5`}>
                    <MediaView id={m.id} kind="image" className="w-full aspect-[4/3]" />
                    <figcaption className="flex items-center justify-between text-[11px] mt-1 px-0.5">
                      <span className="text-muted">{new Date(m.created_at).toLocaleTimeString()}</span>
                      {issue ? <span className="text-error font-semibold">{issue}</span> : direction && <span className="text-navy-deep font-semibold">{direction}</span>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "recordings" && (
        <div className="flex flex-col gap-5">
          <Panel title={tr("Camera recording")}>
            {videoIds.length ? <SegmentPlayer ids={videoIds} kind="video" /> : <EmptyNote>{si.policy.videoRecording ? tr("No camera recording arrived.") : tr("Camera recording is off for this organization.")}</EmptyNote>}
          </Panel>
          <Panel title={tr("Screen recording")}>
            {screenIds.length ? <SegmentPlayer ids={screenIds} kind="video" /> : <EmptyNote>{si.policy.screenRecording ? tr("No screen recording arrived.") : tr("Screen recording is off for this organization.")}</EmptyNote>}
          </Panel>
          <Panel title={tr("Talking heard between answers")}>
            {clips.length === 0 ? (
              <EmptyNote>{si.policy.audioMonitoring ? tr("No talking was picked up.") : tr("Listening for talking is off for this organization.")}</EmptyNote>
            ) : (
              <div className="flex flex-col gap-3">
                {clips.map((c) => (
                  <div key={c.id} className="flex flex-col gap-1">
                    <span className="text-xs font-mono text-muted">{new Date(c.created_at).toLocaleTimeString()}</span>
                    <MediaView id={c.id} kind="audio" />
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      )}

      {tab === "timeline" && (
        <div className="flex flex-col gap-1">
          {events.length === 0 ? (
            <EmptyNote>{tr("No events recorded.")}</EmptyNote>
          ) : (
            events.map((e, i) => (
              <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-rule last:border-0">
                <span className="text-xs font-mono text-muted w-20 shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
                <span className={`h-2 w-2 rounded-full shrink-0 ${e.severity === "high" ? "bg-error" : e.severity === "warn" ? "bg-warning" : "bg-rule"}`} />
                <span className="text-ink">{(EVENT_TEXT[e.type] ?? (() => e.type))()}</span>
                {e.detail && typeof e.detail.message === "string" && <span className="text-xs text-muted truncate">“{e.detail.message}”</span>}
                {e.detail && typeof e.detail.reason === "string" && <span className="text-xs text-muted truncate">{e.detail.reason}</span>}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "identity" && (
        <div className="flex flex-col gap-5">
          <Panel title={tr("ID check")}>
            {!d.identity ? (
              <EmptyNote>{si.policy.idVerification ? tr("No ID submitted.") : tr("ID checks are off for this organization.")}</EmptyNote>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3 max-w-xl">
                  {d.identity.document_media_id && <MediaView id={d.identity.document_media_id} kind="image" className="w-full aspect-[4/3] object-contain bg-paper-warm" />}
                  {d.identity.selfie_media_id && <MediaView id={d.identity.selfie_media_id} kind="image" className="w-full aspect-[4/3]" />}
                </div>
                <p className="text-sm text-ink">
                  {DOC_TEXT[d.identity.document_type]()} · {d.identity.auto_decision ? (AUTO_TEXT[d.identity.auto_decision] ?? (() => d.identity!.auto_decision!))() : ""}
                  {d.identity.face_similarity && <span className="text-muted"> ({tr("similarity {{v}}", { v: Number(d.identity.face_similarity).toFixed(2) })})</span>}
                </p>
                <MrzDetails mrz={d.identity.mrz} liveness={d.identity.liveness_score} />
                {d.identity.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button onClick={() => decideId("verified")} disabled={busy}>
                      {tr("ID matches the person")}
                    </Button>
                    <Button variant="secondary" onClick={() => decideId("rejected")} disabled={busy}>
                      {tr("Reject ID")}
                    </Button>
                  </div>
                ) : (
                  <StatusPill tone={d.identity.status === "verified" ? "success" : "error"}>{d.identity.status === "verified" ? tr("Verified") : tr("Rejected")}</StatusPill>
                )}
              </div>
            )}
          </Panel>
          <Panel title={tr("Voice")}>
            {baseline && (
              <div className="mb-3">
                <p className="text-xs text-muted mb-1">{tr("Voice sample read before the test")}</p>
                <MediaView id={baseline.id} kind="audio" />
              </div>
            )}
            {!d.voice ? (
              <EmptyNote>{si.policy.voiceMatch ? (si.biometric_opt_out ? tr("The learner chose a manual identity check.") : tr("The voice check hasn't run yet.")) : tr("Voice matching is off for this organization.")}</EmptyNote>
            ) : (
              <div className="flex flex-col gap-2 text-sm">
                <p className="font-semibold text-ink">{(VOICE_TEXT[d.voice.decision] ?? (() => d.voice!.decision))()}</p>
                {d.voice.detail?.totalSpeechSeconds !== undefined && (
                  <p className="text-xs text-muted">
                    {tr("{{s}} seconds of speech across {{n}} answers, compared in {{c}} parts.", {
                      s: d.voice.detail.totalSpeechSeconds,
                      n: d.voice.detail.answers ?? 0,
                      c: d.voice.detail.chunks?.length ?? 0,
                    })}
                  </p>
                )}
                {d.voice.detail?.chunks && d.voice.detail.chunks.some((c) => c.vsBaseline !== null) && (
                  <div className="flex flex-wrap gap-2">
                    {d.voice.detail.chunks.map((c, i) => (
                      <span key={i} className={`text-xs font-mono rounded-pill px-2 py-0.5 ${c.vsBaseline !== null && c.vsBaseline < 0.74 ? "bg-error/15 text-error" : "bg-rule text-muted"}`}>
                        {tr("Part {{n}}", { n: i + 1 })}: {c.vsBaseline?.toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}
                <p className="text-xs text-muted">{tr("Scores of 0.80 and above mean the same speaker; below 0.74 likely a different speaker. Listen to the answers before deciding.")}</p>
              </div>
            )}
          </Panel>
          <Panel title={tr("Typing rhythm")}>
            {!typing ? (
              <EmptyNote>{si.policy.typingPattern ? (si.biometric_opt_out ? tr("The learner chose a manual identity check.") : tr("The typing check hasn't run yet.")) : tr("Typing rhythm is off for this organization.")}</EmptyNote>
            ) : (
              <div className="flex flex-col gap-1 text-sm">
                <p className="font-semibold text-ink">{(TYPING_TEXT[typing.decision] ?? (() => typing.decision))()}</p>
                <p className="text-xs text-muted">
                  {tr("{{n}} keystrokes.", { n: typing.keys })}
                  {typing.withinSession !== null && ` ${tr("First half against second half: {{d}} apart.", { d: Math.round(typing.withinSession * 100) + "%" })}`}
                  {typing.vsHistory !== null && ` ${tr("Against {{n}} earlier tests: {{d}} apart.", { n: typing.historySessions, d: Math.round(typing.vsHistory * 100) + "%" })}`}
                </p>
                <p className="text-xs text-muted">{tr("Under 20% apart is the same rhythm; over 35% is flagged. Typing changes with tiredness and keyboards, so treat this as a weak signal.")}</p>
              </div>
            )}
          </Panel>
        </div>
      )}
    </DetailModal>
  );
}

// The newest 30 seconds of camera recording, on request.
function LatestVideo({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-semibold text-navy-deep underline self-start cursor-pointer">
        {tr("Play the last 30 seconds")}
      </button>
    );
  }
  return <MediaView key={id} id={id} kind="video" className="w-full aspect-video" />;
}

function LiveCard({ s, onChanged }: { s: LiveSessionRow; onChanged: () => void }) {
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const phone = (s.snapshot?.objects ?? []).some((o) => o.label === "cell_phone");
  async function send() {
    if (!msg.trim()) return;
    setBusy(true);
    await sendLiveMessage(s.session_id, msg.trim()).catch(() => {});
    setMsg("");
    setBusy(false);
    onChanged();
  }
  async function end() {
    const reason = window.prompt(tr("Why are you ending this test? The learner sees this."));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    await terminateLiveSession(s.session_id, reason.trim()).catch(() => {});
    setBusy(false);
    onChanged();
  }
  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-3 flex flex-col gap-2">
      <div className="relative">
        {s.snapshot ? <MediaView key={s.snapshot.id} id={s.snapshot.id} kind="image" className="w-full aspect-[4/3]" /> : <div className="w-full aspect-[4/3] rounded-lg bg-paper-warm flex items-center justify-center text-xs text-muted">{tr("No camera")}</div>}
        {s.snapshot && (s.snapshot.face_count !== 1 || phone) && (
          <span className="absolute top-1.5 left-1.5 bg-error text-white text-[11px] font-semibold rounded-pill px-2 py-0.5">
            {s.snapshot.face_count === 0 ? tr("No face") : (s.snapshot.face_count ?? 0) > 1 ? tr("{{n}} faces", { n: s.snapshot.face_count }) : tr("Phone")}
          </span>
        )}
      </div>
      {s.video && <LatestVideo id={s.video.id} />}
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink truncate">{s.name.trim() || s.email}</p>
        <p className="text-xs text-muted truncate">
          {s.exam_name ?? (s.session_type === "placement" ? tr("Placement test") : tr("Mock exam"))} · {tr("{{n}} answers", { n: s.answers })}
        </p>
        <p className={`text-xs mt-0.5 ${s.alerts ? "text-error" : "text-success"}`}>
          {s.alerts ? tr("{{n}} alerts, latest: {{t}}", { n: s.alerts, t: (EVENT_TEXT[s.last_alert ?? ""] ?? (() => s.last_alert ?? ""))() }) : tr("No alerts")}
        </p>
      </div>
      <div className="flex gap-1.5">
        <input
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={tr("Message the learner")}
          maxLength={300}
          className="flex-1 min-w-0 rounded-input border border-rule bg-surface px-2 py-1.5 text-xs"
        />
        <button onClick={send} disabled={busy || !msg.trim()} title={tr("Send")} className="h-8 w-8 rounded-input bg-navy text-white flex items-center justify-center disabled:opacity-40 cursor-pointer">
          <MessageSquare size={14} />
        </button>
        <button onClick={end} disabled={busy} title={tr("End test")} className="h-8 w-8 rounded-input bg-error text-white flex items-center justify-center disabled:opacity-40 cursor-pointer">
          <Square size={13} />
        </button>
      </div>
    </div>
  );
}

function IdentityQueue({ onChanged }: { onChanged: () => void }) {
  const [status, setStatus] = useState<"pending" | "verified" | "rejected">("pending");
  const [rows, setRows] = useState<IdentityReviewRow[] | null>(null);
  const load = useCallback(() => {
    getIdentityReviews(status)
      .then((r) => setRows(r.verifications))
      .catch(() => setRows([]));
  }, [status]);
  useEffect(load, [load]);
  async function decide(id: string, verdict: "verified" | "rejected") {
    await decideIdentity(id, verdict).catch(() => {});
    load();
    onChanged();
  }
  return (
    <div className="flex flex-col gap-4">
      <FilterPills
        value={status}
        onChange={setStatus}
        options={[
          ["pending", tr("Waiting")],
          ["verified", tr("Verified")],
          ["rejected", tr("Rejected")],
        ]}
      />
      {rows === null ? null : rows.length === 0 ? (
        <EmptyNote>{tr("No ID checks here.")}</EmptyNote>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((r) => (
            <div key={r.id} className="bg-surface border border-rule rounded-card shadow-sm p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink truncate">{r.name.trim() || r.email}</p>
                  <p className="text-xs text-muted truncate">
                    {DOC_TEXT[r.document_type]()} · {shortDate(r.created_at)}
                    {r.org_name ? ` · ${r.org_name}` : ""}
                  </p>
                </div>
                {r.auto_decision && (
                  <StatusPill tone={r.auto_decision === "likely_same_person" ? "success" : "warning"}>{(AUTO_TEXT[r.auto_decision] ?? (() => r.auto_decision!))()}</StatusPill>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {r.document_media_id && <MediaView id={r.document_media_id} kind="image" className="w-full aspect-[4/3] object-contain bg-paper-warm" />}
                {r.selfie_media_id && <MediaView id={r.selfie_media_id} kind="image" className="w-full aspect-[4/3]" />}
              </div>
              <MrzDetails mrz={r.mrz} liveness={r.liveness_score} />
              {r.status === "pending" ? (
                <div className="flex gap-2">
                  <Button onClick={() => decide(r.id, "verified")} className="flex-1">
                    {tr("ID matches the person")}
                  </Button>
                  <Button variant="secondary" onClick={() => decide(r.id, "rejected")} className="flex-1">
                    {tr("Reject ID")}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted">
                  {r.status === "verified" ? tr("Verified") : tr("Rejected")} {r.reviewer ? `· ${r.reviewer}` : ""} {r.reviewed_at ? `· ${shortDate(r.reviewed_at)}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Tab = "queue" | "live" | "ids" | "settings";

// Test integrity for reviewers: flagged sessions, live tests, ID checks and
// (for an Org Admin) the organization's proctoring settings.
export function IntegrityReviews() {
  const { user } = useAuth();
  const isOrgAdmin = user?.role === "org_admin";
  const [tab, setTab] = useState<Tab>("queue");
  const [status, setStatus] = useState("flagged");
  const [rows, setRows] = useState<IntegritySessionRow[] | null>(null);
  const [stats, setStats] = useState<IntegrityStats | null>(null);
  const [live, setLive] = useState<LiveSessionRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    getIntegrityReviews(status)
      .then((r) => {
        setRows(r.sessions);
        setStats(r.stats);
      })
      .catch(() => setError(tr("Could not load the review queue.")));
  }, [status]);
  useEffect(load, [load]);

  const loadLive = useCallback(() => {
    getLiveSessions()
      .then((r) => setLive(r.sessions))
      .catch(() => setLive([]));
  }, []);
  useEffect(() => {
    if (tab !== "live") return;
    loadLive();
    const t = setInterval(loadLive, 10000);
    return () => clearInterval(t);
  }, [tab, loadLive]);

  const tabs: [Tab, string, number?][] = [
    ["queue", tr("Review queue"), stats?.flagged],
    ["live", tr("Live"), stats?.live],
    ["ids", tr("ID checks"), stats?.pendingIds],
  ];
  if (isOrgAdmin) tabs.push(["settings", tr("Settings")]);

  return (
    <div className="flex flex-col gap-5 w-full">
      <PageHeader title={tr("Test integrity")} subtitle={tr("Proctored tests that need a person to look at them. Nothing here fails a learner automatically.")} />
      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label={tr("Needs review")} value={stats.flagged} icon={ShieldAlert} index={0} />
          <StatCard label={tr("Live now")} value={stats.live} icon={Radio} index={1} />
          <StatCard label={tr("ID checks waiting")} value={stats.pendingIds} icon={IdCard} index={2} />
          <StatCard label={tr("Violations confirmed")} value={stats.violations} icon={ShieldX} index={3} />
        </div>
      )}
      <FilterPills value={tab} onChange={setTab} options={tabs} />
      {error && <p className="text-sm text-error">{error}</p>}

      {tab === "queue" && (
        <div className="flex flex-col gap-4">
          <FilterPills
            value={status}
            onChange={setStatus}
            options={[
              ["flagged", tr("Needs review")],
              ["violation", tr("Violations")],
              ["cleared", tr("Cleared")],
              ["clear", tr("No issues")],
              ["all", tr("All")],
            ]}
          />
          {rows === null ? null : rows.length === 0 ? (
            <EmptyNote>{status === "flagged" ? tr("No sessions waiting for review.") : tr("No sessions here.")}</EmptyNote>
          ) : (
            <div className="bg-surface border border-rule rounded-card shadow-sm divide-y divide-rule">
              {rows.map((r) => (
                <button key={r.session_id} onClick={() => setOpen(r.session_id)} className="w-full text-left px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 hover:bg-paper-warm/60 cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink truncate">{r.name.trim() || r.email}</p>
                    <p className="text-xs text-muted truncate">
                      {r.exam_name ?? (r.session_type === "placement" ? tr("Placement test") : tr("Mock exam"))} · {shortDate(r.started_at)}
                      {r.org_name ? ` · ${r.org_name}` : ""}
                    </p>
                    {r.reasons.length > 0 && (
                      <p className="text-xs text-muted truncate mt-0.5">
                        {r.reasons
                          .slice()
                          .sort((a, b) => b.points - a.points)
                          .slice(0, 3)
                          .map((x) => reasonText(x.code, x.count))
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusPill tone={RISK_TONE[r.risk_level]}>
                      {RISK_TEXT[r.risk_level]()} · {r.risk_score}
                    </StatusPill>
                    <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_TEXT[r.status]()}</StatusPill>
                    <Eye size={16} className="text-muted" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "live" &&
        (live === null ? null : live.length === 0 ? (
          <EmptyNote>{tr("No proctored tests are running right now.")}</EmptyNote>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {live.map((s) => (
              <LiveCard key={s.session_id} s={s} onChanged={loadLive} />
            ))}
          </div>
        ))}

      {tab === "ids" && <IdentityQueue onChanged={load} />}

      {tab === "settings" && isOrgAdmin && (
        <Panel title={tr("Proctoring")}>
          <ProctoringSettings load={getOrgProctoringPolicy} save={saveOrgProctoringPolicy} />
        </Panel>
      )}

      {open && <ReviewDetail sessionId={open} onClose={() => setOpen(null)} onDecided={load} />}
      {tab === "queue" && rows && rows.length > 0 && <p className="text-xs text-muted">{tr("Open a session to see snapshots, the event timeline, ID and voice results, then record a decision.")}</p>}
    </div>
  );
}
