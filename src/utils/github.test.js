import { describe, expect, it, jest } from '@jest/globals';

import { getPullRequestFiles, listAllPullRequestFiles, readRepoFile } from './github.js';

function createMockFiles(count, prefix = 'src/file') {
  return Array.from({ length: count }, (_, index) => ({
    filename: `${prefix}-${index + 1}.js`,
    patch: `@@ -1 +1 @@\n+line ${index + 1}`,
  }));
}

describe('GitHub PR files pagination', () => {
  it('collects all pages from listFiles client', async () => {
    const pageOne = createMockFiles(100, 'src/page-one');
    const pageTwo = createMockFiles(100, 'src/page-two');
    const pageThree = createMockFiles(20, 'src/page-three');

    const listFiles = jest
      .fn()
      .mockResolvedValueOnce({ data: pageOne })
      .mockResolvedValueOnce({ data: pageTwo })
      .mockResolvedValueOnce({ data: pageThree });

    const all = await listAllPullRequestFiles(listFiles, {
      owner: 'acme',
      repo: 'project',
      pull_number: 42,
    });

    expect(all).toHaveLength(220);
    expect(listFiles).toHaveBeenCalledTimes(3);
    expect(listFiles.mock.calls[0][0].page).toBe(1);
    expect(listFiles.mock.calls[1][0].page).toBe(2);
    expect(listFiles.mock.calls[2][0].page).toBe(3);
  });

  it('uses pagination helper inside getPullRequestFiles', async () => {
    const pageOne = createMockFiles(100, 'src/first');
    const pageTwo = createMockFiles(3, 'src/last');

    const context = {
      repo: jest.fn().mockReturnValue({ owner: 'acme', repo: 'project' }),
      octokit: {
        pulls: {
          listFiles: jest
            .fn()
            .mockResolvedValueOnce({ data: pageOne })
            .mockResolvedValueOnce({ data: pageTwo }),
        },
      },
    };

    const files = await getPullRequestFiles(context, 99);

    expect(files).toHaveLength(103);
    expect(context.octokit.pulls.listFiles).toHaveBeenCalledTimes(2);
    expect(files[0]).toEqual({
      filename: pageOne[0].filename,
      patch: pageOne[0].patch,
    });
  });

  it('throws a clear error when a pagination API call fails', async () => {
    const listFiles = jest
      .fn()
      .mockResolvedValueOnce({ data: createMockFiles(100, 'src/page-one') })
      .mockRejectedValueOnce(new Error('GitHub API unavailable'));

    await expect(
      listAllPullRequestFiles(listFiles, { owner: 'acme', repo: 'project', pull_number: 7 }),
    ).rejects.toThrow('failed to fetch PR files page 2');
  });
});

describe('readRepoFile', () => {
  it('returns null for 404 responses', async () => {
    const context = {
      repo: jest.fn().mockReturnValue({ owner: 'acme', repo: 'project' }),
      octokit: {
        repos: {
          getContent: jest.fn().mockRejectedValue({ status: 404 }),
        },
      },
    };

    await expect(readRepoFile(context, '.opencode-pro.json')).resolves.toBeNull();
  });

  it('rethrows unexpected API errors', async () => {
    const context = {
      repo: jest.fn().mockReturnValue({ owner: 'acme', repo: 'project' }),
      octokit: {
        repos: {
          getContent: jest.fn().mockRejectedValue(new Error('boom')),
        },
      },
    };

    await expect(readRepoFile(context, '.opencode-pro.json')).rejects.toThrow('boom');
  });
});
