/**
 * Azure Functions v4 HTTP trigger adapter for OpenCode Pro.
 *
 * Wraps the Probot application with `@probot/adapter-azure-functions`
 * for deployment to Azure Functions.  Handles webhook secret verification
 * before passing the request through to Probot.
 *
 * Probot is instantiated once at module scope to avoid per-request
 * overhead.  The handler reuses the same Probot instance for every request.
 *
 * @module azure-function
 */

import { createProbot } from 'probot';
import { createAzureFunctionsV4Handler } from '@probot/adapter-azure-functions';
import { app } from '@azure/functions';
import { config } from 'dotenv';

// Load environment variables
config();

import opencodeProAppFn from './index.js';
import { info } from './utils/logger.js';

/**
 * Validate that required environment variables are set before the
 * function starts accepting requests.
 *
 * @throws {Error} If required variables are missing
 */
function validateEnvironment() {
  const required = ['APP_ID', 'WEBHOOK_SECRET'];

  const missing = required.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
  }

  if (!process.env.PRIVATE_KEY) {
    throw new Error('Missing required environment variable: PRIVATE_KEY');
  }

  info('Azure Functions environment validated');
}

// Validate at load time so the function fails fast on deploy
validateEnvironment();

// ── Module-scoped Probot (created once, reused for all requests) ──

const probot = await createProbot({
  overrides: {
    logLevel: process.env.LOG_LEVEL || 'info',
  },
});

probot.load(opencodeProAppFn);

const azureHandler = createAzureFunctionsV4Handler(probot, {
  onUnhandledRequest: () => ({
    status: 404,
    body: JSON.stringify({ error: 'Not Found' }),
    headers: { 'content-type': 'application/json' },
  }),
});

info('OpenCode Pro Azure Functions handler initialized');

/**
 * Azure Functions HTTP trigger handler — delegates to the module-scoped
 * Probot instance.
 *
 * @param {import('@azure/functions').HttpRequest} request
 * @param {import('@azure/functions').InvocationContext} context
 * @returns {Promise<import('@azure/functions').HttpResponseInit>}
 */
async function handler(request, context) {
  return azureHandler(request, context);
}

// Register the Azure Function HTTP trigger
app.http('opencode-pro-webhook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'api/webhook',
  handler,
});