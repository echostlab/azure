/**
 * Multi-Agent Orchestration for OpenCode Pro.
 *
 * Orchestrates AI-powered workflows across three specialised agents:
 *   1. Plan Agent   — analyses the task and codebase, produces a plan (read-only)
 *   2. Coder Agent  — implements the plan, writes clean and tested code
 *   3. Reviewer Agent — reviews the code for bugs, security, and improvements
 *
 * All agents use the same AI provider but operate with distinct system
 * prompts that constrain their behaviour to their specific role.
 *
 * @module agents/orchestrator
 */

import { generateResponse, generateStream } from '../providers/llm.js';
import { debug, error, info } from '../utils/logger.js';

/**
 * @typedef {'plan' | 'coder' | 'reviewer'} AgentType
 */

/**
 * @typedef {object} AgentResult
 * @property {AgentType} agent - Which agent produced this result
 * @property {string} content - The agent's output
 * @property {number} elapsedMs - Time taken in milliseconds
 */

/**
 * @typedef {object} OrchestrationResult
 * @property {AgentResult} plan - Plan agent result
 * @property {AgentResult} coder - Coder agent result
 * @property {AgentResult} reviewer - Reviewer agent result
 * @property {number} totalElapsedMs - Total orchestration time
 */

/**
 * System prompts for each agent type.
 *
 * Each prompt constrains the agent to its specific role and prevents
 * it from overstepping into another agent's responsibilities.
 *
 * @type {Record<AgentType, string>}
 */
const AGENT_SYSTEM_PROMPTS = {
  plan: [
    'You are a planning agent. Your sole responsibility is to analyse the task,',
    'examine the provided codebase context, and produce a clear, step-by-step',
    'implementation plan. Do NOT write any code. Do NOT implement anything.',
    '',
    'Your output should include:',
    '1. A summary of the task and its requirements',
    '2. Files that need to be created or modified',
    '3. The order of operations',
    '4. Potential risks or edge cases to consider',
    '',
    'Be thorough but concise. End your plan with "PLAN COMPLETE."',
  ].join('\n'),

  coder: [
    'You are a coding agent. Your job is to implement the provided plan by',
    'writing clean, tested, production-quality code. Follow best practices,',
    'use guard clauses, fail fast on invalid inputs, and keep functions pure',
    'where possible.',
    '',
    'Guidelines:',
    '- Write code that is self-documenting through clear naming',
    '- Include JSDoc-style comments for public functions',
    '- Handle edge cases at the top of each function',
    '- Never swallow errors silently',
    '- Prefer immutability over mutation',
    '',
    'End your implementation with "IMPLEMENTATION COMPLETE."',
  ].join('\n'),

  reviewer: [
    'You are a code reviewer. Your job is to examine the implemented code and',
    'identify bugs, security vulnerabilities, performance issues, and areas',
    'for improvement. Provide specific, actionable feedback.',
    '',
    'Review for:',
    '1. Logic errors and edge cases',
    '2. Security vulnerabilities (injection, auth, data exposure)',
    '3. Performance concerns (N+1 queries, excessive allocations)',
    '4. Code style and best practice violations',
    '5. Missing error handling or guard clauses',
    '6. Opportunities for simplification or abstraction',
    '',
    'Be constructive. End your review with "REVIEW COMPLETE."',
  ].join('\n'),
};

/**
 * Build the appropriate message array for a specific agent type.
 *
 * @param {AgentType} agentType - The type of agent to build messages for
 * @param {string} task - The task or user prompt
 * @param {object} context - Additional context for the agent
 * @param {string} [context.priorOutput] - Output from the previous agent phase
 * @param {string} [context.repoContext] - Repository context block
 * @returns {Array<{role: string, content: string}>}
 */
export function createAgentMessages(agentType, task, context = {}) {
  if (!agentType || !AGENT_SYSTEM_PROMPTS[agentType]) {
    throw new Error(`createAgentMessages: unknown agent type "${agentType}"`);
  }

  if (!task) {
    throw new Error('createAgentMessages: task is required');
  }

  /** @type {Array<{role: string, content: string}>} */
  const messages = [
    { role: 'system', content: AGENT_SYSTEM_PROMPTS[agentType] },
  ];

  let content = task;

  if (context.repoContext) {
    content = `${content}\n\nRepository Context:\n${context.repoContext}`;
  }

  switch (agentType) {
    case 'plan':
      content = `${content}\n\nPlease produce your implementation plan now.`;
      break;

    case 'coder':
      if (context.priorOutput) {
        content = `${content}\n\nHere is the plan to implement:\n\n${context.priorOutput}\n\nPlease implement this plan now.`;
      }
      break;

    case 'reviewer':
      if (context.priorOutput) {
        content = `${content}\n\nHere is the implementation to review:\n\n${context.priorOutput}\n\nPlease review this code now.`;
      }
      break;
  }

  messages.push({ role: 'user', content });
  return messages;
}

/**
 * Run a single agent phase and measure its elapsed time.
 *
 * Uses non-streaming generation for plan and review phases (where the
 * full output is needed before proceeding), and streaming for the coder
 * phase (where intermediate output may be inspected).
 *
 * @param {AgentType} agentType - Which agent to run
 * @param {import('../providers/llm.js').LoadedConfig} config - LLM config
 * @param {object} opts - Agent options
 * @param {string} opts.prompt - The effective prompt for this agent
 * @param {string} opts.system - System prompt
 * @param {number} [opts.maxTokens] - Maximum output tokens
 * @returns {Promise<AgentResult>}
 */
async function runAgent(agentType, config, opts) {
  const start = Date.now();

  debug(`[${agentType}] agent starting...`);

  try {
    // Use non-streaming for plan and reviewer (we need full output to pass to next phase)
    const shouldStream = agentType === 'coder';

    let content;
    if (shouldStream) {
      const stream = await generateStream({
        prompt: opts.prompt,
        system: opts.system,
        files: [],
        config,
      });

      const chunks = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      content = chunks.join('');
    } else {
      content = await generateResponse({
        prompt: opts.prompt,
        system: opts.system,
        files: [],
        config,
      });
    }

    const elapsedMs = Date.now() - start;

    debug(`[${agentType}] agent completed in ${elapsedMs}ms (${content.length} chars)`);

    return {
      agent: agentType,
      content,
      elapsedMs,
    };
  } catch (err) {
    error(`[${agentType}] agent failed: ${err.message}`);

    return {
      agent: agentType,
      content: `Agent "${agentType}" encountered an error: ${err.message}`,
      elapsedMs: Date.now() - start,
    };
  }
}

/**
 * Orchestrate a task across the plan → coder → reviewer pipeline.
 *
 * 1. The Plan Agent analyses the task and produces a step-by-step plan.
 * 2. The Coder Agent receives the plan and implements the code.
 * 3. The Reviewer Agent examines the implementation and provides feedback.
 *
 * Each phase receives the output of the previous phase.  If any phase
 * fails, the pipeline continues with an error result for that phase
 * rather than aborting the entire orchestration.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {string} task - The user's task description
 * @param {import('../config.js').LoadedConfig} config - Loaded LLM configuration
 * @returns {Promise<OrchestrationResult>}
 */
export async function orchestrateAgents(context, task, config) {
  if (!task) {
    throw new Error('orchestrateAgents: task is required');
  }

  const totalStart = Date.now();
  info(`Orchestrating agents for task: "${task.slice(0, 80)}..."`);

  // ── Phase 1: Plan ─────────────────────────────────────────

  const planResult = await runAgent('plan', config, {
    prompt: task,
    system: AGENT_SYSTEM_PROMPTS.plan,
  });

  // ── Phase 2: Coder ────────────────────────────────────────

  const coderResult = await runAgent('coder', config, {
    prompt: [
      `Original task: ${task}`,
      '',
      `Plan from planning agent:`,
      planResult.content,
      '',
      'Please implement the plan above.',
    ].join('\n'),
    system: AGENT_SYSTEM_PROMPTS.coder,
  });

  // ── Phase 3: Reviewer ─────────────────────────────────────

  const reviewerResult = await runAgent('reviewer', config, {
    prompt: [
      `Original task: ${task}`,
      '',
      `Implementation from coder agent:`,
      coderResult.content,
      '',
      'Please review the implementation above.',
    ].join('\n'),
    system: AGENT_SYSTEM_PROMPTS.reviewer,
  });

  const totalElapsedMs = Date.now() - totalStart;

  info(`Orchestration complete in ${totalElapsedMs}ms`);

  return {
    plan: planResult,
    coder: coderResult,
    reviewer: reviewerResult,
    totalElapsedMs,
  };
}
