import { APIGatewayProxyResult } from 'aws-lambda';
import { ZodError } from 'zod';
import { errorResponse } from './response';
import { AuthError } from '../middleware/withAuth';

/**
 * Central error handler for Lambda handlers.
 *
 * Maps known error types to appropriate HTTP status codes.
 * Unknown errors are logged (without sensitive detail) and returned as 500.
 *
 * SECURITY: Never expose raw error messages, stack traces, or internal
 * identifiers to the caller. Log internally; return a safe message.
 */
export function handleError(err: unknown): APIGatewayProxyResult {
  if (err instanceof AuthError) {
    return errorResponse(403, err.message);
  }

  if (err instanceof ZodError) {
    // Return field-level validation errors — these contain no sensitive data.
    const issues = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
    return errorResponse(400, `Validation error: ${issues}`);
  }

  if (err instanceof NotFoundError) {
    return errorResponse(404, err.message);
  }

  if (err instanceof ConflictError) {
    return errorResponse(409, err.message);
  }

  if (err instanceof BadRequestError) {
    return errorResponse(400, err.message);
  }

  // Log unexpected errors without exposing internals to the caller.
  console.error('[handleError] Unexpected error:', err instanceof Error ? err.message : String(err));
  return errorResponse(500, 'An internal error occurred');
}

/** Thrown when a requested resource does not exist or is not accessible to the caller. */
export class NotFoundError extends Error {
  constructor(message = 'Resource not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** Thrown when a state transition or uniqueness constraint is violated. */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Thrown when the caller supplies an invalid combination of parameters. */
export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestError';
  }
}
