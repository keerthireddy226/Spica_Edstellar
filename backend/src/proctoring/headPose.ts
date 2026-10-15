// Where the learner is looking, from the five face landmarks YuNet already
// returns: how far the nose sits from the middle of the eyes, sideways
// (yaw) and up/down (pitch). A rough estimate, good enough to tell "facing
// the screen" from "turned away"; it is not eye tracking.
import type { FaceBox } from "../face/detect.js";

export type HeadDirection = "center" | "left" | "right" | "up" | "down";

// Measured on 71 face-check photos taken while looking at the screen:
// |yaw| median 0.15 but up to 0.43 (a camera to one side of the screen
// shifts everyone), pitch 0.51 to 0.80. The session analysis compares each
// snapshot with that learner's own median instead of these fixed limits.
const YAW_LIMIT = 0.55;
const PITCH_UP = 0.3;
const PITCH_DOWN = 0.85;

export function headPose(face: FaceBox): { direction: HeadDirection; yaw: number; pitch: number } | null {
  const [rightEye, leftEye, nose, rightMouth, leftMouth] = face.landmarks;
  if (!rightEye || !leftEye || !nose || !rightMouth || !leftMouth) return null;
  const eyeMid = { x: (rightEye.x + leftEye.x) / 2, y: (rightEye.y + leftEye.y) / 2 };
  const mouthMid = { x: (rightMouth.x + leftMouth.x) / 2, y: (rightMouth.y + leftMouth.y) / 2 };
  const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  const faceHeight = mouthMid.y - eyeMid.y;
  if (eyeDist < 1 || faceHeight < 1) return null;
  const yaw = (nose.x - eyeMid.x) / eyeDist;
  const pitch = (nose.y - eyeMid.y) / faceHeight;
  // Image coordinates: the learner turning to their left moves the nose to
  // the image's right.
  const direction: HeadDirection =
    yaw > YAW_LIMIT ? "left" : yaw < -YAW_LIMIT ? "right" : pitch < PITCH_UP ? "up" : pitch > PITCH_DOWN ? "down" : "center";
  return { direction, yaw: Math.round(yaw * 100) / 100, pitch: Math.round(pitch * 100) / 100 };
}
