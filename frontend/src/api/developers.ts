import { api } from "@/lib/api";

export interface ApiKeyInfo {
  id: string;
  name: string;
  prefix: string;
  scopes: ("read" | "write")[];
  createdAt: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface WebhookInfo {
  id: string;
  url: string;
  secret: string;
  events: string[];
  enabled: boolean;
  disabledReason: string | null;
  consecutiveFailures: number;
  createdAt: string;
  recentDeliveries: { id: string; event: string; status: string; attempts: number; response_code: number | null; last_error: string | null; created_at: string }[];
}

export const developersApi = {
  keys: () => api<{ keys: ApiKeyInfo[] }>("/org-admin/api-keys"),
  createKey: (name: string, scopes: string[]) =>
    api<{ id: string; key: string; name: string; scopes: string[] }>("/org-admin/api-keys", { method: "POST", body: JSON.stringify({ name, scopes }) }),
  revokeKey: (id: string) => api(`/org-admin/api-keys/${id}`, { method: "DELETE" }),
  webhooks: () => api<{ events: string[]; webhooks: WebhookInfo[] }>("/org-admin/webhooks"),
  createWebhook: (url: string, events: string[]) => api<{ id: string }>("/org-admin/webhooks", { method: "POST", body: JSON.stringify({ url, events }) }),
  updateWebhook: (id: string, body: { enabled?: boolean; events?: string[] }) => api(`/org-admin/webhooks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteWebhook: (id: string) => api(`/org-admin/webhooks/${id}`, { method: "DELETE" }),
  testWebhook: (id: string) => api(`/org-admin/webhooks/${id}/test`, { method: "POST" }),
};

export interface DataGovernance {
  dpa: { acceptedAt: string | null; acceptedBy: string | null; acceptedVersion: string | null; currentVersion: string; url: string | null };
  retention: { recordingsMonths: number | null; inactiveLearnerMonths: number | null };
  exports: { id: string; status: "queued" | "ready" | "failed" | "expired"; sizeBytes: number | null; createdAt: string; completedAt: string | null; expiresAt: string | null }[];
}

export const governanceApi = {
  get: () => api<DataGovernance>("/org-admin/data"),
  acceptDpa: () => api("/org-admin/data/dpa/accept", { method: "POST" }),
  setRetention: (body: { recordingsMonths: number | null; inactiveLearnerMonths: number | null }) =>
    api("/org-admin/data/retention", { method: "PATCH", body: JSON.stringify(body) }),
  requestExport: () => api<{ id: string }>("/org-admin/data-export", { method: "POST" }),
  eraseLearner: (id: string, reason: string) => api(`/org-admin/learners/${id}/erase`, { method: "POST", body: JSON.stringify({ confirm: true, reason }) }),
};

export interface SsoSettings {
  issuer: string;
  clientId: string;
  hasClientSecret: boolean;
  enabled: boolean;
  enforce: boolean;
  jitProvisioning: boolean;
  redirectUri: string;
  domains: { domain: string; verified: boolean; txtName: string; txtValue: string }[];
  scim: { enabled: boolean; tokenPrefix: string | null; baseUrl: string };
}

export const ssoApi = {
  get: () => api<SsoSettings>("/org-admin/sso"),
  save: (body: { issuer: string; clientId: string; clientSecret?: string; enabled: boolean; enforce: boolean; jitProvisioning: boolean }) =>
    api<SsoSettings>("/org-admin/sso", { method: "PATCH", body: JSON.stringify(body) }),
  addDomain: (domain: string) => api<SsoSettings>("/org-admin/sso/domains", { method: "POST", body: JSON.stringify({ domain }) }),
  verifyDomain: (domain: string) => api<SsoSettings>(`/org-admin/sso/domains/${encodeURIComponent(domain)}/verify`, { method: "POST" }),
  removeDomain: (domain: string) => api<SsoSettings>(`/org-admin/sso/domains/${encodeURIComponent(domain)}`, { method: "DELETE" }),
  newScimToken: () => api<{ token: string; baseUrl: string }>("/org-admin/scim-token", { method: "POST" }),
  revokeScimToken: () => api("/org-admin/scim-token", { method: "DELETE" }),
};
