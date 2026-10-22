import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { getRoadmap } from "@/api/roadmap";
import { ApiError } from "@/lib/api";

// Sidebar nav items past Roadmap/Overview stay locked until a placement
// result exists — mirrors the same signal the Roadmap page itself uses.
// null while unknown. Only the server's "no placement / no roadmap yet" answer
// locks: any other failure (the server restarting, a slow network) is tried
// again, so the menu doesn't stay greyed out until the page is reloaded.
// While locked it's checked again on every page change, so finishing the
// placement test unlocks the menu straight away.
const NOT_YET = new Set(["no_placement_yet", "no_roadmap_yet"]);

export function useHasPlacement() {
  const [hasPlacement, setHasPlacement] = useState<boolean | null>(null);
  const { pathname } = useLocation();
  const recheck = hasPlacement === true ? null : pathname;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const check = (tries: number) => {
      getRoadmap()
        .then(() => alive && setHasPlacement(true))
        .catch((e) => {
          if (!alive) return;
          if (e instanceof ApiError && NOT_YET.has(e.message)) setHasPlacement(false);
          else if (tries < 5) timer = setTimeout(() => check(tries + 1), 2000 * (tries + 1));
        });
    };
    check(0);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [recheck]);

  return hasPlacement;
}
