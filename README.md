# OpenCode Pro — Enhanced GitHub App Bot with Copilot-like AI Assistance

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](https://nodejs.org/)
[![Probot](https://img.shields.io/badge/Probot-13.x-orange.svg)](https://probot.github.io/)

OpenCode Pro is a GitHub App bot that brings Copilot-like AI assistance directly into your GitHub workflow. It reviews pull requests, triages issues, and responds to comments — all driven by a simple config file committed to your repository and powered by your choice of LLM provider.

---

## Features

- **Auto PR Review with inline suggestions** — Automatically reviews every new PR and every pushed commit. Results appear as a Check Run with safe, valid GitHub conclusions (`success`, `failure`, `neutral`) mapped from AI output.

- **@mention and /oc slash command support** — Trigger the bot from any comment with `/oc`, `/opencode`, or `@opencode-pro`. Include inline parameters like `model=...`, `provider=...`, `agent=...`, and `continue=true|false` to override behaviour for one execution.

- **Auto-assignment handling** — Assign an issue or PR to the bot (`@opencode-pro`) and it automatically responds with analysis and recommendations. No manual triggering needed.

- **Config-file-driven** — All behaviour is controlled by a `.opencode-pro.json` (or `.opencode.jsonc`) file at your repo root. JSONC syntax is supported: comments, trailing commas, relaxed quoting.

- **Multi-provider LLM** — Choose from OpenAI, Anthropic, Azure OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Use `provider/model-name` format throughout your config.

- **Azure Functions deployment with Key Vault secrets** — Production deployment runs as an Azure Function on a Linux Consumption plan. All sensitive credentials (GitHub App private key, webhook secret, API keys) are stored securely in Azure Key Vault.

- **Check Run integration** — AI reviews appear as native GitHub Check Runs, visible in the PR checks panel. Conclusion states (success, failure, neutral) map to approve/reject/comment.

- **Multi-agent orchestration** — Define named agents with custom system prompts and model assignments. Route work through specialised agents — planning, coding, reviewing — each with their own personality and instructions.

---

## Quick Start

### 1. Install the GitHub App

Install OpenCode Pro from the [GitHub Marketplace](#) onto your user account or organization. Select which repositories you want the bot to access.

```bash
cd <repo>
```

### 2. Add a config file to your repo

Create `.opencode-pro.json` in your repository root:

```jsonc
{
  "model": "openai/gpt-4o",
  "autoReview": true,
  "autoAssign": true,
  "agents": {
    "coder": {
      "model": "openai/gpt-4o",
      "systemPrompt": "You are an expert software engineer. Be concise and correct."
    }
  }
}
```

At minimum, you need to provide API keys for your chosen provider. These are set as environment variables in the deployment environment — never committed to your repo. Use `{env:VAR_NAME}` references if you want the config file to be self-documenting:

```jsonc
{
  "model": "openai/gpt-4o",
  "apiKey": "{env:OPENAI_API_KEY}"
}
```

### 3. Use /oc or @opencode-pro in comments

Open a PR, create an issue, or leave a comment containing `/oc` or `@opencode-pro`. The bot will respond with an AI-generated analysis.

Trigger a review on a specific PR comment:

```
/oc review this change for null safety issues model=anthropic/claude-sonnet-4-20250514
```

Use a configured agent and explicitly continue prior discussion context:

```text
@opencode-pro please continue with a refactor plan agent=coder continue=true
```

Assign the bot to an issue for automatic triage.

---

## Configuration Reference

The config file is read from either `.opencode-pro.json` or `.opencode.jsonc` at the repository root. If no config file is found, the bot falls back to environment variable defaults.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `openai/gpt-4o` | Primary model in `provider/model-name` format |
| `small_model` | string | same as `model` | Lightweight model for classification and trigger detection |
| `apiKey` | string | env-derived | API key — supports `{env:VAR_NAME}` references |
| `baseURL` | string | `null` (auto-detect) | Custom API base URL for OpenRouter or self-hosted proxies |
| `autoReview` | boolean | `false` | Whether to auto-review PRs on open and synchronize |
| `autoAssign` | boolean | `true` | Whether to auto-respond when the bot is assigned |
| `maxContextTokens` | number | `128000` | Maximum token budget for PR review context |
| `ignorePatterns` | string[] | `[]` | Glob patterns for files to skip during review |
| `permissions` | object | `{}` | Reserved for future permission scoping |
| `agents` | object | `{}` | Named agent configurations (see below) |

### Agent Configuration

Each key under `agents` defines a named agent:

```jsonc
{
  "agents": {
    "planner": {
      "model": "openai/gpt-4o",
      "provider": "openai",
      "description": "Architecture planning agent",
      "systemPrompt": "You are a senior architect. Think before you speak.",
      "maxTokens": 8192
    },
    "coder": {
      "model": "anthropic/claude-sonnet-4-20250514",
      "systemPrompt": "You write clean, well-tested code. Prefer clarity over cleverness."
    }
  }
}
```

| Agent field | Type | Default | Description |
|-------------|------|---------|-------------|
| `model` | string | primary model | Model in `provider/model-name` format |
| `provider` | string | primary provider | Provider name override |
| `description` | string | — | Human-readable description |
| `systemPrompt` | string | — | Custom system prompt for this agent |
| `maxTokens` | number | — | Token limit for this agent's responses |

---

## Provider Setup

### OpenAI

```jsonc
{
  "model": "openai/gpt-4o"
}
```

Set `OPENAI_API_KEY` as an environment variable.

### Anthropic

```jsonc
{
  "model": "anthropic/claude-sonnet-4-20250514"
}
```

Set `ANTHROPIC_API_KEY` as an environment variable.

### Azure OpenAI

```jsonc
{
  "model": "azure/gpt-4o",
  "apiKey": "{env:AZURE_OPENAI_API_KEY}",
  "baseURL": "{env:AZURE_OPENAI_ENDPOINT}"
}
```

Set `AZURE_OPENAI_API_KEY` and `AZURE_OPENAI_RESOURCE_NAME` as environment variables.

### OpenRouter

```jsonc
{
  "model": "openrouter/anthropic/claude-sonnet-4-20250514",
  "apiKey": "{env:OPENROUTER_API_KEY}"
}
```

The base URL is automatically set to `https://openrouter.ai/api/v1`. Set `OPENROUTER_API_KEY` as an environment variable.

### OpenAI-compatible (self-hosted proxies, local models)

```jsonc
{
  "model": "openai-compatible/llama-3-70b",
  "apiKey": "{env:PROXY_API_KEY}",
  "baseURL": "http://localhost:8000/v1"
}
```

Any unknown provider name is treated as OpenAI-compatible, using the `apiKey` and `baseURL` as provided.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `APP_ID` | Yes | GitHub App ID |
| `PRIVATE_KEY` | Yes | GitHub App private key (PEM) |
| `WEBHOOK_SECRET` | Yes | GitHub webhook secret |
| `PRIMARY_MODEL` | No | Fallback model when no repo config is found |
| `SMALL_MODEL` | No | Fallback for lightweight model |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` (default: `info`) |
| `MAX_CONTEXT_TOKENS` | No | Default token budget (default: `128000`) |
| `OPENAI_API_KEY` | Provider | OpenAI API key |
| `ANTHROPIC_API_KEY` | Provider | Anthropic API key |
| `AZURE_OPENAI_API_KEY` | Provider | Azure OpenAI API key |
| `AZURE_OPENAI_RESOURCE_NAME` | Provider | Azure OpenAI resource name |
| `OPENROUTER_API_KEY` | Provider | OpenRouter API key |

---

## Deployment

OpenCode Pro can be deployed in two ways:

### Option A: GitHub App (install from Marketplace)

Install directly from the GitHub Marketplace. This uses the hosted instance maintained by the OpenCode Pro team. No infrastructure to manage.

### Option B: Self-hosted on Azure

Deploy your own instance using the included Bicep templates and GitHub Actions workflow. Full control over resources, data, and LLM providers.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the step-by-step deployment guide.

For Azure Functions v4, the function entrypoint is `src/azure-function.js` (`package.json#main`), and the webhook route is `/api/webhook`.

---

## Project Structure

```
.
├── src/
│   ├── index.js              # Probot app entry point — registers webhook handlers
│   ├── azure-function.js     # Azure Functions v4 adapter wrapper
│   ├── config.js             # Config loader — reads .opencode-pro.json, resolves env refs
│   ├── providers/
│   │   └── llm.js            # LLM abstraction layer — OpenAI, Anthropic, Azure, OpenRouter
│   ├── handlers/
│   │   ├── issues.js         # Issue event handlers (open, assign, comment)
│   │   ├── pull_requests.js  # PR event handlers (open, sync, review, assign)
│   │   ├── commands.js       # Command parser and router (/oc, @mention)
│   │   ├── command-overrides.js # Shared parser/applier for model/provider/agent/continue overrides
│   │   ├── checks.js         # Check Run lifecycle (create, update, complete)
│   │   ├── review-conclusion.js # Maps AI review conclusions to valid GitHub Check conclusions
│   │   └── trigger.js        # Trigger detector (slash commands, mentions, auto)
│   └── utils/
│       ├── github.js         # GitHub API helpers (comments, diffs, check runs)
│       ├── ignore-patterns.js # Applies ignorePatterns filtering for PR review files
│       └── logger.js         # Structured logging with log levels
├── host.json                 # Azure Functions host config (HTTP routePrefix=api)
├── infra/
│   ├── main.bicep            # Bicep deployment — subscription scope
│   ├── modules/
│   │   └── infra.bicep       # Resource definitions — Functions, KV, Storage
│   └── parameters.json       # Default deployment parameters
├── .github/
│   └── workflows/
│       ├── ci.yml            # CI: lint, test, build on PR
│       ├── deploy-azure.yml  # Deploy infrastructure and code to Azure
│       └── publish-marketplace.yml  # Tag-driven marketplace publishing
├── app.yml                   # GitHub App manifest
├── .env.example              # Environment variable template
└── package.json
```

---

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on setting up a development environment, running tests, and submitting pull requests.

---

## License

MIT — see the [LICENSE](LICENSE) file for details.
