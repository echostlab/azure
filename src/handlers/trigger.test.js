import { describe, expect, it } from '@jest/globals';

import { detectAutoTrigger, detectTrigger } from './trigger.js';

describe('trigger detection', () => {
  const botUsername = 'opencode-pro[bot]';

  it('detects /oc at the start of a comment', () => {
    const result = detectTrigger('/oc review this PR', 'alice', botUsername);

    expect(result.triggered).toBe(true);
    expect(result.type).toBe('slash');
  });

  it('detects /opencode when preceded by whitespace', () => {
    const result = detectTrigger('Please run:\n/opencode check this', 'alice', botUsername);

    expect(result.triggered).toBe(true);
    expect(result.type).toBe('slash');
  });

  it('does not match slash-like fragments in other words or URLs', () => {
    expect(detectTrigger('/octopus test', 'alice', botUsername).triggered).toBe(false);
    expect(detectTrigger('https://example.com/opencode', 'alice', botUsername).triggered).toBe(false);
  });

  it('detects slash command case-insensitively', () => {
    const result = detectTrigger('/OC review this PR', 'alice', botUsername);

    expect(result.triggered).toBe(true);
    expect(result.type).toBe('slash');
  });

  it('detects mentions with and without [bot] suffix', () => {
    const mentionWithoutSuffix = detectTrigger('@opencode-pro please help', 'alice', botUsername);
    const mentionWithSuffix = detectTrigger('@opencode-pro[bot] please help', 'alice', botUsername);

    expect(mentionWithoutSuffix.triggered).toBe(true);
    expect(mentionWithoutSuffix.type).toBe('mention');
    expect(mentionWithSuffix.triggered).toBe(true);
    expect(mentionWithSuffix.type).toBe('mention');
  });

  it('detects mentions case-insensitively', () => {
    const result = detectTrigger('@OpenCode-Pro can you check this?', 'alice', botUsername);

    expect(result.triggered).toBe(true);
    expect(result.type).toBe('mention');
  });

  it('ignores comments authored by the bot itself', () => {
    const result = detectTrigger('/oc should not self-trigger', botUsername, botUsername);
    expect(result.triggered).toBe(false);
    expect(result.type).toBe(null);
  });

  it('extracts command overrides from slash commands', () => {
    const result = detectTrigger(
      '/oc continue with this agent=coder continue=false model=openai/gpt-4o',
      'alice',
      botUsername,
    );

    expect(result.triggered).toBe(true);
    expect(result.params).toMatchObject({
      agent: 'coder',
      continue: false,
      model: 'openai/gpt-4o',
    });
  });

  it('returns a consistent non-trigger payload when no trigger is present', () => {
    const result = detectTrigger('Just discussing ideas here', 'alice', botUsername);

    expect(result).toEqual({
      triggered: false,
      type: null,
      params: {},
    });
  });
});

describe('auto trigger detection', () => {
  it('triggers when assignee matches bot username', () => {
    const result = detectAutoTrigger('opencode-pro[bot]', 'opencode-pro[bot]');
    expect(result.triggered).toBe(true);
    expect(result.type).toBe('auto');
  });

  it('does not trigger when bot username is missing', () => {
    const result = detectAutoTrigger('opencode-pro[bot]', '');
    expect(result.triggered).toBe(false);
    expect(result.type).toBe(null);
  });

  it('does not trigger when assignee differs from bot and returns null type', () => {
    const result = detectAutoTrigger('alice', 'opencode-pro[bot]');
    expect(result.triggered).toBe(false);
    expect(result.type).toBe(null);
  });
});
