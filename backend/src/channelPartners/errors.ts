// The error partner code throws: an API error code, HTTP status and extras.
export class PartnerError extends Error {
  constructor(public code: string, public status = 400, public extra: Record<string, unknown> = {}) {
    super(code);
  }
}
