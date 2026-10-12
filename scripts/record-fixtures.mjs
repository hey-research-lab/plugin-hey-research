#!/usr/bin/env node
// Records the test fixtures from HEY's live public API. Maintainers only; never run in CI.
//
//   HEY_LIVE=1 node scripts/record-fixtures.mjs [slug]
//
// Read-only GETs on the public routes the plugin uses, one at a time, at most one request per
// second, no API key. Each fixture keeps the request, the status, a small header allowlist and
// the body, unchanged. The project is the newest ship's project unless a slug is given; the
// chosen identifiers are written to test/fixtures/live/index.json.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

if (process.env.HEY_LIVE !== '1') {
  console.error('Refusing to call the live API without HEY_LIVE=1.');
  process.exit(2);
}

const BASE = 'https://heyresearch.xyz';
const OUT = join(import.meta.dirname, '..', 'test', 'fixtures', 'live');
const KEEP_HEADERS = ['content-type', 'x-request-id', 'x-hey-api-version', 'retry-after'];
const UA = 'plugin-hey-research-fixture-recorder/0.1.0';
mkdirSync(OUT, { recursive: true });

let last = 0;
async function record(name, path, params = {}) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    redirect: 'manual',
    headers: { accept: 'application/json', 'user-agent': UA },
  });
  const headers = {};
  for (const h of KEEP_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) headers[h] = v;
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  const fixture = { request: { path, params }, response: { status: res.status, headers, body } };
  if (name) writeFileSync(join(OUT, `${name}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${res.status} ${url.pathname}${url.search}${name ? ` -> ${name}.json` : ''}`);
  return body;
}

let slug = process.argv[2];
if (!slug) {
  const ships = await record(null, '/api/ships', { limit: 1 });
  slug = ships.items[0].project.slug;
}
const research = await record('research', '/api/agent/research_project', { project: slug });
const token = research.data?.contractIdentity?.token?.address ?? null;
const name = research.data?.identity?.name?.text ?? slug;
await record('research-not-found', '/api/agent/research_project', {
  project: 'hey-plugin-no-such-project',
});
await record('search', '/api/search/suggest', { q: name.slice(0, 24) });
await record('search-empty', '/api/search/suggest', { q: 'zzqxv-no-such-name' });
if (token) await record('token', `/api/token/4663/${token}`);
const nobody = '0x0000000000000000000000000000000000000001';
await record('token-unknown', `/api/token/4663/${nobody}`);
await record('changes-chain', '/api/agent/what_changed', { days: 7, limit: 8, building: 'only' });
await record('changes-project', '/api/agent/what_changed', {
  project: slug,
  days: 30,
  limit: 8,
  building: 'only',
});
await record('timeline', `/api/projects/${encodeURIComponent(slug)}/timeline`, {
  lens: 'build',
  limit: 8,
});
await record('timeline-not-found', '/api/projects/hey-plugin-no-such-project/timeline', {
  lens: 'build',
  limit: 8,
});
await record('chain', '/api/chain', { days: 7 });

writeFileSync(
  join(OUT, 'index.json'),
  `${JSON.stringify({ recordedAt: new Date().toISOString(), base: BASE, slug, name, token }, null, 2)}\n`,
);
