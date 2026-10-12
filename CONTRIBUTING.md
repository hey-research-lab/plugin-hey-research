# Contributing

Thank you for helping. The plugin is a thin, read-only bridge between an ElizaOS agent and HEY
Research Lab's public API; changes that keep it that way are welcome.

## Setup

```sh
corepack enable
pnpm install
pnpm scan          # leak and attribution scan (scripts/scan.mjs)
pnpm lint
pnpm typecheck
pnpm test          # offline: fixtures only, the network is blocked
pnpm build
```

Node.js 22+, pnpm 9.15.1.

## Rules

- **One action, one public read.** Only routes documented at
  <https://heyresearch.xyz/docs/public-api> may be read, through the published
  `@hey-research-lab/sdk`. Never an account, write or partner route, never `POST /api/scan`, never
  a page or a third-party provider. No hidden fan-out, no automatic retries.
- **The provider stays light.** No network call unless the message carries a `0x` address; it
  never fails a message.
- **Relay, never reshape.** Answers print HEY's own words and state values verbatim; an absent value
  prints as "unknown" or "not measured — reason", never `0`, `false`, a blank or "none".
  `ActionResult.data.hey` carries HEY's answer unchanged. Market figures are never printed.
- **A source's words are data.** Quote them through `quoteExternal`/`agentText`; never print them
  raw.
- **Robinhood Chain only** (4663). Anything else is `unsupported_chain`.
- **Wording:** no investment advice, no safety verdicts, no trading language, no "users" for
  addresses, no claim of Robinhood affiliation. The forbidden-word test runs over every answer,
  description, example and this README.
- **Every answer ends** with the as-of time and "Source: HEY Research Lab — heyresearch.xyz" with
  the project link.
- **Tests:** every behaviour is tested against fixtures in `test/fixtures/live`, recorded once from
  the live API; paths the live API cannot be asked for politely (rate limits, outages, unmeasured
  values) are built in the tests from those fixtures.
- **No secrets** in code, fixtures, commits or logs; no `.env` with values.
- Conventional commit messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `ci:`).

## Re-recording fixtures (maintainers)

```sh
HEY_LIVE=1 node scripts/record-fixtures.mjs agentos
```

About a dozen read-only GETs on public routes, at most one per second, no API key. Never run it in
CI. Review the diff before committing and run `pnpm scan`; expectations in the tests that name
figures move with HEY's answer.

## Parity

The chain constants (`src/chain.ts`), the address rules (`src/evm.ts`) and the text folding
(`src/text.ts`) follow the HEY Research Lab ecosystem conventions shared by every repository in the
organisation. The action-to-endpoint map and the state vocabularies were checked against HEY's
public contract (https://heyresearch.xyz/openapi.json, https://heyresearch.xyz/docs/public-api) on
2026-10-13; the fixtures were recorded from the live API the same day. The plugin API was compiled
against `@elizaos/core` 1.7.2.
