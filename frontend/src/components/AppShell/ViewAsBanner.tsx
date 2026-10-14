import { Eye } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

// Shown while Edstellar staff are looking at an account read-only.
export function ViewAsBanner() {
  const { user } = useAuth();
  if (!user?.viewAs) return null;
  async function exit() {
    const r = await api<{ restored: boolean; role?: string }>("/auth/view-as/exit", { method: "POST" }).catch(() => ({ restored: false, role: undefined }));
    window.location.assign(r.restored ? (r.role === "super_admin" ? "/superadmin/dashboard" : "/admin/organizations") : "/admin/login");
  }
  return (
    <div className="flex items-center justify-center gap-3 bg-warning text-navy-deep text-sm font-semibold px-4 py-2 shrink-0">
      <Eye size={16} />
      <span>
        {user.viewAs.impersonatorName}, you're viewing this account read-only. Nothing can be changed.
      </span>
      <button onClick={exit} className="underline cursor-pointer">
        Exit
      </button>
    </div>
  );
}
