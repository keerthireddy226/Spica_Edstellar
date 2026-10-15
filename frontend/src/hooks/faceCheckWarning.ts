import type { FaceCheckOutcome } from "@/hooks/usePeriodicFaceCheck";
import type { ProctoringState } from "@/hooks/useProctoring";

// What the learner sees after a face check during the test. The server
// records face results itself; a camera that can't open is recorded here.
export function showFaceCheckOutcome(proctor: ProctoringState, outcome: FaceCheckOutcome) {
  if (outcome === "no_face") proctor.report("no_face");
  else if (outcome === "multiple_faces") proctor.report("multiple_people");
  else if (outcome === "mismatch" || outcome === "uncertain") proctor.report("face_mismatch");
  // With the camera already streaming for monitoring, a second open can fail
  // without the camera being off; that stream reports a real camera loss.
  else if (!proctor.cameraStream) proctor.report("camera_off", "camera_off");
}
