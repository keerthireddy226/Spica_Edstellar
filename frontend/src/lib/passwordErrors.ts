import type { TFunction } from "i18next";
import { ApiError } from "@/lib/api";

// The server's password rules (length set by the organization, letters and
// numbers, not a well-known password), as a sentence; null if not one of them.
export function passwordErrorText(err: unknown, t: TFunction): string | null {
  if (!(err instanceof ApiError)) return null;
  const body = err.body as { minLength?: number } | null;
  if (err.message === "password_too_short") return t("auth.password.tooShort", { min: body?.minLength ?? 8 });
  if (err.message === "password_too_weak") return t("auth.password.tooWeak");
  if (err.message === "password_too_common") return t("auth.password.tooCommon");
  return null;
}
