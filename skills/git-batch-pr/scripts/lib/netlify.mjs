import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/** Read a Netlify token from the env or the Netlify CLI config. */
export function loadToken() {
  if (process.env.NETLIFY_AUTH_TOKEN) return process.env.NETLIFY_AUTH_TOKEN;
  const path = `${process.env.HOME}/.config/netlify/config.json`;
  if (!existsSync(path)) return null;
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    return config?.users?.[config.userId]?.auth?.token ?? null;
  } catch {
    return null;
  }
}

export async function api(path, token) {
  const response = await fetch(`https://api.netlify.com/api/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

/** `git@github.com:owner/repo.git` or `https://github.com/owner/repo.git` -> owner/repo. */
export function repoSlug(remote) {
  const match = String(remote).match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  return match ? `${match[1]}/${match[2]}` : null;
}

export function originUrl() {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export async function sitesForRepo(token) {
  const slug = repoSlug(originUrl());
  if (!slug) return [];
  const sites = await api('/sites?per_page=100', token);
  return sites.filter((site) =>
    String(site.build_settings?.repo_url ?? '')
      .toLowerCase()
      .includes(slug.toLowerCase()),
  );
}

export async function siteByIdOrName(token, ref) {
  if (/^[0-9a-f-]{36}$/i.test(ref)) return api(`/sites/${ref}`, token);
  const sites = await api(`/sites?name=${encodeURIComponent(ref)}`, token);
  if (!sites.length) throw new Error(`no Netlify site named ${ref}`);
  return sites[0];
}

export function productionUrl(site) {
  return site.ssl_url || site.url || site.custom_domain || '';
}

export function publishedSummary(site) {
  const deploy = site.published_deploy ?? {};
  return {
    site: site.name,
    id: site.id,
    url: productionUrl(site),
    deployId: deploy.id ?? null,
    sha: deploy.commit_ref ?? null,
    state: deploy.state ?? null,
    context: deploy.context ?? null,
    branch: deploy.branch ?? null,
    publishedAt: deploy.published_at ?? null,
  };
}
