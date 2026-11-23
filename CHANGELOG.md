# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

## 0.1.1 — 2026-11-24

- Security: dependency updates (the development install no longer pulls `crypto-browserify` and
  `elliptic`, GHSA-848j-6mx2-7j84; `@elizaos/core` bundles its own copy, so a pnpm override drops
  the unused package). The published package's runtime dependencies are unchanged.
- README: Install is `npm install @hey-research-lab/plugin-hey-research`; 0.1.0 has been on npm since
  2026-10-13.
- Development: vitest 4.1.12.

## 0.1.0 — 2026-10-13

First release, built against `@elizaos/core` 1.7.2 and `@hey-research-lab/sdk` 0.2.0.

- Five actions, each one read of HEY Research Lab's public API: `HEY_RESEARCH_PROJECT`
  (`/api/agent/research_project`), `HEY_FIND_PROJECTS` (`/api/search/suggest`), `HEY_WHAT_CHANGED`
  (`/api/agent/what_changed`, building only, 1–30 days), `HEY_PROJECT_SHIPS`
  (`/api/projects/{slug}/timeline?lens=build`) and `HEY_CHAIN_OVERVIEW` (`/api/chain`). A name or
  `$TICKER` is resolved through HEY's search, a contract address through `/api/token/4663/{address}`.
- One provider, `HEY_RESEARCH_CONTEXT`: a pointer to HEY when a message names a contract, a ticker
  or Robinhood Chain; a cached token-index read only for a `0x` address.
- Every answer keeps unknown as unknown, quotes a source's words, links the evidence and ends with
  the as-of time and "Source: HEY Research Lab — heyresearch.xyz" with the project link. Market
  figures are never relayed.
- Robinhood Chain (4663) only; any other chain is `unsupported_chain`. Optional settings
  `HEY_API_KEY` and `HEY_API_URL` (default `https://heyresearch.xyz`).
- ESM only, like `@elizaos/core` 1.x.
