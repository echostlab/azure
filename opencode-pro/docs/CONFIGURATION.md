# Configuration Reference — OpenCode Pro

OpenCode Pro reads its per-repository configuration from a JSONC file at the repository root. This document covers every available field, environment variable resolution, provider-specific setup, and provides ready-to-use examples.

---

## Config File Location

The bot looks for the first file it can find, in this order:

1. `.opencode-pro.json`
2. `.opencode.jsonc`

Place exactly one of these files at the root of any repository where the GitHub App is installed. Both files support JSONC syntax:

- `//` and `/* */` comments
- Trailing commas in objects and arrays
- Relaxed quoting for keys

If no config file is found, the bot falls back to environment variable defaults (as defined in the deployment environment).

---

## Complete Schema

```jsonc
{
  // ── Core model selection ──────────────────────────────────

  // Primary model in "provider/model-name" format.
  // Required. Falls back to PRIMARY_MODEL env var, then "openai/gpt-4o".
  "model": "openai/gpt-4o",

  // Lightweight model used for quick classification, trigger detection,
  // and other low-cost operations. Falls back to `model` if omitted.
  "small_model": "openai/gpt-4o-mini",

  // ── Provider connection ───────────────────────────────────

  // API key for the provider. Supports {env:VAR_NAME} references.
  // If omitted, the bot derives the key from well-known environment
  // variables based on the provider name (see provider section below).
  "apiKey": "{env:OPENAI_API_KEY}",

  // Custom base URL for the provider API. Used for OpenRouter,
  // Azure OpenAI endpoints, or self-hosted proxies. If omitted,
  // the bot sets OpenRouter's URL automatically; other providers
  // use their default endpoints.
  "baseURL": "https://openrouter.ai/api/v1",

  // ── Behaviour flags ────────────────────────────────────────

  // Whether to auto-review PRs when they are opened or pushed to.
  // When false, reviews only happen via explicit /oc or @mention triggers.
  "autoReview": false,

  // Whether to auto-respond when the bot is assigned to an issue or PR.
  // When true, assigning @opencode-pro immediately produces a response.
  "autoAssign": true,

  // ── Limits ─────────────────────────────────────────────────

  // Maximum number of tokens to send as context for PR reviews.
  // Diffs and file contents are truncated to fit within this budget.
  // Falls back to MAX_CONTEXT_TOKENS env var, then 128000.
  "maxContextTokens": 128000,

  // Glob patterns for files to exclude during PR reviews.
  // Matching files are omitted from the context sent to the LLM.
  // Useful for skipping generated code, lock files, or binary assets.
  "ignorePatterns": [
    "*.lock",
    "*.min.js",
    "dist/**",
    "vendor/**"
  ],

  // ── Permissions ────────────────────────────────────────────

  // Reserved for future use. Currently no-op.
  "permissions": {},

  // ── Agent definitions ──────────────────────────────────────

  // Named agents with custom system prompts and model assignments.
  // Each key becomes an agent name you can reference in commands
  // or future multi-agent orchestration.
  "agents": {
    "planner": {
      "model": "openai/gpt-4o",
      "provider": "openai",
      "description": "Architecture and design planning",
      "systemPrompt": "You are a senior software architect. Think deeply before answering. Prefer diagrams in mermaid format.",
      "maxTokens": 4096
    },
    "coder": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "systemPrompt": "You write production-quality code. Always include tests. Prefer functional patterns.",
      "maxTokens": 8192
    },
    "reviewer": {
      "model": "openai/gpt-4o-mini",
      "description": "Lightweight code review agent",
      "systemPrompt": "You review code for correctness, security, and style. Be terse."
    }
  }
}
```

---

## Field Reference

### `model`

**Type:** `string` | **Required:** Yes | **Default:** `openai/gpt-4o`

The primary language model used for all AI operations. Must follow the `provider/model-name` format:

```
openai/gpt-4o
anthropic/claude-sonnet-4-20250514
azure/gpt-4o
openrouter/anthropic/claude-sonnet-4-20250514
openai-compatible/llama-3-70b
```

The portion before the first `/` is treated as the provider name (case-insensitive). Everything after the first `/` is the model name passed to that provider's API.

### `small_model`

**Type:** `string` | **Required:** No | **Default:** same as `model`

Used for operations where a full model would be overkill: trigger classification, small queries, and fallback when the primary model is unavailable. Follows the same `provider/model-name` format.

```jsonc
"small_model": "openai/gpt-4o-mini"
```

### `apiKey`

**Type:** `string` | **Required:** No | **Default:** auto-derived

The API key used to authenticate with the LLM provider. Use `{env:VAR_NAME}` syntax to reference environment variables without hardcoding secrets:

```jsonc
"apiKey": "{env:OPENAI_API_KEY}"
```

If omitted, the bot auto-derives the key based on the provider name:

| Provider | Auto-derived from |
|----------|-------------------|
| `openai` | `OPENAI_API_KEY` |
| `anthropic` | `ANTHROPIC_API_KEY` |
| `azure` | `AZURE_OPENAI_API_KEY` |
| `openrouter` | `OPENROUTER_API_KEY` |
| `openai-compatible` | none (must be explicit) |

If the derived variable is not set, an error is thrown at runtime.

### `baseURL`

**Type:** `string` | **Required:** No | **Default:** auto-detected

The base URL of the LLM provider's API. Use this for:

- **OpenRouter:** automatically set to `https://openrouter.ai/api/v1` for the `openrouter` provider
- **Azure OpenAI:** set to your Azure OpenAI endpoint URL
- **Self-hosted proxies:** point to your local or private API server
- **OpenAI-compatible providers:** any endpoint that speaks the OpenAI chat completions protocol

```jsonc
"baseURL": "{env:AZURE_OPENAI_ENDPOINT}"
```

### `autoReview`

**Type:** `boolean` | **Required:** No | **Default:** `false`

When `true`, the bot automatically reviews every pull request when it is opened and every time new commits are pushed (the `synchronize` event). Reviews appear as Check Runs with an approve/reject/comment conclusion.

When `false`, code reviews only happen when explicitly triggered via `/oc` or `@opencode-pro` in a comment.

```jsonc
"autoReview": true
```

### `autoAssign`

**Type:** `boolean` | **Required:** No | **Default:** `true`

When `true`, assigning the bot to an issue or PR causes it to automatically post an analysis. The bot detects its own username and responds without needing any trigger token in the issue body.

When `false`, assignment has no automatic effect — the bot only responds to explicit triggers.

```jsonc
"autoAssign": false
```

### `maxContextTokens`

**Type:** `number` | **Required:** No | **Default:** `128000`

The maximum token budget for PR review context. Diffs and file contents are truncated to fit within this limit before being sent to the LLM.

Set lower to reduce costs, higher for large PRs:

```jsonc
"maxContextTokens": 64000
```

### `ignorePatterns`

**Type:** `string[]` | **Required:** No | **Default:** `[]`

Glob-style patterns matching files to skip during PR reviews. Matching files are excluded from the context sent to the LLM and are not mentioned in the review.

```jsonc
"ignorePatterns": [
  "package-lock.json",
  "yarn.lock",
  "*.generated.*",
  "dist/**",
  "__generated__/**"
]
```

### `permissions`

**Type:** `object` | **Required:** No | **Default:** `{}`

Reserved for future permission scoping. Currently unused. Accepts any key-value pairs.

### `agents`

**Type:** `Record<string, AgentConfig>` | **Required:** No | **Default:** `{}`

Named agent definitions. Each agent can override the model, provider, system prompt, and token limit. Agent names are used for future multi-agent orchestration features and internal routing.

Each agent object supports these fields:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | primary `model` | Model in `provider/model-name` format |
| `provider` | string | primary provider | Provider name override |
| `description` | string | — | Human-readable description |
| `systemPrompt` | string | — | Custom system prompt for this agent's LLM calls |
| `maxTokens` | number | — | Maximum tokens for this agent's responses |

---

## Environment Variable References

The `{env:VAR_NAME}` syntax lets you reference environment variables directly in your config file. This is useful for:

- Keeping API keys out of committed config files
- Making the config file self-documenting about what env vars it expects
- Changing values per deployment environment without editing the config

Example:

```jsonc
{
  "model": "openai/gpt-4o",
  "apiKey": "{env:OPENAI_API_KEY}",
  "baseURL": "{env:OPENAI_BASE_URL}"
}
```

If a referenced variable is not set, the config loader throws an error at load time, preventing the bot from starting with missing credentials.

Env refs are resolved **after** JSONC parsing but **before** config validation. They can appear in any string value at any depth in the config object.

---

## Provider-Specific Setup

### OpenAI

Uses the `@ai-sdk/openai` provider. Default base URL is the standard OpenAI API endpoint.

```jsonc
{
  "model": "openai/gpt-4o"
}
```

Required environment variable: `OPENAI_API_KEY`

### Anthropic

Uses the `@ai-sdk/anthropic` provider.

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

Required environment variable: `ANTHROPIC_API_KEY`

### Azure OpenAI

Uses the `@ai-sdk/azure` provider. Requires both an API key and an endpoint URL.

```jsonc
{
  "model": "azure/gpt-4o",
  "apiKey": "{env:AZURE_OPENAI_API_KEY}",
  "baseURL": "{env:AZURE_OPENAI_ENDPOINT}"
}
```

Required environment variables: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_RESOURCE_NAME`

The `baseURL` should point to your Azure OpenAI resource endpoint, typically in the format:

```
https://<resource-name>.openai.azure.com
```

### OpenRouter

Uses the `@ai-sdk/openai` provider with the base URL automatically set to `https://openrouter.ai/api/v1`. OpenRouter provides access to many models through a single API.

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4-20250514",
  "apiKey": "{env:OPENROUTER_API_KEY}"
}
```

Required environment variable: `OPENROUTER_API_KEY`

The model name portion (after `openrouter/`) is passed directly to OpenRouter. You can reference any model available through their API.

### OpenAI-Compatible (Custom / Self-Hosted)

Any provider name that is not one of the built-in providers (`openai`, `anthropic`, `azure`, `openrouter`) is treated as OpenAI-compatible. The bot uses the `@ai-sdk/openai` provider with your custom base URL and API key.

**Local LM Studio / Ollama:**

```jsonc
{
  "model": "openai-compatible/llama-3-70b",
  "apiKey": "not-needed",
  "baseURL": "http://localhost:1234/v1"
}
```

**Self-hosted proxy (LiteLLM, etc.):**

```jsonc
{
  "model": "openai-compatible/gpt-4o",
  "apiKey": "{env:PROXY_API_KEY}",
  "baseURL": "https://proxy.internal.company.com/v1"
}
```

---

## Agent Customization

Agents let you define personalities with different models and instructions. The agent system is designed for future multi-agent orchestration — currently, agent definitions serve as configuration presets.

### System Prompts

The system prompt is prepended to every LLM call when using a specific agent. It sets the tone, expertise, and output format:

```jsonc
{
  "agents": {
    "security-auditor": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "systemPrompt": [
        "You are a security auditor reviewing code changes.",
        "Focus exclusively on security issues:",
        "- Injection vulnerabilities (SQL, command, template)",
        "- Authentication and authorization flaws",
        "- Data exposure and improper encryption",
        "- Dependency vulnerabilities",
        "",
        "For each finding, provide: severity (critical/high/medium/low),",
        "the vulnerable code location, and a specific fix.",
        "",
        "Be thorough. Prefer false positives over missed vulnerabilities."
      ].join("\n"),
      "maxTokens": 4096
    }
  }
}
```

### Model per Agent

Each agent can use a different model. This is useful for cost optimization — use a cheaper model for simple classifications and a more powerful model for deep review:

```jsonc
{
  "model": "openai/gpt-4o-mini",
  "agents": {
    "deep-reviewer": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "systemPrompt": "You perform exhaustive code review. Be meticulous."
    }
  }
}
```

### Agent Descriptions

The `description` field is metadata only — it is not sent to the LLM. It helps document the agent's purpose for other team members reading the config file.

---

## Examples

### Minimal Config

The smallest valid config file. Uses defaults for everything and relies on environment variables for provider credentials:

```jsonc
{
  "model": "openai/gpt-4o"
}
```

This enables the bot with all default behaviour. It responds to `/oc` and `@opencode-pro` triggers, but does not auto-review PRs.

### Full Config

All available options set explicitly:

```jsonc
{
  "model": "openai/gpt-4o",
  "small_model": "openai/gpt-4o-mini",
  "apiKey": "{env:OPENAI_API_KEY}",
  "baseURL": "https://api.openai.com/v1",
  "autoReview": true,
  "autoAssign": true,
  "maxContextTokens": 128000,
  "ignorePatterns": [
    "*.lock",
    "dist/**",
    "node_modules/**",
    "*.generated.*"
  ],
  "permissions": {},
  "agents": {
    "planner": {
      "model": "openai/gpt-4o",
      "provider": "openai",
      "description": "Architecture design agent",
      "systemPrompt": "You are a systems architect. Think holistically.\nPrefer mermaid diagrams for architecture.\nFocus on: scalability, resilience, cost, and simplicity.",
      "maxTokens": 8192
    },
    "coder": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "systemPrompt": "You write clean, tested code.\nAlways include unit tests.\nPrefer immutable data structures.\nUse functional patterns where appropriate.\nError on the side of readability.",
      "maxTokens": 8192
    },
    "reviewer": {
      "model": "openai/gpt-4o-mini",
      "description": "Quick code review agent",
      "systemPrompt": "Review for: correctness, performance, security, style.\nBe brief. Flag the top 5 issues only.",
      "maxTokens": 2048
    }
  }
}
```

### Azure OpenAI Config

Deploying with Azure OpenAI:

```jsonc
{
  "model": "azure/gpt-4o",
  "small_model": "azure/gpt-4o-mini",
  "apiKey": "{env:AZURE_OPENAI_API_KEY}",
  "baseURL": "{env:AZURE_OPENAI_ENDPOINT}",
  "autoReview": true,
  "autoAssign": true
}
```

Environment variables:

```bash
AZURE_OPENAI_API_KEY=abcd1234...
AZURE_OPENAI_RESOURCE_NAME=my-openai-resource
AZURE_OPENAI_ENDPOINT=https://my-openai-resource.openai.azure.com
```

### Anthropic Config

Using Claude exclusively:

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "apiKey": "{env:ANTHROPIC_API_KEY}",
  "autoReview": true,
  "autoAssign": true
}
```

### OpenRouter Config

Leveraging OpenRouter to access models from multiple providers through a single API key:

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4-20250514",
  "small_model": "openrouter/openai/gpt-4o-mini",
  "apiKey": "{env:OPENROUTER_API_KEY}",
  "autoReview": true,
  "autoAssign": true,
  "agents": {
    "cheap-review": {
      "model": "openrouter/meta-llama/llama-4-maverick",
      "description": "Budget code review agent",
      "systemPrompt": "Quick review. Top 3 issues only."
    }
  }
}
```

### Multi-Repo Setup with env Ref Overrides

A config that documents all env vars needed, making it clear to a developer what keys must be set in the deployment:

```jsonc
{
  "model": "{env:PRIMARY_MODEL}",
  "small_model": "{env:SMALL_MODEL}",
  "apiKey": "{env:OPENAI_API_KEY}",
  "baseURL": "{env:OPENAI_BASE_URL}",
  "autoReview": true,
  "autoAssign": true,
  "maxContextTokens": 64000,
  "ignorePatterns": ["*.lock", "dist/**", "vendor/**"]
}
```