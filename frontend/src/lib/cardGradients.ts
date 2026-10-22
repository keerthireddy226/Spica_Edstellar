// Stat-card gradient rotation for the Super Admin console — built from the
// app's own brand tokens (the same clay used for the sidebar, plus moss/
// amber/brick-red), not arbitrary colors picked to mimic a reference UI.
// Each stop is the token's own color fading to a darkened version of
// itself via color-mix(), so it stays correct automatically in dark mode
// too (the token's dark-mode value just gets mixed instead).
export const CARD_GRADIENTS: { background: string }[] = [
  { background: "linear-gradient(135deg, var(--color-navy), color-mix(in srgb, var(--color-navy) 100%, black 35%))" },
  { background: "linear-gradient(135deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 100%, black 35%))" },
  // Amber is light: darkened at both ends so white text stays readable, also in dark mode.
  { background: "linear-gradient(135deg, color-mix(in srgb, var(--color-warning) 80%, black), color-mix(in srgb, var(--color-warning) 55%, black))" },
  { background: "linear-gradient(135deg, var(--color-error), color-mix(in srgb, var(--color-error) 100%, black 30%))" },
];

export function cardGradient(index: number): { background: string } {
  return CARD_GRADIENTS[index % CARD_GRADIENTS.length];
}
