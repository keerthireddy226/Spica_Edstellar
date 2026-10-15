import type { ReactNode } from "react";
import { GraduationCap } from "lucide-react";

import { tr } from "@/i18n/tr";
export function AuthCard({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top half — a brand panel, sized to 30% of the viewport rather than a
          full half, so it stays a strip of identity, not a dominant block. */}
      <div className="min-h-[30vh] bg-navy text-lime flex flex-col items-center justify-center gap-3 px-4 py-6">
        <span className="h-16 w-16 rounded-input bg-lime/15 flex items-center justify-center shadow-[0_8px_18px_-6px_rgba(0,0,0,0.25)]">
          <GraduationCap size={34} strokeWidth={1.8} />
        </span>
        <h1 className="font-logo tracking-tight flex items-baseline gap-3">
          <span className="font-bold text-6xl text-logo-primary">{eyebrow}</span>
          <span className="italic font-medium text-2xl text-logo-accent">{tr("by Edstellar")}</span>
        </h1>
      </div>

      {/* Bottom half — the actual sign-in/sign-up form. Deliberately compact
          (tight padding, small text) — the brand panel above is the visual
          statement, this half is just the utility of getting signed in. */}
      <div className="app-surface min-h-[70vh] flex-1 flex items-start justify-center px-4 pt-8 pb-6">
        <div className="w-full max-w-xs flex flex-col gap-3.5">
          <div className="text-center">
            <h2 className="font-display font-semibold text-xs text-ink">{title}</h2>
            <p className="text-xs text-muted mt-0.5">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function FormField({
  id,
  label,
  icon,
  ...props
}: { id: string; label: string; icon?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none">{icon}</span>}
        <input
          id={id}
          name={id}
          className={`w-full rounded-input border border-rule bg-paper py-2 text-xs text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy ${
            icon ? "pl-9 pr-3" : "px-3"
          }`}
          {...props}
        />
      </div>
    </div>
  );
}
