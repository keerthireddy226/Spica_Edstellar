// The consent screen runs before the test's session exists, so the agreement
// waits here (this tab only) and goes along with the session's proctoring
// setup call, which links it to the session.
const KEY = "spica.testConsent";

export function holdTestConsent(consentId: string) {
  try {
    sessionStorage.setItem(KEY, consentId);
  } catch {
    // Storage blocked: the proctoring steps ask for consent again instead.
  }
}

export function heldTestConsent(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}
