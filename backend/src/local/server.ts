/**
 * local/server.ts — Express server for local development.
 *
 * Routes HTTP requests to the Lambda handler functions directly, emulating
 * API Gateway without running Serverless Offline or SAM.
 *
 * Usage:
 *   cd backend
 *   npm run dev
 *   # Server starts on http://localhost:3000
 *
 * SECURITY: This file is NOT deployed to Lambda. It is only used for local
 * development. Never import production secrets here; read them from .env.
 */

import 'dotenv/config';
import express, { Request, Response } from 'express';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

// Handlers
import * as health from '../handlers/health';
import * as auth from '../handlers/auth';
import * as summaries from '../handlers/summaries';
import * as tasks from '../handlers/tasks';
import * as followups from '../handlers/followups';
import * as approvals from '../handlers/approvals';
import * as agent from '../handlers/agent';
import * as auditHandler from '../handlers/audit';

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Lambda → Express adapter
// ---------------------------------------------------------------------------

/**
 * Converts an Express request into an APIGatewayProxyEvent stub, calls the
 * Lambda handler, then writes the result back to the Express response.
 */
function adapt(
  handler: (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>,
) {
  return async (req: Request, res: Response): Promise<void> => {
    const event: APIGatewayProxyEvent = {
      httpMethod: req.method,
      path: req.path,
      pathParameters: req.params as Record<string, string> | null,
      queryStringParameters: req.query as Record<string, string> | null,
      multiValueQueryStringParameters: null,
      headers: req.headers as Record<string, string>,
      multiValueHeaders: {},
      body: req.body ? JSON.stringify(req.body) : null,
      isBase64Encoded: false,
      requestContext: {
        requestId: `local-${Date.now()}`,
      } as any,
      resource: req.path,
      stageVariables: null,
    };

    try {
      const result = await handler(event);
      res.status(result.statusCode);
      Object.entries(result.headers ?? {}).forEach(([k, v]) => res.setHeader(k, String(v)));
      res.send(result.body);
    } catch (err) {
      console.error('Handler error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health / Auth
app.get('/health', adapt(health.check));
app.get('/me', adapt(auth.me));

// Summaries
app.get('/summaries', adapt(summaries.list));
app.post('/summaries', adapt(summaries.create));
app.get('/summaries/:id', adapt(summaries.get));
app.patch('/summaries/:id', adapt(summaries.update));
app.post('/summaries/:id/task-candidates', adapt(summaries.taskCandidates));
app.post('/summaries/:id/accept-tasks', adapt(summaries.acceptTasks));
app.post('/summaries/:id/archive', adapt(summaries.archive));

// Tasks
app.get('/tasks', adapt(tasks.list));
app.post('/tasks', adapt(tasks.create));
app.get('/tasks/:id', adapt(tasks.get));
app.patch('/tasks/:id', adapt(tasks.update));
app.post('/tasks/:id/mark-reviewed', adapt(tasks.markReviewed));
app.post('/tasks/:id/mark-action-needed', adapt(tasks.markActionNeeded));
app.post('/tasks/:id/mark-waiting', adapt(tasks.markWaiting));
app.post('/tasks/:id/mark-done', adapt(tasks.markDone));
app.post('/tasks/:id/archive', adapt(tasks.archive));

// Follow-ups
app.get('/followups', adapt(followups.list));
app.post('/followups', adapt(followups.create));
app.get('/followups/:id', adapt(followups.get));
app.patch('/followups/:id', adapt(followups.update));
app.post('/followups/:id/mark-reviewed', adapt(followups.markReviewed));
app.post('/followups/:id/approve', adapt(followups.approve));
app.post('/followups/:id/archive', adapt(followups.archive));

// Approvals
app.get('/approval-requests', adapt(approvals.list));
app.post('/approval-requests', adapt(approvals.create));
app.post('/approval-requests/:id/approve', adapt(approvals.approve));
app.post('/approval-requests/:id/reject', adapt(approvals.reject));
app.post('/approval-requests/:id/mark-executed', adapt(approvals.markExecuted));

// Agent
app.post('/agent/run-results', adapt(agent.submitRunResults));
app.get('/agent/pending-review', adapt(agent.pendingReview));
app.get('/agent/changes', adapt(agent.changes));
app.post('/agent/followup-drafts', adapt(agent.createFollowupDrafts));
app.post('/agent/approval-requests', adapt(agent.createApprovalRequests));

// Audit
app.get('/audit-events', adapt(auditHandler.list));

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT ?? '3000', 10);
app.listen(PORT, () => {
  console.log(`TaskFlow local server running on http://localhost:${PORT}`);
  console.log(`MongoDB URI: ${process.env.MONGODB_URI ? '[set]' : '[NOT SET — check .env]'}`);
});
