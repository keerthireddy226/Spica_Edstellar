import { api } from "@/lib/api";

export type FaceCheckPurpose = "placement" | "practice" | "practice_test";

export function getFaceEnrollmentStatus(): Promise<{ enrolled: boolean; required?: boolean }> {
  return api("/face/enrollment/status");
}

export function enrollFace(imageBase64: string): Promise<{ status: "enrolled" | "failed"; reasons?: string[] }> {
  return api("/face/enrollment", {
    method: "POST",
    body: JSON.stringify({ consentGiven: true, imageBase64 }),
  });
}

export interface FaceVerifyResult {
  faceCheckId: string;
  allowed: boolean;
  decision: "match" | "uncertain" | "mismatch" | "no_face" | "multiple_faces" | "spoof" | "error";
  retake: boolean;
  fallbackEligible?: boolean;
  retriesRemaining?: number;
  reason?: string;
}

export function verifyFace(purpose: FaceCheckPurpose, imageBase64: string, sessionId?: string): Promise<FaceVerifyResult> {
  return api("/face/verify", {
    method: "POST",
    body: JSON.stringify({ purpose, imageBase64, sessionId }),
  });
}

export function requestFaceFallbackOtp(faceCheckId: string): Promise<{ sent: boolean }> {
  return api("/face/otp/request", { method: "POST", body: JSON.stringify({ faceCheckId }) });
}

export function verifyFaceFallbackOtp(faceCheckId: string, code: string): Promise<{ allowed: boolean; faceCheckId: string }> {
  return api("/face/otp/verify", { method: "POST", body: JSON.stringify({ faceCheckId, code }) });
}
