import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getDb } from '../db/connection';
import { successResponse, errorResponse } from '../utils/response';

/**
 * GET /health
 *
 * Returns the operational status of the API and its upstream dependencies.
 * No authentication required — safe to call from load-balancer health checks.
 *
 * SECURITY: Does not expose any sensitive system internals. The MongoDB ping
 * returns a boolean rather than raw server info.
 */
export async function handler(
  _event: APIGatewayProxyEvent,
): Promise<APIGatewayProxyResult> {
  let dbConnected = false;

  try {
    const db = await getDb();
    // A lightweight command that confirms connectivity without reading data.
    await db.command({ ping: 1 });
    dbConnected = true;
  } catch (err) {
    console.error('[health] DB ping failed:', err instanceof Error ? err.message : String(err));
  }

  if (!dbConnected) {
    return errorResponse(503, 'Service unavailable', { db: 'unreachable' });
  }

  return successResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV ?? 'unknown',
    db: 'connected',
  });
}
