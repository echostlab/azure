/**
 * LLM provider abstraction layer.
 *
 * Creates AI SDK provider instances for OpenAI, Anthropic, Azure OpenAI,
 * OpenRouter, and any OpenAI-compatible endpoint.  Parses the canonical
 * `"provider/model-name"` string format and returns a configured AI SDK
 * client ready for streaming generation.
 *
 * @module providers/llm
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { generateText, streamText } from 'ai';
import { error } from '../utils/logger.js';

/**
 * @typedef {import('../config.js').LoadedConfig} LoadedConfig
 */

/**
 * Map a provider name to a creator function.  Returns `null` when the
 * provider name is unknown (the caller handles the fallback).
 *
 * @param {string} provider - Lowercase provider name
 * @param {LoadedConfig} config - Full loaded config
 * @returns {import('ai').LanguageModelV2 | null}
 */
function createProviderInstance(provider, config) {
  const apiKey = config.apiKey;
  const baseURL = config.baseURL;

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey: apiKey ?? undefined, baseURL: baseURL ?? undefined })(config.modelName);

    case 'anthropic':
      return createAnthropic({ apiKey: apiKey ?? undefined, baseURL: baseURL ?? undefined })(config.modelName);

    case 'azure':
      return createAzure({
        apiKey: apiKey ?? undefined,
        baseURL: baseURL ?? undefined,
      })(config.modelName);

    case 'openrouter':
      return createOpenAI({
        apiKey: apiKey ?? undefined,
        baseURL: baseURL ?? 'https://openrouter.ai/api/v1',
      })(config.modelName);

    case 'openai-compatible':
    default:
      // Any OpenAI-compatible endpoint
      return createOpenAI({
        apiKey: apiKey ?? undefined,
        baseURL: baseURL ?? undefined,
      })(config.modelName);
  }
}

/**
 * Create a language model from a config object.
 *
 * Supports: `openai`, `anthropic`, `azure`, `openrouter`, and any
 * OpenAI-compatible provider via `openai-compatible` or an unknown
 * provider name (which is treated as OpenAI-compatible).
 *
 * @param {LoadedConfig} config - Resolved configuration
 * @returns {import('ai').LanguageModelV2}
 * @throws {Error} If the provider requires an API key but none is found
 */
export function createModel(config) {
  const provider = config.provider;

  if (!config.apiKey) {
    throw new Error(
      `Provider "${provider}" requires an API key, but none was found in config or environment.`,
    );
  }

  // For 'openai-compatible' and unknown providers, treat as OpenAI-compatible
  if (provider === 'openai-compatible' || !['openai', 'anthropic', 'azure', 'openrouter'].includes(provider)) {
    return createProviderInstance('openai-compatible', config);
  }

  return createProviderInstance(provider, config);
}

/**
 * Generate a non-streaming text completion.
 *
 * @param {object} opts
 * @param {string} opts.prompt - User prompt
 * @param {string} [opts.system] - System prompt
 * @param {Array<{filename: string, content: string}>} [opts.files] - Repository files to include as context
 * @param {LoadedConfig} opts.config - Loaded configuration
 * @returns {Promise<string>} The generated text
 */
export async function generateResponse({ prompt, system, files, config }) {
  if (!prompt) {
    throw new Error('generateResponse: prompt is required');
  }

  const model = createModel(config);

  const messages = buildMessages(prompt, system, files);

  try {
    const result = await generateText({ model, messages });
    return result.text;
  } catch (err) {
    error('LLM generation failed', err);
    return 'I encountered an internal error while processing this request. Please try again later.';
  }
}

/**
 * Generate a streaming text completion.
 *
 * Returns an async iterable of text deltas suitable for streaming
 * responses to a GitHub comment or check run.
 *
 * @param {object} opts
 * @param {string} opts.prompt - User prompt
 * @param {string} [opts.system] - System prompt
 * @param {Array<{filename: string, content: string}>} [opts.files] - Repository files as context
 * @param {LoadedConfig} opts.config - Loaded configuration
 * @returns {Promise<AsyncIterable<string>>}
 */
export async function generateStream({ prompt, system, files, config }) {
  if (!prompt) {
    throw new Error('generateStream: prompt is required');
  }

  const model = createModel(config);
  const messages = buildMessages(prompt, system, files);

  try {
    const { textStream } = streamText({ model, messages });
    return textStream;
  } catch (err) {
    error('LLM streaming failed', err);
    const fallbackMessage = 'I encountered an internal error while processing this request. Please try again later.';
    return {
      async *[Symbol.asyncIterator]() {
        yield fallbackMessage;
      },
    };
  }
}

/**
 * Build the message array for the LLM call.
 *
 * @param {string} prompt
 * @param {string} [system]
 * @param {Array<{filename: string, content: string}>} [files]
 * @returns {Array<{role: string, content: string}>}
 */
function buildMessages(prompt, system, files) {
  /** @type {Array<{role: string, content: string}>} */
  const messages = [];

  if (system) {
    messages.push({ role: 'system', content: system });
  }

  let content = prompt;

  // Append file context if provided
  if (files && files.length > 0) {
    const fileContext = files
      .map(({ filename, content: fileContent }) =>
        `\n--- FILE: ${filename} ---\n${fileContent}`
      )
      .join('\n');
    content = `${prompt}\n\nContext files:\n${fileContext}`;
  }

  messages.push({ role: 'user', content });
  return messages;
}
