import { useEffect, useState } from "react";
import { getMyAccess, isTestOnly, type MyAccess } from "@/api/access";
import { useAuth } from "@/hooks/useAuth";

// What the signed-in learner owns, read once and shared by the menu, the page
// guard and the banners.
let cached: { userId: string; value: Promise<MyAccess | null> } | null = null;

function useAccess(): MyAccess | null | undefined {
  const { user } = useAuth();
  const [access, setAccess] = useState<MyAccess | null | undefined>(undefined);
  useEffect(() => {
    if (!user || user.role !== "learner") {
      setAccess(null);
      return;
    }
    if (cached?.userId !== user.id) cached = { userId: user.id, value: getMyAccess().catch(() => null) };
    let alive = true;
    cached.value.then((a) => alive && setAccess(a));
    return () => {
      alive = false;
    };
  }, [user]);
  return access;
}

// Owns only a real test or level test (see isTestOnly). undefined while it loads.
export function useTestOnly(): boolean | undefined {
  const a = useAccess();
  return a === undefined ? undefined : isTestOnly(a);
}

// Full access or a preparation: both include a final assessment with a
// certificate, so the menu has a Certificates page.
export function useHasCertificatesPage(): boolean {
  const a = useAccess();
  return !!a && (!!a.full || a.prepTests.length > 0);
}
