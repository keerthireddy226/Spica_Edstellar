import { Eye } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

import { tr } from "@/i18n/tr";
// Shown while Edstellar staff are looking at an account read-only.
export function ViewAsBanner() {
  const { user } = useAuth();
  if (!user?.viewAs) return null;
  async function exit() {
    const r = await api<{ restored: boolean; role?: string }>("/auth/view-as/exit", { method: "POST" }).catch(() => ({ restored: false, role: undefined }));
    const back: Record<string, string> = { super_admin: "/superadmin/dashboard", admin: "/admin/organizations", org_admin: "/orgadmin/managers" };
    window.location.assign(r.restored && r.role ? (back[r.role] ?? "/") : "/login");
  }
  return (
    <div className="flex items-center justify-center gap-3 bg-warning text-navy-deep text-sm font-semibold px-4 py-2 shrink-0">
      <Eye size={16} />
      <span>
        {tr("{{impersonatorName}}, you're viewing this account read-only. Nothing can be changed.", { impersonatorName: user.viewAs.impersonatorName })}</span>
      <button onClick={exit} className="underline cursor-pointer">
        {tr("Exit")}</button>
    </div>
  );
}
