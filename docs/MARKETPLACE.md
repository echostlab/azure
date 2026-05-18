# GitHub Marketplace Listing — OpenCode Pro

This document contains the content for the GitHub Marketplace listing. Use it as the source of truth when creating or updating the listing in the GitHub Marketplace.

---

## Listing Name

**OpenCode Pro**

## Tagline

AI-powered code review, issue triage, and developer assistance — config-file-driven and provider-flexible.

---

## Introductory Description

An enhanced GitHub App bot that brings Copilot-like AI assistance to your repositories. Auto-review PRs, triage issues, and respond to comments — all configurable via a single JSONC file. Choose your LLM provider: OpenAI, Anthropic, Azure, or OpenRouter.

---

## Detailed Description

OpenCode Pro is a GitHub App that integrates AI assistance directly into your development workflow. It acts as an intelligent bot that reviews pull requests, triages issues, and responds to comments — all driven by a simple configuration file stored in your repository.

### How It Works

Place a `.opencode-pro.json` file at your repository root, pick a model and provider, and the bot starts working immediately. No complex setup, no external dashboards — just a config file and your chosen LLM provider.

### Why OpenCode Pro

- **Config-file driven** — Everything the bot does is defined in a single JSONC file that lives in your repo. Version it, review it, ship it with your code.
- **Provider flexibility** — Not locked into a single AI provider. Use OpenAI, Anthropic, Azure OpenAI, OpenRouter, or any OpenAI-compatible endpoint. Switch providers by changing one line in your config.
- **Auto PR review** — Every pull request gets an automated code review with inline feedback. Results appear as native GitHub Check Runs with approve/reject/comment conclusions.
- **Conversational AI** — Mention `@opencode-pro` or use `/oc` in any comment to ask questions, request reviews, or get coding suggestions. Pass inline parameters to override the model per-request.
- **Auto-assignment** — Assign the bot to an issue or PR and it responds automatically with analysis and next steps. No trigger tokens needed.
- **Multi-agent orchestration** — Define multiple agents with custom system prompts and model assignments. Route different types of work through specialized AI personalities.
- **Secure by default** — API keys reference environment variables using `{env:VAR_NAME}` syntax. No secrets in your config file. Production deployments use Azure Key Vault for credential storage.

### Features at a Glance

| Feature | Description |
|---------|-------------|
| Auto PR Review | Reviews PRs on open and push; results as Check Runs |
| Slash Commands | `/oc` and `/opencode` triggers in comments |
| @mentions | `@opencode-pro` triggers the bot |
| Auto-assign | Assign to bot = automatic response |
| JSONC Config | `.opencode-pro.json` with comments and trailing commas |
| Multi-provider | OpenAI, Anthropic, Azure, OpenRouter, custom endpoints |
| Agent System | Named agents with custom system prompts and models |
| Check Run Integration | Reviews appear in PR checks panel |
| Environment Variable References | `{env:VAR_NAME}` syntax for secret-free configs |
| Ignore Patterns | Skip specific files during review |

---

## Screenshots

When preparing screenshots for the marketplace listing, capture the following:

### 1. Auto PR Review in Check Runs

**What to show:** A pull request page with the "Checks" tab open, showing the "OpenCode Pro Review" check run with a completed conclusion (approval or change request). The check run summary should show the AI-generated review text.

**How to capture:** Open a PR that has been auto-reviewed. Scroll to the bottom of the PR page to show the checks section, then expand the OpenCode Pro check run to show the full summary.

### 2. Conversation with the Bot

**What to show:** An issue or PR comment thread showing a user typing `/oc review this code for performance issues` followed by the bot's detailed response with code blocks, file references, and recommendations.

**How to capture:** Create an issue, post a `/oc` command, wait for the bot response, then screenshot the conversation thread.

### 3. Configuration File

**What to show:** A side-by-side view of a `.opencode-pro.json` file in the repository and the resulting bot behaviour (e.g., the config file with `"autoReview": true` on one side, and the check run on the other).

**How to capture:** Two screenshots composited together — the config file open in the GitHub editor, and the resulting PR review.

### 4. Agent Configuration

**What to show:** A config file with multiple agent definitions (`planner`, `coder`, `reviewer`) and a brief explanation of how each uses a different model and system prompt.

**How to capture:** The config file snippet with the agents section highlighted.

---

## Category Recommendations

GitHub Marketplace categories:

- **Primary:** Code review
- **Secondary:** Code quality, Chat

---

## Pricing Model

OpenCode Pro is **free and open source** under the MIT license.

The bot itself is free to install and use. Costs are limited to:

- **LLM provider API usage** — You pay your chosen AI provider directly for API calls (OpenAI, Anthropic, Azure, etc.)
- **Azure hosting costs** (self-hosted only) — If you deploy your own instance, Azure Functions on the Consumption plan costs are minimal (free tier covers most usage)

No usage tracking, no seat licenses, no per-repository fees. Install on as many repositories as you need.

---

## Links

| Link | URL |
|------|-----|
| **Source code** | `https://github.com/anomalyco/opencode-pro` |
| **Documentation** | `https://github.com/anomalyco/opencode-pro/blob/main/README.md` |
| **Configuration guide** | `https://github.com/anomalyco/opencode-pro/blob/main/docs/CONFIGURATION.md` |
| **Deployment guide** | `https://github.com/anomalyco/opencode-pro/blob/main/docs/DEPLOYMENT.md` |
| **Issue tracker** | `https://github.com/anomalyco/opencode-pro/issues` |
| **Privacy policy** | `https://github.com/anomalyco/opencode-pro/blob/main/PRIVACY.md` |
| **Status page** | `https://github.com/anomalyco/opencode-pro#status` |

---

## Support

For support:

- **Bug reports and feature requests:** Open an issue at `https://github.com/anomalyco/opencode-pro/issues`
- **Questions and discussions:** Start a discussion at `https://github.com/anomalyco/opencode-pro/discussions`
- **Security issues:** Follow the security policy in `SECURITY.md`

The maintainers respond on a best-effort basis. For production-critical issues, priority is given to bug reports with clear reproduction steps.

---

## Privacy Policy

A privacy policy is required for all GitHub Marketplace listings. Create a `PRIVACY.md` file in the repository with the following minimum content:

- The bot does not store or retain any repository content
- API requests are sent directly to the configured LLM provider and are not logged by OpenCode Pro
- Repository config files are read only — they are never modified or written to
- GitHub App permissions are used solely for the documented features (commenting, creating check runs, reading files)
- No telemetry, analytics, or usage tracking is collected

---

## Installation Verification

After installation, verify the bot is working:

1. Install the app on a repository
2. Add a `.opencode-pro.json` config file
3. Create an issue with `/oc hello` in the body
4. Confirm the bot responds within a few seconds

If no response appears, check the [troubleshooting section in the deployment guide](https://github.com/anomalyco/opencode-pro/blob/main/docs/DEPLOYMENT.md#troubleshooting).
