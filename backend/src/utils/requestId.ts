import { randomUUID } from 'crypto';

/**
 * Generates a random v4 UUID to be used as a request-tracing identifier.
 * Uses Node's built-in crypto module — no third-party dependency required.
 */
export function generateRequestId(): string {
  return randomUUID();
}

/**
 * Returns a shallow copy of `obj` with a `requestId` field appended.
 * Useful for attaching a trace ID to API responses without mutating the
 * original object.
 *
 * @example
 *   return successResponse(addRequestId({ tasks }));
 */
export function addRequestId(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  return { ...obj, requestId: generateRequestId() };
}
