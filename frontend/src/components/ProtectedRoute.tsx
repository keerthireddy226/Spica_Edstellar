import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";
import { PrivacyAgreement } from "@/components/PrivacyAgreement";
import { Reconnecting } from "@/components/Reconnecting";
import { CandidateSignedOut, candidateLink } from "@/components/CandidateSignedOut";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, reconnecting } = useAuth();
  const { pathname } = useLocation();

  if (loading) return reconnecting ? <Reconnecting /> : null;
  // A job candidate signed out (their link's time is up, or it was opened on
  // another device) is sent back to their test link, never to the login page.
  if (!user && (pathname.startsWith(ROUTES.CANDIDATE) || candidateLink())) return <CandidateSignedOut />;
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  // A candidate only ever sees their assessment.
  if (user.role === "candidate" && !pathname.startsWith(ROUTES.CANDIDATE)) return <Navigate to={ROUTES.CANDIDATE} replace />;
  // The current Privacy Notice comes before anything else.
  if (user.privacyRequired) return <PrivacyAgreement />;
  return <>{children}</>;
}
