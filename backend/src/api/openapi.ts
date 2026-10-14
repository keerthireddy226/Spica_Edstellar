// A compact OpenAPI 3.1 description of the public API, served at
// /api/v1/openapi.json for API clients and code generators.
const learner = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    participantId: { type: "string", example: "SPC-26-000123" },
    email: { type: "string", format: "email" },
    firstName: { type: "string" },
    lastName: { type: "string" },
    status: { type: "string", enum: ["active", "deactivated"] },
    inviteAccepted: { type: "boolean" },
    batch: { type: ["object", "null"], properties: { id: { type: "string" }, code: { type: "string" }, name: { type: "string" } } },
    currentCefr: { type: ["string", "null"], example: "B1" },
    sessionsCompleted: { type: "integer" },
    lastActiveOn: { type: ["string", "null"], format: "date" },
    license: { type: ["object", "null"], properties: { status: { type: "string" }, accessEndsAt: { type: ["string", "null"] } } },
    createdAt: { type: "string", format: "date-time" },
  },
};

export const OPENAPI = {
  openapi: "3.1.0",
  info: {
    title: "Spica API",
    version: "1.0.0",
    description:
      "Read and manage your organization's learners from your LMS or HR system. Authenticate with `Authorization: Bearer spk_…` (create keys in Settings → Developers). 120 requests per minute per key.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    schemas: { Learner: learner },
  },
  security: [{ bearer: [] }],
  paths: {
    "/learners": {
      get: {
        summary: "List learners",
        parameters: [
          { name: "batchCode", in: "query", schema: { type: "string" } },
          { name: "status", in: "query", schema: { type: "string", enum: ["active", "deactivated"] } },
          { name: "limit", in: "query", schema: { type: "integer", maximum: 500, default: 100 } },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "nextCursor from the previous page" },
        ],
        responses: { "200": { description: "A page of learners", content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: { $ref: "#/components/schemas/Learner" } }, nextCursor: { type: ["string", "null"] } } } } } } },
      },
      post: {
        summary: "Add a learner (scope: write)",
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "firstName", "lastName"],
                properties: { email: { type: "string" }, firstName: { type: "string" }, lastName: { type: "string" }, batchCode: { type: "string" }, licenseMonths: { type: "integer", maximum: 24 } },
              },
            },
          },
        },
        responses: { "201": { description: "Created; an invite email is sent" }, "409": { description: "Email already registered" } },
      },
    },
    "/learners/{id}": {
      get: { summary: "One learner by id or participant ID", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "The learner" }, "404": { description: "Not found" } } },
    },
    "/learners/{id}/deactivate": {
      post: { summary: "Deactivate a learner (scope: write); unstarted license months return to the pool", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Deactivated" } } },
    },
    "/batches": { get: { summary: "List batches", responses: { "200": { description: "Batches" } } } },
    "/certificates": { get: { summary: "Completion certificates", responses: { "200": { description: "Certificates" } } } },
    "/analytics/summary": { get: { summary: "Activity summary for the organization", responses: { "200": { description: "Summary" } } } },
  },
  "x-webhooks": {
    description:
      "Spica POSTs JSON {id, event, createdAt, data} to your URL. Verify X-Spica-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}` with your webhook secret>. Failed deliveries retry with backoff up to 6 times.",
    events: [
      "learner.created",
      "learner.deactivated",
      "learner.reactivated",
      "learner.deleted",
      "learner.moved",
      "license.assigned",
      "license.reclaimed",
      "batch.completed",
      "certificate.issued",
    ],
  },
};
