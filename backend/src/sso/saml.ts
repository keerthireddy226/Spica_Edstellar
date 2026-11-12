import { X509Certificate } from "node:crypto";
import { InMemoryCacheProvider, SAML, ValidateInResponseTo, type Profile } from "@node-saml/node-saml";

// SAML 2.0 company login (the other standard besides OpenID Connect). Spica
// is the service provider: one entity ID and one sign-in return address
// (ACS) for every organization; which organization a response belongs to
// comes from the one-time RelayState Spica sent with the request.

const APP_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
export const SAML_SP_ENTITY_ID = `${APP_URL}/api/sso/saml/metadata`;
export const SAML_ACS_URL = `${APP_URL}/api/sso/saml/acs`;

// Every request's ID, so a response must answer a request Spica really sent
// (InResponseTo), once. Shared by all organizations' SAML instances.
const requests = new InMemoryCacheProvider({ keyExpirationPeriodMs: 10 * 60 * 1000 });

export interface SamlIdp {
  entryPoint: string;
  cert: string;
  issuer: string | null;
}

function saml(idp: SamlIdp): SAML {
  return new SAML({
    entryPoint: idp.entryPoint,
    idpCert: idp.cert,
    idpIssuer: idp.issuer ?? undefined,
    issuer: SAML_SP_ENTITY_ID,
    callbackUrl: SAML_ACS_URL,
    audience: SAML_SP_ENTITY_ID,
    // The identity provider must sign the assertion itself.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    cacheProvider: requests,
    acceptedClockSkewMs: 2 * 60 * 1000,
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    disableRequestedAuthnContext: true,
  });
}

// A PEM certificate, with or without its header lines, tidied to PEM.
export function normalizeCert(input: string): string {
  const body = input
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END CERTIFICATE-----\n`;
  // Throws when it isn't a certificate.
  new X509Certificate(pem);
  return pem;
}

export async function samlSignInUrl(idp: SamlIdp, relayState: string, email: string): Promise<string> {
  const url = new URL(await saml(idp).getAuthorizeUrlAsync(relayState, undefined, {}));
  // Most identity providers fill in the email they're given.
  url.searchParams.set("login_hint", email);
  return url.toString();
}

const EMAIL_ATTRS = ["email", "mail", "urn:oid:0.9.2342.19200300.100.1.3", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "Email", "EmailAddress"];
const GIVEN_ATTRS = ["givenName", "firstName", "urn:oid:2.5.4.42", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname", "FirstName"];
const FAMILY_ATTRS = ["sn", "surname", "lastName", "urn:oid:2.5.4.4", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname", "LastName"];

function first(p: Profile, keys: string[]): string | null {
  for (const k of keys) {
    const v = (p as Record<string, unknown>)[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === "string" && s.trim()) return s.trim();
  }
  return null;
}

// Checks the response (signature, audience, time, that it answers our
// request) and returns who signed in.
export async function readSamlResponse(idp: SamlIdp, samlResponse: string): Promise<{ email: string | null; givenName: string | null; familyName: string | null }> {
  const { profile } = await saml(idp).validatePostResponseAsync({ SAMLResponse: samlResponse });
  if (!profile) return { email: null, givenName: null, familyName: null };
  const email = first(profile, EMAIL_ATTRS) ?? (profile.nameID?.includes("@") ? profile.nameID : null);
  return { email: email?.toLowerCase() ?? null, givenName: first(profile, GIVEN_ATTRS), familyName: first(profile, FAMILY_ATTRS) };
}

// What the organization's identity provider needs to know about Spica.
export function spMetadata(): string {
  return saml({ entryPoint: "https://example.invalid/", cert: "x", issuer: null }).generateServiceProviderMetadata(null, null);
}
