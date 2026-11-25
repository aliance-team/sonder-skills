#!/usr/bin/env node
/**
 * deploy-info.mjs — print the Netlify sites connected to this repo and their
 * currently published production deploy. Read-only (GET only).
 *
 * usage: node deploy-info.mjs [--json]
 * exit: 0 found, 1 no accessible site, 2 no token.
 */
import { loadToken, sitesForRepo, publishedSummary } from './lib/netlify.mjs';

const asJson = process.argv.includes('--json');
const token = loadToken();
if (!token) {
  console.error('deploy-info: no Netlify token (NETLIFY_AUTH_TOKEN or ~/.config/netlify/config.json)');
  process.exit(2);
}

try {
  const sites = await sitesForRepo(token);
  if (!sites.length) {
    console.error('deploy-info: no accessible Netlify site builds this repository');
    process.exit(1);
  }
  const rows = sites.map(publishedSummary);
  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
  } else {
    for (const row of rows) {
      console.log(
        `${row.site}\t${row.url}\tpublished ${row.sha ? row.sha.slice(0, 7) : 'none'} ${row.state ?? ''} ${row.publishedAt ?? ''}`,
      );
    }
  }
} catch (error) {
  console.error(`deploy-info: ${error.message}`);
  process.exit(1);
}
