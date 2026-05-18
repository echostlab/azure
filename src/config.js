/**
 * Configuration loader for OpenCode Pro.
 *
 * Reads `.opencode-pro.json` or `.opencode.jsonc` from the repository root,
 * parses JSONC (comments, trailing commas allowed), resolves environment-
 * variable references (`{env:VAR_NAME}`), and returns a typed config object.
 *
 * Falls back gracefully to environment-variable defaults when no repo config
 * is present.
 *
 * @module config
 */

import { parse as parseJsonc } from 'jsonc-parser';
import { debug, warn } from './utils/logger.js';
import { readRepoFile } from './utils/github.js';

/** @type {readonly string[]} */
const CONFIG_PATHS = ['.opencode-pro.json', '.opencode.jsonc'];

/**
 * @typedef {object} AgentConfig
 * @property {string} model
 * @property {string} [provider]
 * @property {string} [description]
 * @property {string} [systemPrompt]
 * @property {number} [maxTokens]
 */

/**
 * @typedef {object} LoadedConfig
 * @property {string} model - Primary model (provider/model-name format)
 * @property {string} provider - Extracted provider name
 * @property {string} modelName - Extracted model name
 * @property {string|null} apiKey - API key for the provider
 * @property {string|null} baseURL - Custom API base URL
 * @property {string} smallModel - Lightweight model for quick tasks
 * @property {string} smallProvider - Small model provider
 * @property {string} smallModelName - Small model name
 * @property {string|null} smallApiKey
 * @property {Record<string, AgentConfig>} agents
 * @property {object} permissions
 * @property {boolean} autoReview - Auto-review PRs on open
 * @property {boolean} autoAssign - Auto-respond when assigned
 * @property {number} maxContextTokens
 * @property {string[]} ignorePatterns
 */

/**
 * Resolve `{env:VAR_NAME}` references within a value.
 *
 * @param {unknown} value - Any JSON value potentially containing env refs
 * @returns {unknown} The resolved value
 * @throws {Error} If a referenced env var is not set
 */
function resolveEnvRefs(value) {
  if (typeof value !== 'string') return value;

  return value.replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, varName) => {
    const resolved = process.env[varName];
    if (resolved === undefined) {
      throw new Error(
        `Config references environment variable "${varName}" which is not set.`,
      );
    }
    return resolved;
  });
}

/**
 * Walk an object tree and resolve all env refs in string leaves.
 *
 * @param {unknown} obj
 * @returns {unknown}
 */
function resolveAllEnvRefs(obj) {
  if (typeof obj === 'string') return resolveEnvRefs(obj);
  if (Array.isArray(obj)) return obj.map(resolveAllEnvRefs);
  if (obj !== null && typeof obj === 'object') {
    /** @type {Record<string, unknown>} */
    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveAllEnvRefs(value);
    }
    return resolved;
  }
  return obj;
}

/**
 * Parse a model string of the form `"provider/model-name"` into parts.
 *
 * @param {string} modelString
 * @returns {{ provider: string, modelName: string }}
 * @throws {Error} If the format is invalid
 */
export function parseModelString(modelString) {
  if (typeof modelString !== 'string' || modelString.length === 0) {
    throw new Error(`Invalid model string: "${String(modelString)}"`);
  }

  const slashIndex = modelString.indexOf('/');
  if (slashIndex === -1) {
    throw new Error(
      `Model string "${modelString}" must use "provider/model-name" format.`,
    );
  }

  return {
    provider: modelString.slice(0, slashIndex).toLowerCase(),
    modelName: modelString.slice(slashIndex + 1),
  };
}

/**
 * Derive the API key for a provider from resolved config or environment.
 *
 * @param {string} provider - Lowercase provider name
 * @param {Record<string, unknown>} rawConfig - Resolved raw config
 * @returns {string|null}
 */
function deriveApiKey(provider, rawConfig) {
  if (typeof rawConfig.apiKey === 'string') return rawConfig.apiKey;

  const keyMap = {
    openai: 'OPENAI_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    azure: 'AZURE_OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  const envVar = keyMap[provider];
  if (!envVar) return null;

  return process.env[envVar] ?? null;
}

/**
 * Derive the base URL for a provider.
 *
 * @param {string} provider - Lowercase provider name
 * @param {Record<string, unknown>} rawConfig - Resolved raw config
 * @returns {string|null}
 */
function deriveBaseURL(provider, rawConfig) {
  if (typeof rawConfig.baseURL === 'string') return rawConfig.baseURL;

  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1';

  return null;
}

/**
 * Build a complete LoadedConfig from a resolved raw config object.
 *
 * @param {Record<string, unknown>} rawConfig - Already env-ref-resolved
 * @returns {LoadedConfig}
 */
function buildConfig(rawConfig) {
  const modelString =
    typeof rawConfig.model === 'string'
      ? rawConfig.model
      : process.env.PRIMARY_MODEL || 'openai/gpt-4o';

  const { provider, modelName } = parseModelString(modelString);

  const smallModelString =
    typeof rawConfig.small_model === 'string'
      ? rawConfig.small_model
      : process.env.SMALL_MODEL || modelString;

  const small = parseModelString(smallModelString);

  /** @type {Record<string, AgentConfig>} */
  const agents = {};
  if (rawConfig.agents && typeof rawConfig.agents === 'object') {
    for (const [name, agent] of Object.entries(rawConfig.agents)) {
      if (agent && typeof agent === 'object') {
        agents[name] = {
          model: typeof agent.model === 'string' ? agent.model : modelString,
          provider: typeof agent.provider === 'string' ? agent.provider : provider,
          description: typeof agent.description === 'string' ? agent.description : undefined,
          systemPrompt: typeof agent.systemPrompt === 'string' ? agent.systemPrompt : undefined,
          maxTokens: typeof agent.maxTokens === 'number' ? agent.maxTokens : undefined,
        };
      }
    }
  }

  return {
    model: modelString,
    provider,
    modelName,
    apiKey: deriveApiKey(provider, rawConfig),
    baseURL: deriveBaseURL(provider, rawConfig),
    smallModel: smallModelString,
    smallProvider: small.provider,
    smallModelName: small.modelName,
    smallApiKey: deriveApiKey(small.provider, rawConfig),
    agents,
    permissions: typeof rawConfig.permissions === 'object' && rawConfig.permissions !== null
      ? /** @type {object} */ (rawConfig.permissions)
      : {},
    autoReview: typeof rawConfig.autoReview === 'boolean' ? rawConfig.autoReview : false,
    autoAssign: typeof rawConfig.autoAssign === 'boolean' ? rawConfig.autoAssign : true,
    maxContextTokens:
      typeof rawConfig.maxContextTokens === 'number'
        ? rawConfig.maxContextTokens
        : Number(process.env.MAX_CONTEXT_TOKENS) || 128000,
    ignorePatterns: Array.isArray(rawConfig.ignorePatterns)
      ? rawConfig.ignorePatterns.filter(
        /** @returns {p is string} */ (p) => typeof p === 'string',
      )
      : [],
  };
}

/**
 * Load the configuration for a repository from a Probot context.
 *
 * Reads `.opencode-pro.json` or `.opencode.jsonc` from the repo root,
 * parses it as JSONC, resolves env-refs, and returns a typed object.
 *
 * Falls back to defaults derived from environment variables when no
 * config file is found or when the file cannot be parsed.
 *
 * @param {import('probot').Context} context - Probot event context
 * @returns {Promise<LoadedConfig>}
 */
export async function loadConfig(context) {
  let rawText = null;

  for (const configPath of CONFIG_PATHS) {
    rawText = await readRepoFile(context, configPath);
    if (rawText !== null) {
      debug(`Found config file: ${configPath}`);
      break;
    }
  }

  if (rawText === null) {
    warn('No config file found in repo — using environment defaults');
    return buildConfig({});
  }

  let parsed;
  try {
    parsed = parseJsonc(rawText);
  } catch (err) {
    warn(`Failed to parse config file as JSONC, using env defaults — ${err.message}`);
    return buildConfig({});
  }

  if (parsed === null || typeof parsed !== 'object') {
    warn('Config file parsed to non-object, using env defaults');
    return buildConfig({});
  }

  let resolved;
  try {
    resolved = resolveAllEnvRefs(parsed);
  } catch (err) {
    throw new Error(`Failed to resolve env references in config: ${err.message}`);
  }

  if (resolved === null || typeof resolved !== 'object') {
    throw new Error('Resolved config is not an object');
  }

  return buildConfig(/** @type {Record<string, unknown>} */ (resolved));
}