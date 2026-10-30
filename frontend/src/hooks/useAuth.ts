import { createContext, useCallback, useContext, useEffect, useState } from "react";
import i18n from "i18next";
import { changeAppLanguage, isSupportedLanguage } from "@/i18n";
import { api, isTransientError } from "@/lib/api";
import { forgetCandidateLink } from "@/components/CandidateSignedOut";

export type Role = "learner" | "org_admin" | "admin" | "super_admin" | "manager" | "recruiter" | "candidate";

type AuthUser = {
  id: string;
  email: string;
  role: Role;
  emailVerified: boolean;
  tenantId?: string;
  firstName?: string;
  lastName?: string;
  createdAt?: string;
  lastLoginAt?: string | null;
  department?: string | null;
  permissions?: Record<string, unknown>;
  participantId?: string | null;
  preferredLanguage?: string | null;
  onboardedBy?: { id: string; email: string; name: string; role: string } | null;
  mfaEnabled?: boolean;
  // The organization requires two-step sign-in and it isn't set up yet.
  mfaSetupRequired?: boolean;
  // Edstellar staff viewing this account read-only.
  viewAs?: { impersonatorName: string } | null;
  // The current Privacy Notice hasn't been agreed yet.
  privacyRequired?: boolean;
  // Which Privacy Notice applies to this person.
  privacyAudience?: "free" | "paid" | "organization" | "assessment";
};

// With two-step sign-in on, the password step returns a challenge instead of a user.
export type LoginResult = AuthUser | { mfaRequired: true; challenge: string };

export function isMfaChallenge(r: LoginResult): r is { mfaRequired: true; challenge: string } {
  return (r as { mfaRequired?: boolean }).mfaRequired === true;
}

export interface LoginHistoryEntry {
  ipAddress: string | null;
  device: string;
  occurredAt: string;
}

export interface ActiveSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  isCurrent: boolean;
}

export function getLoginHistory(): Promise<{ logins: LoginHistoryEntry[] }> {
  return api("/auth/me/login-history");
}

export function getActiveSessions(): Promise<{ sessions: ActiveSession[] }> {
  return api("/auth/me/sessions");
}

export function saveLanguagePreference(language: string): Promise<void> {
  return api("/auth/me/language", { method: "PATCH", body: JSON.stringify({ language }) });
}

export function revokeSession(id: string): Promise<void> {
  return api(`/auth/me/sessions/${id}`, { method: "DELETE" });
}

type AuthState = {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  // The server didn't answer the sign-in check; trying again.
  reconnecting?: boolean;
};

export function useAuthState() {
  const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

  // Only the server saying "not signed in" signs someone out. A dropped
  // connection or a busy or restarting server is tried again (shown as
  // "Reconnecting…"), keeping whoever was signed in, so a moment's outage never
  // sends a learner or a candidate mid-test to the login page.
  const refresh = useCallback(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        const user = await api<AuthUser>("/auth/me");
        setState({ user, loading: false, error: null });
        return;
      } catch (err) {
        if (!isTransientError(err)) {
          setState({ user: null, loading: false, error: null });
          return;
        }
        setState((s) => ({ ...s, reconnecting: true }));
        await new Promise((r) => setTimeout(r, Math.min(2000 * 2 ** attempt, 15000)));
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // The saved language follows the user across devices. If they've never
  // picked one, record whatever they're currently using so analytics and
  // emails have a language for every account.
  const userId = state.user?.id;
  const savedLanguage = state.user?.preferredLanguage;
  useEffect(() => {
    if (!userId) return;
    if (savedLanguage) {
      if (savedLanguage !== i18n.language && isSupportedLanguage(savedLanguage)) changeAppLanguage(savedLanguage);
    } else {
      saveLanguagePreference(i18n.language).catch(() => {});
    }
  }, [userId, savedLanguage]);

  // `allowedRoles` names which role(s) the login portal accepts (e.g.
  // /admin/login accepts both admin and super_admin) — the backend rejects
  // the login if the account's actual role isn't in that list, so this is a
  // real access boundary, not just a different-looking page. Returns the
  // logged-in user so the caller can redirect based on their actual role
  // immediately, without waiting on a state update to propagate.
  const login = useCallback(async (email: string, password: string, allowedRoles: Role[]): Promise<LoginResult> => {
    const result = await api<LoginResult>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password, allowedRoles }),
    });
    if (!isMfaChallenge(result)) {
      // Someone signing in normally here isn't a job candidate any more.
      forgetCandidateLink();
      setState({ user: result, loading: false, error: null });
      // The login response is a short user; /auth/me adds permissions and
      // the rest, which staff menus and buttons depend on.
      refresh();
    }
    return result;
  }, [refresh]);

  const verifyMfa = useCallback(async (challenge: string, code: string): Promise<AuthUser> => {
    const user = await api<AuthUser>("/auth/mfa/verify", { method: "POST", body: JSON.stringify({ challenge, code }) });
    setState({ user, loading: false, error: null });
    refresh();
    return user;
  }, [refresh]);

  // Deliberately doesn't set auth state — signup ends with "check your email,"
  // not an automatic login (the backend doesn't create a session either).
  const signup = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    await api<{ email: string }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, firstName, lastName, acceptPrivacy: true, adultConfirmed: true }),
    });
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" });
    setState({ user: null, loading: false, error: null });
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    await api("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) });
  }, []);

  // Returns the account's role so the caller can redirect to *that* role's
  // login page — neither of these actions creates a session, so this is the
  // only way the frontend learns which portal the account belongs to.
  const resetPassword = useCallback(async (token: string, password: string) => {
    const result = await api<{ role: Role }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    });
    // The backend signs this browser out (an invite link is often opened
    // where someone else is signed in). Forget that person here too, or the
    // login page sends the new user straight into the old account's console.
    setState({ user: null, loading: false, error: null });
    return result;
  }, []);

  const verifyEmail = useCallback(async (token: string) => {
    return api<{ role: Role }>("/auth/verify-email", { method: "POST", body: JSON.stringify({ token }) });
  }, []);

  // The only account fields Profile lets someone edit — re-fetches /me
  // afterward so every place showing the name (here, the sidebar initials,
  // Profile's header) updates from the same source instead of guessing at
  // the new value locally.
  const updateName = useCallback(
    async (firstName: string, lastName: string) => {
      await api("/auth/me", { method: "PATCH", body: JSON.stringify({ firstName, lastName }) });
      await refresh();
    },
    [refresh],
  );

  return { ...state, login, verifyMfa, signup, logout, forgotPassword, resetPassword, verifyEmail, updateName, refresh };
}

export const AuthContext = createContext<ReturnType<typeof useAuthState> | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthContext.Provider");
  return ctx;
}
