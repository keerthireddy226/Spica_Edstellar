import { useEffect, useState } from "react";

// A phone (not a tablet): iPhone, or Android with "Mobile" in its user agent
// (Android tablets leave it out; iPads report themselves as Macs).
export function isPhone(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const hint = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  return /iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua)) || hint === true;
}

// A narrow screen (phone-sized layout), following window resizes.
export function useSmallScreen(maxWidth = 640): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [small, setSmall] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setSmall(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return small;
}
