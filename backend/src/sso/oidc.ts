import { createPublicKey, verify, constants, type JsonWebKeyInput } from "node:crypto";

type Jwk = JsonWebKeyInput["key"] & { kid?: string; alg?: string; use?: string };
import { assertPublicUrl } from "../lib/netGuard.js";
import { TtlCache } from "../lib/ttlCache.js";

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  token_endpoint_auth_methods_supported?: string[];
}

const discoveryCache = new TtlCache<Discovery>(60 * 60 * 1000, 500);
const jwksCache = new TtlCache<{ keys: Jwk[] }>(60 * 60 * 1000, 500);

async function getJson<T>(raw: string): Promise<T> {
  const url = new URL(raw);
  if (url.protocol !== "https:" && process.env.SSO_ALLOW_PRIVATE !== "true") throw new Error("identity provider URLs must use https");
  await assertPublicUrl(url, "SSO_ALLOW_PRIVATE");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: "error", headers: { Accept: "application/json" } });
    if (!r.ok) {
      // Close the unread reply before giving up (an unread body can crash Node's fetch later).
      await r.body?.cancel().catch(() => {});
      throw new Error(`${url.host} answered HTTP ${r.status}`);
    }
    return (await r.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function discover(issuer: string): Promise<Discovery> {
  const base = issuer.replace(/\/+$/, "");
  return discoveryCache.getOrLoad(base, async () => {
    const d = await getJson<Discovery>(`${base}/.well-known/openid-configuration`);
    if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri || !d.issuer) throw new Error("incomplete OpenID configuration");
    return d;
  });
}

async function jwks(uri: string, refresh = false) {
  if (refresh) jwksCache.delete(uri);
  return jwksCache.getOrLoad(uri, () => getJson<{ keys: Jwk[] }>(uri));
}

function b64url(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

const HASH: Record<string, string> = { "256": "sha256", "384": "sha384", "512": "sha512" };

// Verifies an ID token's signature against the provider's published keys,
// and its issuer, audience, expiry and nonce.
export async function verifyIdToken(token: string, d: Discovery, clientId: string, nonce: string): Promise<Record<string, unknown>> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed id_token");
  const header = JSON.parse(b64url(parts[0]).toString()) as { alg: string; kid?: string };
  const alg = header.alg ?? "";
  const family = alg.slice(0, 2);
  const hash = HASH[alg.slice(2)];
  if (!["RS", "PS", "ES"].includes(family) || !hash) throw new Error(`unsupported signing algorithm ${alg}`);

  let set = await jwks(d.jwks_uri);
  let jwk = set.keys.find((k) => (header.kid ? k.kid === header.kid : true) && (!k.use || k.use === "sig"));
  if (!jwk) {
    set = await jwks(d.jwks_uri, true); // the provider rotated its keys
    jwk = set.keys.find((k) => (header.kid ? k.kid === header.kid : true));
  }
  if (!jwk) throw new Error("signing key not found");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = b64url(parts[2]);
  const ok =
    family === "ES"
      ? verify(hash, data, { key, dsaEncoding: "ieee-p1363" }, sig)
      : family === "PS"
        ? verify(hash, data, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, sig)
        : verify(hash, data, key, sig);
  if (!ok) throw new Error("bad id_token signature");

  const claims = JSON.parse(b64url(parts[1]).toString()) as Record<string, unknown>;
  const now = Math.floor(Date.now() / 1000);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== d.issuer) throw new Error("id_token from the wrong issuer");
  if (!aud.includes(clientId)) throw new Error("id_token for a different client");
  if (aud.length > 1 && claims.azp && claims.azp !== clientId) throw new Error("id_token azp mismatch");
  if (typeof claims.exp !== "number" || claims.exp < now - 60) throw new Error("id_token expired");
  if (claims.nonce !== nonce) throw new Error("id_token nonce mismatch");
  return claims;
}

export async function exchangeCode(args: { d: Discovery; code: string; redirectUri: string; clientId: string; clientSecret: string; codeVerifier: string }) {
  const url = new URL(args.d.token_endpoint);
  if (url.protocol !== "https:" && process.env.SSO_ALLOW_PRIVATE !== "true") throw new Error("token endpoint must use https");
  await assertPublicUrl(url, "SSO_ALLOW_PRIVATE");
  const methods = args.d.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  const basic = methods.includes("client_secret_basic");
  const form = new URLSearchParams({ grant_type: "authorization_code", code: args.code, redirect_uri: args.redirectUri, code_verifier: args.codeVerifier });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" };
  if (basic) {
    headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(args.clientId)}:${encodeURIComponent(args.clientSecret)}`).toString("base64")}`;
  } else {
    form.set("client_id", args.clientId);
    form.set("client_secret", args.clientSecret);
  }
  const r = await fetch(url, { method: "POST", headers, body: form, redirect: "error" });
  const body = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!r.ok || !body.id_token) throw new Error(`token exchange failed: ${body.error_description ?? body.error ?? r.status}`);
  return body.id_token;
}
