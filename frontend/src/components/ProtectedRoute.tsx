import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { ROUTES } from "@/constants/routes";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();

  if (loading) return null;
  if (!user) return <Navigate to={ROUTES.LOGIN} replace />;
  // A candidate only ever sees their assessment.
  if (user.role === "candidate" && !pathname.startsWith(ROUTES.CANDIDATE)) return <Navigate to={ROUTES.CANDIDATE} replace />;
  return <>{children}</>;
}
