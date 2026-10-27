import { useEffect } from "react";

// While a test or a Practice Modules set is open: no copying the questions,
// no pasting or dropping text into answers, and no right-click menu. Every
// kind of test and practice, proctored or not (proctoring's lockdown also
// records each attempt for review).
export function useNoCopyPaste(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const block = (e: Event) => e.preventDefault();
    const types = ["copy", "cut", "paste", "drop", "dragstart", "contextmenu"] as const;
    for (const t of types) document.addEventListener(t, block);
    return () => {
      for (const t of types) document.removeEventListener(t, block);
    };
  }, [active]);
}
