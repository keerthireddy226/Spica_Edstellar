import { useId } from "react";

import { tr } from "@/i18n/tr";
export function Mascot({ variant, size = 140 }: { variant: "hero" | "coach"; size?: number }) {
  const gradId = useId();
  const isHero = variant === "hero";

  return (
    <svg viewBox="0 0 220 220" width={size} height={size}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-navy)" />
          <stop offset="100%" stopColor="var(--color-accent)" />
        </linearGradient>
      </defs>
      {isHero && (
        <>
          <ellipse cx="110" cy="196" rx="46" ry="8" fill="var(--color-ink)" opacity={0.08} />
          <path d="M64 128 Q46 138 48 158 Q49 168 60 166 Q68 164 66 152 Q64 140 74 132 Z" fill={`url(#${gradId})`} />
          <path d="M156 128 Q174 138 172 158 Q171 168 160 166 Q152 164 154 152 Q156 140 146 132 Z" fill={`url(#${gradId})`} />
        </>
      )}
      <path
        d={
          isHero
            ? tr("M70 108 Q66 150 78 178 L142 178 Q154 150 150 108 Q142 82 110 80 Q78 82 70 108 Z")
            : tr("M70 120 Q66 162 78 190 L142 190 Q154 162 150 120 Q142 94 110 92 Q78 94 70 120 Z")
        }
        fill={`url(#${gradId})`}
      />
      {isHero && <rect x="98" y="66" width="24" height="20" rx="8" fill="var(--color-writing)" />}
      <circle cx="110" cy={isHero ? 48 : 60} r="34" fill="var(--color-writing)" />
      <path
        d={isHero ? tr("M78 44 Q110 6 142 44") : tr("M78 56 Q110 18 142 56")}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth={6}
        strokeLinecap="round"
      />
      <ellipse cx="78" cy={isHero ? 54 : 66} rx="10" ry="13" fill="var(--color-ink)" />
      <ellipse cx="142" cy={isHero ? 54 : 66} rx="10" ry="13" fill="var(--color-ink)" />
      {isHero && (
        <>
          <path d="M92 46 Q98 42 104 46" fill="none" stroke="var(--color-ink)" strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
          <path d="M116 46 Q122 42 128 46" fill="none" stroke="var(--color-ink)" strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
          <path d="M104 60 Q110 63 116 60" fill="none" stroke="var(--color-ink)" strokeWidth={2.4} strokeLinecap="round" opacity={0.7} />
        </>
      )}
    </svg>
  );
}
