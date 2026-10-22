import { useEffect, useState } from "react";
import { getMyAccess, isTestOnly } from "@/api/access";
import { useAuth } from "@/hooks/useAuth";

// Read once per signed-in learner and shared by the menu, the page guard and
// the banners. undefined while it loads.
let cached: { userId: string; value: Promise<boolean> } | null = null;

export function useTestOnly(): boolean | undefined {
  const { user } = useAuth();
  const [testOnly, setTestOnly] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!user || user.role !== "learner") {
      setTestOnly(false);
      return;
    }
    if (cached?.userId !== user.id) {
      cached = {
        userId: user.id,
        value: getMyAccess()
          .then(isTestOnly)
          .catch(() => false),
      };
    }
    let alive = true;
    cached.value.then((v) => alive && setTestOnly(v));
    return () => {
      alive = false;
    };
  }, [user]);
  return testOnly;
}
