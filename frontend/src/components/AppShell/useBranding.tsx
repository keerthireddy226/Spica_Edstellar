import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface Branding {
  organization: { name: string; logoUrl: string | null; brandColor: string | null } | null;
  faceCheckRequired: boolean;
  allowedTestProducts: string[] | null;
  // What the organization bought: employee skills, recruitment, or both.
  products: ("skills" | "recruitment")[];
  // Modules for this organization's learners (off when an engagement covers
  // only practice tests and mock tests).
  modulesEnabled?: boolean;
  // "university": Campus (skills) and Admissions (recruitment).
  category?: "company" | "university" | "other" | null;
}

// Kept per signed-in person: signing in as someone else in the same tab must
// not reuse the last person's policies (a staff account's "face check on"
// once showed a face check to a learner who doesn't need one).
let cached: Promise<Branding> | null = null;
let cachedFor: string | null = null;
const listeners = new Set<(b: Branding) => void>();

export function getBranding(userId?: string): Promise<Branding> {
  if (userId !== undefined && userId !== cachedFor) {
    cached = null;
    cachedFor = userId;
  }
  if (!cached) cached = api<Branding>("/branding/me").catch((err) => {
    cached = null;
    throw err;
  });
  return cached;
}

export function refreshBranding() {
  cached = null;
  getBranding()
    .then((b) => listeners.forEach((l) => l(b)))
    .catch(() => {});
}

// The signed-in person's organization branding and learner policies.
export function useBranding(): Branding | null {
  const { user } = useAuth();
  const [b, setB] = useState<Branding | null>(null);
  useEffect(() => {
    if (!user) return;
    let live = true;
    setB(null);
    getBranding(user.id)
      .then((x) => live && setB(x))
      .catch(() => {});
    listeners.add(setB);
    return () => {
      live = false;
      listeners.delete(setB);
    };
  }, [user?.id]);
  return b;
}

// Logo and name of the organization, for the app header.
export function OrgBrandBadge() {
  const b = useBranding();
  const org = b?.organization;
  if (!org) return null;
  return (
    <div className="hidden sm:flex items-center gap-2 pl-3 ml-1 border-l border-rule min-w-0">
      {org.logoUrl && <img src={org.logoUrl} alt="" className="h-7 w-7 object-contain rounded" />}
      <span className="text-sm text-muted truncate max-w-[180px]">{org.name}</span>
    </div>
  );
}

export function useBrandColor(): string | null {
  return useBranding()?.organization?.brandColor ?? null;
}

// A university's recruitment product is Admissions: applicants, programs, admit or decline.
export function useAdmissions(): boolean {
  return useBranding()?.category === "university";
}

// Whether learners get Modules (true until the branding has loaded).
export function useModulesEnabled(): boolean {
  return useBranding()?.modulesEnabled !== false;
}
