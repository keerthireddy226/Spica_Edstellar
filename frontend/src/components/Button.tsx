import type { ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  const base =
    "rounded-pill text-sm font-semibold px-5 py-2.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const variantClass =
    variant === "primary"
      ? "bg-navy text-lime hover:bg-navy-deep btn-shine"
      : "bg-surface text-ink border border-rule hover:border-rule-strong";

  return <button className={`${base} ${variantClass} ${className}`} {...props} />;
}
