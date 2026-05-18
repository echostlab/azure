# Contributing to OpenCode Pro

Thank you for your interest in contributing. This guide covers everything you need to set up a development environment, follow project conventions, and submit changes.

---

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold its terms. Report unacceptable behaviour to the maintainers.

---

## Development Environment Setup

### Prerequisites

- **Node.js 20+** (the project declares `>=20.0.0` in `package.json`)
- **npm 9+** (comes with Node.js 20)
- **Git**

### First-Time Setup

```bash
# Clone the repository
git clone https://github.com/<owner>/<repo>.git
cd <repo>/opencode-pro

# Install dependencies
npm install

# Copy and configure environment variables
cp .env.example .env
```

If your checkout already has `opencode-pro` as the repository root, use `cd <repo>`.

Edit `.env` with at least one LLM provider API key:

```bash
# For local testing, pick one:
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
# or
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_RESOURCE_NAME=my-resource
```

The GitHub App credentials (`APP_ID`, `PRIVATE_KEY`, `WEBHOOK_SECRET`) are not needed for local development unless you are testing webhook delivery end-to-end.

### Verify Setup

```bash
# Run lint
npm run lint

# Run tests
npm test

# Run the dev server (auto-reloads on changes)
npm run dev
```

---

## Code Style and Philosophy

### Formatting and Linting

This project uses **ESLint** and **Prettier**. Run both before submitting:

```bash
npm run lint
```

The CI pipeline runs lint on every PR. A failing lint check blocks merging.

### Project Conventions

- **ES Modules only** — The project uses `"type": "module"` in `package.json`. Use `import`/`export` syntax, not `require`.
- **JSDoc types** — The project does not use TypeScript. All type annotations are JSDoc comments (`@param`, `@returns`, `@typedef`). Every exported function must have a JSDoc block.
- **No default exports (except app entry point)** — Prefer named exports. The main app function in `src/index.js` is the only default export.
- **Error handling** — Functions in handler modules catch errors internally and log them. Never throw uncaught exceptions from handler code — let the Probot error event handler deal with truly unexpected failures.
- **Logging** — Use the structured logger (`src/utils/logger.js`) instead of `console.log`. Respect log levels: `debug` for development detail, `info` for operational events, `warn` for recoverable issues, `error` for failures.

### Code Philosophy

The internal design is guided by five principles:

1. **Guide don't guard** — Code should steer data toward valid states rather than throwing errors at every boundary
2. **Make invalid states unrepresentable** — Design types and data flows so that impossible states cannot be expressed
3. **Fail at the boundary** — Push validation to the earliest possible point (config loading, request parsing)
4. **Narrow the tunnel** — Keep the core logic path as small and focused as possible, pushing side effects to the edges
5. **Compose, don't branch** — Prefer function composition over conditional branching in core logic

These are aspirational guidelines, not hard rules. When in doubt, match the style of the surrounding code.

---

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-runs on file changes)
npx jest --watch

# Run a specific test file
npx jest src/handlers/trigger.test.js
```

Tests use Jest with the `--experimental-vm-modules` flag for ES module support. Write tests for:

- New utility functions
- Trigger detection logic
- Config parsing and validation
- Provider selection and key derivation

Handler integration tests that require a real GitHub App installation are not expected — test the pure logic extracted from handlers instead.

---

## Submitting Pull Requests

### Before You Start

1. **Search existing issues** to avoid duplicating work
2. **Open an issue** for significant changes to discuss the approach first
3. **Comment on an existing issue** to say you are working on it

### Branch Naming

Use descriptive branch names prefixed with the type of change:

```
feat/add-diff-highlighting
fix/webhook-signature-verification
docs/update-deployment-guide
chore/upgrade-probot-v14
```

### Commit Messages

Follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
type(scope): description

[optional body explaining WHY, not what]

[optional footer with breaking changes or issue refs]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:

```
feat(handlers): add inline PR review comments using review_comment.created event
```

```
fix(config): resolve env refs in nested agent configs
```

```
docs(readme): add provider setup examples for OpenRouter and Azure
```

Write commit messages in the imperative mood ("add" not "added", "fix" not "fixed"). The body explains **why** the change was made — the diff shows what changed.

### PR Description

Every pull request should include:

- **Summary** — What the change does and why
- **Related issues** — Link to any issues this PR addresses (e.g., `Fixes #42`)
- **Testing** — How you verified the change works (unit tests, manual testing steps)
- **Screenshots or logs** — If the change affects bot output or UI, include relevant screenshots

### PR Review Process

1. Open a PR against the `main` branch
2. CI must pass (lint, test, build)
3. At least one maintainer must approve
4. The PR author merges after approval (self-merge is acceptable post-approval)

Maintainers may request changes. Respond to feedback, update the PR, and re-request review.

---

## Issue Templates

### Bug Report

Include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Relevant config file contents (with secrets redacted)
- Bot log output (set `LOG_LEVEL=debug`)
- Environment: self-hosted or managed, Node.js version, provider

### Feature Request

Include:
- The problem you are trying to solve
- How you currently work around it
- A proposed solution (if you have one)
- Whether you are willing to contribute the implementation

---

## Project Structure

```
src/
├── index.js              # Probot app entry — registers webhook event handlers
├── azure-function.js     # Azure Functions v4 adapter — validates env, creates Probot instance
├── config.js             # Reads .opencode-pro.json, resolves {env:VAR} refs, builds typed config
├── providers/
│   └── llm.js            # Create provider instances, generate text (streaming + non-streaming)
├── handlers/
│   ├── issues.js         # issues.opened (auto-triage), issues.assigned, issue_comment.created
│   ├── pull_requests.js  # PR open/sync (auto-review), review comments, PR assigned
│   ├── commands.js       # Command parser: detects triggers, dispatches to LLM
│   ├── command-overrides.js # Shared parse/apply helpers for provider/model/agent/continue overrides
│   ├── checks.js         # Check Run helpers: create, update, complete with conclusions
│   ├── review-conclusion.js # Safe mapping to valid GitHub Checks API conclusions
│   └── trigger.js        # Trigger detection: /oc, /opencode, @opencode-pro, auto-assign
└── utils/
    ├── github.js         # GitHub API wrappers (comments, diffs, file contents, check runs)
    ├── ignore-patterns.js # Filters PR files based on config ignorePatterns before review
    └── logger.js         # Structured logging with timestamp and log level filtering
```

---

## Getting Help

- **Questions:** Start a [GitHub Discussion](https://github.com/anomalyco/opencode-pro/discussions)
- **Bugs:** Open an issue with the bug report template
- **Discord/Slack:** Not currently available — use GitHub Discussions

---

Thank you for contributing to OpenCode Pro.
