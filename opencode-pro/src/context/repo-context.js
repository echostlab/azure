/**
 * Repository Context Awareness for OpenCode Pro.
 *
 * Builds a rich, structured context object from the GitHub repository
 * that can be injected into AI prompts for better, more informed responses.
 *
 * Context includes:
 *   - Repository file tree (top-level + first 2 levels, max 500 entries)
 *   - Recent commits (last 10)
 *   - Issue/PR discussion thread (all comments)
 *   - Language detection from file extensions
 *
 * @module context/repo-context
 */

import { debug, warn } from '../utils/logger.js';

/** @type {number} */
const MAX_TREE_ENTRIES = 500;

/** @type {number} */
const MAX_COMMITS = 10;

/**
 * Map of file extensions to language names for detection.
 *
 * @type {Record<string, string>}
 */
const EXTENSION_LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.cc': 'C++',
  '.cxx': 'C++',
  '.h': 'C/C++ Header',
  '.hpp': 'C++ Header',
  '.cs': 'C#',
  '.php': 'PHP',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.jsonc': 'JSONC',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.toml': 'TOML',
  '.xml': 'XML',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.less': 'Less',
  '.md': 'Markdown',
  '.mdx': 'MDX',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Bash',
  '.zsh': 'Zsh',
  '.dockerfile': 'Dockerfile',
  '.graphql': 'GraphQL',
  '.gql': 'GraphQL',
  '.prisma': 'Prisma',
  '.tf': 'Terraform',
  '.proto': 'Protobuf',
};

/**
 * Detect the primary languages used in the repository from file extensions.
 *
 * Parses an array of file path strings, extracts extensions, and maps
 * them to known language names.  Returns the top 10 most common languages
 * with counts.
 *
 * @param {string[]} filePaths - Array of file paths from the tree
 * @returns {Array<{language: string, count: number}>}
 */
function detectLanguages(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    return [];
  }

  /** @type {Record<string, number>} */
  const counts = {};

  for (const path of filePaths) {
    // Skip directories (no extension to report)
    if (path.endsWith('/')) continue;

    // Try full filename match first (e.g. Dockerfile, Makefile)
    const basename = path.split('/').pop();
    if (basename && EXTENSION_LANGUAGE_MAP[`.${basename.toLowerCase()}`]) {
      const lang = EXTENSION_LANGUAGE_MAP[`.${basename.toLowerCase()}`];
      counts[lang] = (counts[lang] || 0) + 1;
      continue;
    }

    // Fall back to extension-based detection
    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1 || lastDot === path.length - 1) continue;

    const ext = path.slice(lastDot).toLowerCase();
    const language = EXTENSION_LANGUAGE_MAP[ext];
    if (!language) continue;

    counts[language] = (counts[language] || 0) + 1;
  }

  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([language, count]) => ({ language, count }));
}

/**
 * Fetch the repository file tree using the Git Trees API.
 *
 * Attempts to fetch the tree recursively, falling back to non-recursive
 * if the tree is too large.  Limits the result to {@link MAX_TREE_ENTRIES}.
 *
 * @param {import('probot').Context} context - Probot event context
 * @returns {Promise<string[]>} Array of file paths
 */
async function fetchFileTree(context) {
  try {
    const { data: ref } = await context.octokit.git.getRef(
      context.repo({ ref: 'heads/main' }),
    );

    if (!ref?.object?.sha) {
      warn('Could not resolve default branch ref');
      return [];
    }

    // Try recursive first for depth — falls back on large repos
    let tree;
    try {
      const { data } = await context.octokit.git.getTree(
        context.repo({ tree_sha: ref.object.sha, recursive: '1' }),
      );
      tree = data.tree;
    } catch {
      // Recursive tree too large — fall back to non-recursive
      const { data } = await context.octokit.git.getTree(
        context.repo({ tree_sha: ref.object.sha }),
      );
      tree = data.tree;
    }

    if (!Array.isArray(tree)) {
      return [];
    }

    // Filter to top-level + first 2 levels only, and cap at MAX_TREE_ENTRIES
    const filtered = [];

    for (const entry of tree) {
      if (filtered.length >= MAX_TREE_ENTRIES) break;

      if (!entry.path) continue;

      const depth = entry.path.split('/').length;

      // Include blobs at depth 1 and 2 (directories at depth 1 show as trees)
      if (entry.type === 'blob' && depth <= 3) {
        filtered.push(entry.path);
      } else if (entry.type === 'tree' && depth === 1) {
        filtered.push(`${entry.path}/`);
      }
    }

    return filtered;
  } catch (err) {
    warn(`Failed to fetch file tree: ${err.message}`);
    return [];
  }
}

/**
 * Fetch the most recent commits on the default branch.
 *
 * @param {import('probot').Context} context - Probot event context
 * @returns {Promise<Array<{sha: string, message: string, author: string, date: string}>>}
 */
async function fetchRecentCommits(context) {
  try {
    const { data: commits } = await context.octokit.repos.listCommits(
      context.repo({ per_page: MAX_COMMITS }),
    );

    if (!Array.isArray(commits)) {
      return [];
    }

    return commits.map((commit) => ({
      sha: commit.sha.slice(0, 7),
      message: commit.commit.message.split('\n')[0],
      author: commit.commit.author?.name ?? 'Unknown',
      date: commit.commit.author?.date ?? '',
    }));
  } catch (err) {
    warn(`Failed to fetch recent commits: ${err.message}`);
    return [];
  }
}

/**
 * Fetch all comments from an issue or PR discussion.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} issueNumber - Issue or PR number
 * @returns {Promise<Array<{author: string, body: string, createdAt: string}>>}
 */
async function fetchDiscussionComments(context, issueNumber) {
  if (!issueNumber) {
    return [];
  }

  try {
    const { data: comments } = await context.octokit.issues.listComments(
      context.repo({ issue_number: issueNumber, per_page: 100 }),
    );

    if (!Array.isArray(comments)) {
      return [];
    }

    // Also fetch the issue/PR body itself as the first "comment"
    /** @type {Array<{author: string, body: string, createdAt: string}>} */
    const allMessages = [];

    try {
      const { data: issue } = await context.octokit.issues.get(
        context.repo({ issue_number: issueNumber }),
      );
      if (issue.body) {
        allMessages.push({
          author: issue.user?.login ?? 'Unknown',
          body: issue.body,
          createdAt: issue.created_at,
        });
      }
    } catch {
      // Issue body fetch is best-effort; proceed without it
    }

    for (const comment of comments) {
      allMessages.push({
        author: comment.user?.login ?? 'Unknown',
        body: comment.body ?? '',
        createdAt: comment.created_at,
      });
    }

    return allMessages;
  } catch (err) {
    warn(`Failed to fetch discussion comments: ${err.message}`);
    return [];
  }
}

/**
 * Build a human-readable string summary of the file tree for prompt injection.
 *
 * @param {string[]} filePaths - Array of file paths
 * @returns {string}
 */
function formatFileTree(filePaths) {
  if (filePaths.length === 0) {
    return 'No file tree available.';
  }

  const lines = filePaths.map((p) => `  ${p}`);
  return `File Tree (${filePaths.length} entries):\n${lines.join('\n')}`;
}

/**
 * Build a human-readable string summary of recent commits for prompt injection.
 *
 * @param {Array<{sha: string, message: string, author: string, date: string}>} commits
 * @returns {string}
 */
function formatRecentCommits(commits) {
  if (commits.length === 0) {
    return 'No recent commits available.';
  }

  const lines = commits.map(
    (c) => `  ${c.sha} — ${c.message} (${c.author}, ${c.date})`,
  );
  return `Recent Commits:\n${lines.join('\n')}`;
}

/**
 * Build a human-readable string summary of languages for prompt injection.
 *
 * @param {Array<{language: string, count: number}>} languages
 * @returns {string}
 */
function formatLanguages(languages) {
  if (languages.length === 0) {
    return 'No languages detected.';
  }

  const lines = languages.map(
    (l) => `  ${l.language}: ${l.count} files`,
  );
  return `Detected Languages:\n${lines.join('\n')}`;
}

/**
 * Build a human-readable string summary of discussion comments for prompt injection.
 *
 * @param {Array<{author: string, body: string, createdAt: string}>} comments
 * @returns {string}
 */
function formatDiscussion(comments) {
  if (comments.length === 0) {
    return 'No discussion history available.';
  }

  const lines = comments.map(
    (c) => `  [${c.author}] (${c.createdAt}):\n    ${c.body.split('\n').slice(0, 3).join('\n    ')}`,
  );
  return `Discussion Thread (${comments.length} messages):\n${lines.join('\n')}`;
}

/**
 * @typedef {object} RepoContext
 * @property {string[]} fileTree - Array of file paths (top 2 levels)
 * @property {Array<{sha: string, message: string, author: string, date: string}>} recentCommits
 * @property {Array<{author: string, body: string, createdAt: string}>} discussion
 * @property {Array<{language: string, count: number}>} languages
 * @property {string} contextBlock - Ready-to-inject formatted string for AI prompts
 */

/**
 * Build a rich repository context object from GitHub API data.
 *
 * Fetches the file tree, recent commits, discussion history, and detects
 * primary languages.  Returns both structured data and a formatted context
 * block suitable for prompt injection.
 *
 * @param {import('probot').Context} context - Probot event context
 * @param {number} [issueNumber] - Optional issue/PR number for discussion history
 * @returns {Promise<RepoContext>}
 */
export async function getRepoContext(context, issueNumber) {
  debug('Building repository context...');

  const [fileTree, recentCommits, discussion] = await Promise.all([
    fetchFileTree(context),
    fetchRecentCommits(context),
    issueNumber ? fetchDiscussionComments(context, issueNumber) : Promise.resolve([]),
  ]);

  const languages = detectLanguages(fileTree);

  const contextBlock = [
    formatFileTree(fileTree),
    '',
    formatRecentCommits(recentCommits),
    '',
    formatLanguages(languages),
    '',
    formatDiscussion(discussion),
  ].join('\n');

  debug(`Repo context built: ${fileTree.length} files, ${recentCommits.length} commits, ${languages.length} languages`);

  return {
    fileTree,
    recentCommits,
    discussion,
    languages,
    contextBlock,
  };
}