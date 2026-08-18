import type { IntegrationError } from "./schemas.js";

export type Result<T, E = IntegrationError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err(error: IntegrationError): Result<never> {
  return { ok: false, error };
}
