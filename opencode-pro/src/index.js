/**
 * OpenCode Pro — Main Probot Application Entry Point
 *
 * Registers all GitHub webhook event handlers and boots the Probot server.
 * The app reads per-repository configuration from `.opencode-pro.json` or
 * `.opencode.jsonc` and uses AI SDK providers to power code reviews,
 * issue triage, and conversational responses.
 *
 * @module index
 */

import { Probot } from 'probot';
import { config } from 'dotenv';

// Load .env at startup — safe to call multiple times
config();

import { debug, error, info } from './utils/logger.js';
import {
  handleIssueOpened,
  handleIssueAssigned,
  handleIssueComment,
} from './handlers/issues.js';
import {
  handlePullRequestOpened,
  handlePullRequestSynchronize,
  handleReviewComment,
  handlePullRequestAssigned,
} from './handlers/pull_requests.js';

/**
 * Create and configure the OpenCode Pro Probot application.
 *
 * @param {object} app - The Probot Application instance
 * @param {object} opts - Options including getRouter for serverless adapters
 */
export default function opencodeProApp(app, opts = {}) {
  info('OpenCode Pro bot starting...');

  // ── Issue events ─────────────────────────────────────────

  app.on('issues.opened', async (context) => {
    debug(`issues.opened: #${context.payload.issue.number}`);
    await handleIssueOpened(context);
  });

  app.on('issues.assigned', async (context) => {
    debug(`issues.assigned: #${context.payload.issue.number}`);
    await handleIssueAssigned(context);
  });

  app.on('issue_comment.created', async (context) => {
    debug(`issue_comment.created: #${context.payload.issue.number}`);
    await handleIssueComment(context);
  });

  // ── Pull Request events ──────────────────────────────────

  app.on('pull_request.opened', async (context) => {
    debug(`pull_request.opened: #${context.payload.pull_request.number}`);
    await handlePullRequestOpened(context);
  });

  app.on('pull_request.synchronize', async (context) => {
    debug(`pull_request.synchronize: #${context.payload.pull_request.number}`);
    await handlePullRequestSynchronize(context);
  });

  app.on('pull_request_review_comment.created', async (context) => {
    debug(`pull_request_review_comment.created: #${context.payload.pull_request.number}`);
    await handleReviewComment(context);
  });

  app.on('pull_request.assigned', async (context) => {
    debug(`pull_request.assigned: #${context.payload.pull_request.number}`);
    await handlePullRequestAssigned(context);
  });

  // ── Error handling ───────────────────────────────────────

  app.on('error', (err) => {
    error(`Unhandled error: ${err.message}`);
  });

  info('OpenCode Pro handlers registered.');
}

// ── Direct server start (for local dev) ─────────────────────
//
// When executed directly (not imported by a serverless adapter),
// start a standalone HTTP server on the PORT env var or 3000.

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/index.js')) {
  const port = Number(process.env.PORT) || 3000;

  Probot.run({
    defaultApp: (app) => opencodeProApp(app),
    port,
  });

  info(`OpenCode Pro listening on http://localhost:${port}`);
}