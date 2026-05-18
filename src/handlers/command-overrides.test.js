import { describe, expect, it } from '@jest/globals';

import {
  applyCommandOverrides,
  CommandOverrideError,
  parseCommandOverrides,
  stripCommandOverrides,
} from './command-overrides.js';

/**
 * @param {string} key
 * @param {string | undefined} value
 */
function setEnvKey(key, value) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}

/**
 * @template T
 * @param {string} key
 * @param {string | undefined} value
 * @param {() => T} run
 * @returns {T}
 */
function withTemporaryEnv(key, value, run) {
  const previous = process.env[key];
  setEnvKey(key, value);

  try {
    return run();
  } finally {
    setEnvKey(key, previous);
  }
}

/**
 * @returns {import('../config.js').LoadedConfig}
 */
function createBaseConfig() {
  return {
    model: 'openai/gpt-4o',
    provider: 'openai',
    modelName: 'gpt-4o',
    apiKey: 'test-key',
    baseURL: null,
    smallModel: 'openai/gpt-4o-mini',
    smallProvider: 'openai',
    smallModelName: 'gpt-4o-mini',
    smallApiKey: 'test-key',
    agents: {
      coder: {
        model: 'anthropic/claude-sonnet-4-20250514',
        systemPrompt: 'You are the coding agent.',
      },
    },
    permissions: {},
    autoReview: false,
    autoAssign: true,
    maxContextTokens: 128000,
    ignorePatterns: [],
  };
}

describe('command overrides', () => {
  it('parses model/provider/agent/continue tokens', () => {
    const overrides = parseCommandOverrides(
      '/oc review this model="anthropic/claude-sonnet-4-20250514" provider=openrouter agent=coder continue=false',
    );

    expect(overrides).toEqual({
      model: 'anthropic/claude-sonnet-4-20250514',
      provider: 'openrouter',
      agent: 'coder',
      continue: false,
    });
  });

  it('applies configured agent model and prompt', () => {
    withTemporaryEnv('ANTHROPIC_API_KEY', 'anthropic-test-key', () => {
      const baseConfig = createBaseConfig();
      const applied = applyCommandOverrides(baseConfig, { agent: 'coder' });

      expect(applied.selectedAgent).toEqual({
        name: 'coder',
        systemPrompt: 'You are the coding agent.',
      });

      expect(applied.config.model).toBe('anthropic/claude-sonnet-4-20250514');
      expect(applied.config.provider).toBe('anthropic');
      expect(applied.config.modelName).toBe('claude-sonnet-4-20250514');
      expect(applied.config.apiKey).toBe('anthropic-test-key');
      expect(applied.continueConversation).toBe(true);
    });
  });

  it('keeps default config when agent does not exist', () => {
    const baseConfig = createBaseConfig();
    const applied = applyCommandOverrides(baseConfig, { agent: 'missing-agent' });

    expect(applied.selectedAgent).toBeNull();
    expect(applied.config.model).toBe(baseConfig.model);
    expect(applied.config.provider).toBe(baseConfig.provider);
  });

  it('lets explicit model override win over selected agent', () => {
    withTemporaryEnv('ANTHROPIC_API_KEY', 'anthropic-test-key', () => {
      withTemporaryEnv('OPENAI_API_KEY', 'openai-test-key', () => {
        const baseConfig = createBaseConfig();
        const applied = applyCommandOverrides(baseConfig, {
          agent: 'coder',
          model: 'openai/gpt-4.1',
          continue: false,
        });

        expect(applied.config.model).toBe('openai/gpt-4.1');
        expect(applied.config.provider).toBe('openai');
        expect(applied.config.modelName).toBe('gpt-4.1');
        expect(applied.config.apiKey).toBe('openai-test-key');
        expect(applied.continueConversation).toBe(false);
      });
    });
  });

  it('strips override tokens from prompt text', () => {
    const cleaned = stripCommandOverrides(
      'please review this provider=azure model=azure/gpt-4o continue=true agent=coder',
    );

    expect(cleaned).toBe('please review this');
  });

  it('fails explicitly when switching provider without destination API key', () => {
    withTemporaryEnv('ANTHROPIC_API_KEY', undefined, () => {
      const baseConfig = createBaseConfig();

      expect(() => {
        applyCommandOverrides(baseConfig, { provider: 'anthropic' });
      }).toThrow(CommandOverrideError);
    });
  });
});
