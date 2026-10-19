// A phone (not a tablet) from its user agent: iPhone, or Android with
// "Mobile" (Android tablets leave it out; iPads report themselves as Macs).
export function isPhoneUserAgent(ua: string | undefined): boolean {
  if (!ua) return false;
  return /iPhone|iPod/.test(ua) || (/Android/.test(ua) && /Mobile/.test(ua));
}
