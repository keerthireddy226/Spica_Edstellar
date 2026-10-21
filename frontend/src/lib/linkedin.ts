// LinkedIn's "Add licence or certification" link, filled in for a certificate.
export function linkedInAddUrl(c: { name: string; code: string; issuedAt: string; validUntil: string | null; verifyUrl: string }): string {
  const issued = new Date(c.issuedAt);
  const p = new URLSearchParams({
    startTask: "CERTIFICATION_NAME",
    name: c.name,
    organizationName: "Spica",
    issueYear: String(issued.getFullYear()),
    issueMonth: String(issued.getMonth() + 1),
    certUrl: c.verifyUrl,
    certId: c.code,
  });
  if (c.validUntil) {
    const until = new Date(c.validUntil);
    p.set("expirationYear", String(until.getFullYear()));
    p.set("expirationMonth", String(until.getMonth() + 1));
  }
  return `https://www.linkedin.com/profile/add?${p}`;
}
