import { APIGatewayProxyResult } from 'aws-lambda';

/**
 * CORS headers applied to every response.
 *
 * In production the Access-Control-Allow-Origin value should be locked to the
 * exact app origin. The '*' wildcard here is acceptable only because the app
 * is a private CTO tool gated by JWT auth — unauthenticated requests cannot
 * access any data regardless of origin.
 *
 * If a stricter origin policy is needed, replace '*' with
 * `process.env.ALLOWED_ORIGINS` and validate it against an allowlist.
 */
const CORS_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

/**
 * Returns a successful Lambda proxy response.
 *
 * @param data       The response payload — must be JSON-serialisable.
 * @param statusCode HTTP status code (default 200).
 */
export function successResponse(
  data: unknown,
  statusCode = 200,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(data),
  };
}

/**
 * Returns an error Lambda proxy response.
 *
 * SECURITY: `details` is included as-is in the response body. Never pass raw
 * Error objects, stack traces, or internal system details to this parameter —
 * only safe, user-facing field-error maps (e.g. from Zod's flatten()).
 *
 * @param statusCode HTTP status code.
 * @param message    Short human-readable error description.
 * @param details    Optional structured details (e.g. Zod field errors).
 */
export function errorResponse(
  statusCode: number,
  message: string,
  details?: unknown,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      error: message,
      ...(details !== undefined ? { details } : {}),
    }),
  };
}

/**
 * Parses the Lambda event body as JSON and casts it to T.
 *
 * Throws a plain Error (caught by handleError → 400) when the body is absent
 * or not valid JSON. Schema validation (Zod) should be performed by the caller
 * after this parse step.
 */
export function parseBody<T>(event: { body: string | null }): T {
  if (!event.body) {
    throw new Error('Missing request body');
  }
  try {
    return JSON.parse(event.body) as T;
  } catch {
    throw new Error('Request body is not valid JSON');
  }
}

/**
 * Extracts a required path parameter from the Lambda event.
 *
 * Throws a plain Error (caught by handleError → 400 / 500) when the parameter
 * is absent — which should not happen if serverless.yml routes are correct.
 */
export function getPathParam(
  event: { pathParameters: Record<string, string | undefined> | null },
  key: string,
): string {
  const val = event.pathParameters?.[key];
  if (!val) {
    throw new Error(`Missing path parameter: ${key}`);
  }
  return val;
}

/**
 * Extracts an optional query-string parameter, returning undefined when absent.
 */
export function getQueryParam(
  event: { queryStringParameters: Record<string, string | undefined> | null | undefined },
  key: string,
): string | undefined {
  return event.queryStringParameters?.[key] ?? undefined;
}
