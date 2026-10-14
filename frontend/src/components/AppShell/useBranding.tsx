import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

export interface Branding {
  organization: { name: string; logoUrl: string | null; brandColor: string | null } | null;
  faceCheckRequired: boolean;
  allowedTestProducts: string[] | null;
}

let cached: Promise<Branding> | null = null;
const listeners = new Set<(b: Branding) => void>();

export function getBranding(): Promise<Branding> {
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
    getBranding()
      .then((x) => live && setB(x))
      .catch(() => {});
    listeners.add(setB);
    return () => {
      live = false;
      listeners.delete(setB);
    };
  }, [user]);
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
