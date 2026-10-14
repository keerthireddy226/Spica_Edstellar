import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Outbound calls to URLs an organization typed in (webhooks, its identity
// provider) must never reach our own network.
const PRIVATE = new BlockList();
for (const [net, bits] of [
  ["10.0.0.0", 8],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["100.64.0.0", 10],
  ["0.0.0.0", 8],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["::", 128],
] as const)
  PRIVATE.addSubnet(net, bits, "ipv6");

// allowEnv: name of an env var that, set to "true", allows private targets (local development only).
export async function assertPublicUrl(url: URL, allowEnv: string) {
  if (process.env[allowEnv] === "true") return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
  for (const a of addrs) {
    if (PRIVATE.check(a.address, a.family === 6 ? "ipv6" : "ipv4")) throw new Error(`refusing to call private address ${a.address}`);
  }
}
