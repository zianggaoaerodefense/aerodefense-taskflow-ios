/**
 * eventHelper.ts — Factories for APIGatewayProxyEvent objects used in handler tests.
 */

import { APIGatewayProxyEvent } from 'aws-lambda';

export function makeEvent(overrides?: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: 'GET',
    path: '/',
    pathParameters: null,
    queryStringParameters: null,
    headers: {},
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    body: null,
    isBase64Encoded: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    requestContext: {} as any,
    resource: '',
    stageVariables: null,
    ...overrides,
  };
}

/** Wraps makeEvent and injects a Bearer token into the Authorization header. */
export function makeAuthEvent(
  token: string,
  overrides?: Partial<APIGatewayProxyEvent>,
): APIGatewayProxyEvent {
  return makeEvent({
    headers: { Authorization: `Bearer ${token}` },
    ...overrides,
  });
}
