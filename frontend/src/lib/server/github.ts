import { eq, and } from 'drizzle-orm';
import { account } from '../../../db/schema/auth';
import type { Database } from './db';

const GITHUB_API = 'https://api.github.com';

export async function getGitHubAccessToken(db: Database, userId: string): Promise<string | null> {
  const rows = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'github')))
    .limit(1);

  return rows[0]?.accessToken ?? null;
}

async function ghFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      ...init?.headers,
    },
  });
  return res;
}

export type GitHubRepo = {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
};

export async function listUserRepos(token: string): Promise<GitHubRepo[]> {
  const repos: GitHubRepo[] = [];
  let page = 1;

  while (true) {
    const res = await ghFetch(token, `/user/repos?per_page=100&page=${page}&sort=updated`);
    if (!res.ok) break;

    const data = (await res.json()) as GitHubRepo[];
    if (data.length === 0) break;

    repos.push(...data);
    if (data.length < 100) break;
    page++;
  }

  return repos;
}

export type GitHubContentItem = {
  name: string;
  path: string;
  sha: string;
  type: 'file' | 'dir' | 'symlink' | 'submodule';
  size?: number;
};

export async function listRepoContents(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GitHubContentItem[]> {
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${encodedPath}${params}`);

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [data];
}

export type GitHubFileContent = {
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: string;
  size: number;
};

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<GitHubFileContent | null> {
  const params = ref ? `?ref=${encodeURIComponent(ref)}` : '';
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${encodedPath}${params}`);

  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as GitHubFileContent;
}

export function decodeBase64Content(content: string): string {
  const cleaned = content.replace(/\n/g, '');
  const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export async function getLatestCommitSha(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<string | null> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}/commits/${encodeURIComponent(branch)}?per_page=1`);
  if (!res.ok) return null;
  const data = (await res.json()) as { sha: string };
  return data.sha;
}

export async function verifyRepoAccess(
  token: string,
  owner: string,
  repo: string
): Promise<boolean> {
  const res = await ghFetch(token, `/repos/${owner}/${repo}`);
  return res.ok;
}

export async function collectMarkdownFiles(
  token: string,
  owner: string,
  repo: string,
  basePath: string,
  ref?: string
): Promise<GitHubContentItem[]> {
  const mdFiles: GitHubContentItem[] = [];

  async function walk(dirPath: string) {
    const items = await listRepoContents(token, owner, repo, dirPath, ref);
    for (const item of items) {
      if (item.type === 'file' && item.name.endsWith('.md')) {
        mdFiles.push(item);
      } else if (item.type === 'dir') {
        await walk(item.path);
      }
    }
  }

  await walk(basePath);
  return mdFiles;
}

// ── Push operations ──────────────────────────────────────────

function encodeContentToBase64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export type PutFileResult = {
  fileSha: string;
  commitSha: string;
};

export async function putFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  content: string,
  message: string,
  branch: string,
  sha?: string | null
): Promise<PutFileResult> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const body: Record<string, unknown> = {
    message,
    content: encodeContentToBase64(content),
    branch,
  };
  if (sha) {
    body.sha = sha;
  }

  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub PUT failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as {
    content: { sha: string };
    commit: { sha: string };
  };
  return { fileSha: data.content.sha, commitSha: data.commit.sha };
}

export async function deleteRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  branch: string,
  sha: string
): Promise<{ commitSha: string }> {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const res = await ghFetch(token, `/repos/${owner}/${repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha, branch }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub DELETE failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { commit: { sha: string } };
  return { commitSha: data.commit.sha };
}
