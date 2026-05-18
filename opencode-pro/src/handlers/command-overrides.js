/**
 * Command override parsing and application.
 *
 * Supports single-run overrides supplied inline in comments:
 *   - `model=provider/model-name`
 *   - `provider=openai|anthropic|azure|openrouter|openai-compatible`
 *   - `agent=<agent-name>`
 *   - `continue=true|false`
 *
 * @module handlers/command-overrides
 */

import { parseModelString } from '../config.js';
import { debug, warn } from '../utils/logger.js';

/** @type {number} */
const MAX_OVERRIDE_LENGTH = 256;

/**
 * CLI-style override token matcher.
 *
 * @type {RegExp}
 */
const OVERRIDE_TOKEN_REGEX = /\b(model|provider|agent|continue)=("[^"]*"|'[^']*'|\S+)/gi;

/**
 * Whitelist of accepted provider override values.
 *
 * @type {Set<string>}
 */
export const ALLOWED_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'azure',
  'openrouter',
  'openai-compatible',
]);

/**
 * Provider-to-environment mapping for provider-specific API keys.
 *
 * @type {Record<string, string>}
 */
const PROVIDER_API_KEY_ENV = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  azure: 'AZURE_OPENAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
};

/**
 * Error thrown when command overrides result in unsafe or invalid state.
 */
export class CommandOverrideError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'CommandOverrideError';
  }
}

/**
 * @typedef {object} CommandOverrides
 * @property {string} [model]
 * @property {string} [provider]
 * @property {string} [agent]
 * @property {boolean} [continue]
 */

/**
 * @typedef {object} SelectedAgent
 * @property {string} name
 * @property {string} [systemPrompt]
 */

/**
 * @typedef {object} AppliedOverrides
 * @property {import('../config.js').LoadedConfig} config
 * @property {SelectedAgent|null} selectedAgent
 * @property {boolean} continueConversation
 */

/**
 * Parse a `continue=<value>` override into a boolean.
 *
 * @param {string} value
 * @returns {boolean | undefined}
 */
function parseContinueFlag(value) {
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Remove wrapping single or double quotes from a token value.
 *
 * @param {string} value
 * @returns {string}
 */
function unquote(value) {
  if (!value) return value;

  if (
    (value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

/**
 * Parse command overrides from a comment body.
 *
 * @param {string} body
 * @returns {CommandOverrides}
 */
export function parseCommandOverrides(body) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    return {};
  }

  /** @type {CommandOverrides} */
  const overrides = {};

  for (const match of body.matchAll(OVERRIDE_TOKEN_REGEX)) {
    const key = match[1].toLowerCase();
    const value = unquote(match[2]).trim();

    if (value.length === 0 || value.length > MAX_OVERRIDE_LENGTH) {
      continue;
    }

    if (key === 'continue') {
      const parsedContinue = parseContinueFlag(value);
      if (parsedContinue !== undefined) {
        overrides.continue = parsedContinue;
      }
      continue;
    }

    overrides[key] = value;
  }

  return overrides;
}

/**
 * Remove override tokens from user-facing prompt text.
 *
 * @param {string} body
 * @returns {string}
 */
export function stripCommandOverrides(body) {
  if (typeof body !== 'string' || body.length === 0) {
    return '';
  }

  return body.replace(OVERRIDE_TOKEN_REGEX, '').trim();
}

/**
 * Resolve provider-specific API key and its env name.
 *
 * @param {string} provider
 * @returns {{ envName: string | null, apiKey: string | null }}
 */
function resolveProviderApiKey(provider) {
  const envName = PROVIDER_API_KEY_ENV[provider] ?? null;
  if (!envName) {
    return { envName: null, apiKey: null };
  }

  return {
    envName,
    apiKey: process.env[envName] ?? null,
  };
}

/**
 * Build a provider-to-key lookup table for safe provider switches.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @returns {Record<string, string>}
 */
function buildProviderApiKeyRing(config) {
  /** @type {Record<string, string>} */
  const keyRing = {};

  if (typeof config.provider === 'string' && typeof config.apiKey === 'string' && config.apiKey) {
    keyRing[config.provider] = config.apiKey;
  }

  for (const provider of Object.keys(PROVIDER_API_KEY_ENV)) {
    const { apiKey } = resolveProviderApiKey(provider);
    if (apiKey) {
      keyRing[provider] = apiKey;
    }
  }

  return keyRing;
}

/**
 * Compute provider default base URL.
 *
 * @param {string} provider
 * @returns {string | null}
 */
function defaultBaseUrl(provider) {
  if (provider === 'openrouter') {
    return 'https://openrouter.ai/api/v1';
  }

  return null;
}

/**
 * Apply a full `provider/model-name` override.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @param {string} modelString
 * @param {Record<string, string>} providerApiKeys
 * @returns {import('../config.js').LoadedConfig}
 */
function applyModelOverride(config, modelString, providerApiKeys) {
  try {
    const parsed = parseModelString(modelString);
    const providerChanged = parsed.provider !== config.provider;

    let apiKey = config.apiKey;
    if (providerChanged) {
      const destinationApiKey = providerApiKeys[parsed.provider] ?? null;

      if (!destinationApiKey) {
        const targetProviderKey = resolveProviderApiKey(parsed.provider);
        const envHint = targetProviderKey.envName ?? '<provider-specific env var>';
        throw new CommandOverrideError(
          `Cannot switch provider to "${parsed.provider}" without ${envHint} configured for this execution.`,
        );
      }

      apiKey = destinationApiKey;
      providerApiKeys[parsed.provider] = destinationApiKey;
    }

    return {
      ...config,
      model: modelString,
      provider: parsed.provider,
      modelName: parsed.modelName,
      apiKey,
      baseURL: providerChanged
        ? (parsed.provider === 'openai-compatible'
          ? config.baseURL
          : defaultBaseUrl(parsed.provider))
        : config.baseURL,
    };
  } catch (err) {
    if (err instanceof CommandOverrideError) {
      throw err;
    }

    warn(`Ignoring invalid model override: "${modelString}"`);
    return config;
  }
}

/**
 * Apply a provider-only override while preserving the model tail.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @param {string} provider
 * @param {Record<string, string>} providerApiKeys
 * @returns {import('../config.js').LoadedConfig}
 */
function applyProviderOverride(config, provider, providerApiKeys) {
  const normalized = provider.toLowerCase();
  if (!ALLOWED_PROVIDERS.has(normalized)) {
    warn(`Ignoring unsupported provider override: "${provider}"`);
    return config;
  }

  const slashIndex = config.model.indexOf('/');
  if (slashIndex === -1 || slashIndex === config.model.length - 1) {
    warn(`Ignoring provider override because current model is invalid: "${config.model}"`);
    return config;
  }

  const modelTail = config.model.slice(slashIndex + 1);
  return applyModelOverride(config, `${normalized}/${modelTail}`, providerApiKeys);
}

/**
 * Resolve an agent configuration from config by case-insensitive name.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @param {string} requestedName
 * @returns {{ name: string, agent: import('../config.js').AgentConfig } | null}
 */
function resolveAgent(config, requestedName) {
  const requested = requestedName.trim().toLowerCase();
  if (!requested || !config.agents) return null;

  for (const [name, agent] of Object.entries(config.agents)) {
    if (name.toLowerCase() === requested) {
      return { name, agent };
    }
  }

  return null;
}

/**
 * Apply parsed command overrides to a loaded configuration.
 *
 * Agent overrides are applied first as defaults, then explicit `model=` and
 * `provider=` overrides are applied on top so direct command values win.
 *
 * @param {import('../config.js').LoadedConfig} config
 * @param {CommandOverrides} [overrides]
 * @returns {AppliedOverrides}
 */
export function applyCommandOverrides(config, overrides = {}) {
  let effectiveConfig = { ...config };
  const providerApiKeys = buildProviderApiKeyRing(config);

  /** @type {SelectedAgent|null} */
  let selectedAgent = null;

  if (overrides.agent) {
    const resolvedAgent = resolveAgent(config, overrides.agent);

    if (resolvedAgent) {
      const { name, agent } = resolvedAgent;
      selectedAgent = {
        name,
        systemPrompt: agent.systemPrompt,
      };

      effectiveConfig = applyModelOverride(effectiveConfig, agent.model, providerApiKeys);

      if (typeof agent.provider === 'string' && agent.provider.length > 0) {
        effectiveConfig = applyProviderOverride(
          effectiveConfig,
          agent.provider,
          providerApiKeys,
        );
      }

      debug(`Applied agent override: ${name}`);
    } else {
      warn(`Requested agent "${overrides.agent}" not found in config; using default config`);
    }
  }

  if (overrides.model) {
    effectiveConfig = applyModelOverride(effectiveConfig, overrides.model, providerApiKeys);
  }

  if (overrides.provider) {
    effectiveConfig = applyProviderOverride(
      effectiveConfig,
      overrides.provider,
      providerApiKeys,
    );
  }

  return {
    config: effectiveConfig,
    selectedAgent,
    continueConversation: overrides.continue !== false,
  };
}
