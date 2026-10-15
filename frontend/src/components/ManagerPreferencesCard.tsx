import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { getManagerPreferences, saveManagerPreferences } from "@/api/manager";

// Which alert emails a Manager gets about their batches.
export function ManagerPreferencesCard() {
  const [prefs, setPrefs] = useState<{ dailyDigest: boolean; poolAlerts: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    getManagerPreferences().then(setPrefs).catch(() => {});
  }, []);
  if (!prefs) return null;

  async function toggle(k: "dailyDigest" | "poolAlerts", v: boolean) {
    const next = { ...prefs!, [k]: v };
    setPrefs(next);
    await saveManagerPreferences(next).catch(() => {});
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="bg-surface border border-rule rounded-card shadow-sm p-5 sm:p-6 flex flex-col gap-4">
      <h2 className="font-display font-bold text-ink flex items-center gap-2.5">
        <span className="h-9 w-9 rounded-xl flex items-center justify-center text-white shadow-sm" style={{ background: "#6e9660" }}>
          <BellRing size={18} />
        </span>
        Email alerts {saved && <span className="text-xs font-normal text-success">Saved</span>}
      </h2>
      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
        <input type="checkbox" checked={prefs.dailyDigest} onChange={(e) => toggle("dailyDigest", e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy" />
        <span>
          Daily digest
          <span className="block text-xs text-muted">Learners whose access is ending, who stopped practising, or haven't started — only on days there's something to act on.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 text-sm text-ink cursor-pointer">
        <input type="checkbox" checked={prefs.poolAlerts} onChange={(e) => toggle("poolAlerts", e.target.checked)} className="mt-0.5 h-4 w-4 accent-navy" />
        <span>
          License pool alerts
          <span className="block text-xs text-muted">When your pool is nearly or completely used up.</span>
        </span>
      </label>
      <p className="text-xs text-muted">Weekly or monthly progress reports are set on the Analytics page.</p>
    </div>
  );
}
