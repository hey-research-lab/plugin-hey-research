# Security policy

## Reporting a vulnerability

Please report privately through GitHub's "Report a vulnerability" (Security → Advisories) on this
repository, or email hi@heyresearch.xyz with "security" in the subject. Do not open a public issue.
We aim to acknowledge within 3 working days. There is no bug bounty for this repository.

## Scope

The plugin is a read-only client of HEY Research Lab's public API, running inside an ElizaOS agent.

- **Network:** HTTPS GET requests to `https://heyresearch.xyz` only, or to the `HEY_API_URL` an
  operator sets (`https:`, or `http:` on localhost; no credentials, path or query). A request to
  any other origin is refused before it is sent. Redirects are not followed except a single one to
  HEY's own `/api/` path (the SDK's rule). A request is abandoned after 10 seconds (the provider's
  address lookup after 4) and an answer larger than 1 MiB is not read. No automatic retries. The
  plugin never calls `POST /api/scan`, an account route or a write route, and never fetches a URL
  found inside an answer.
- **Untrusted input:** a user's message is read for a HEY project link, a 40-digit `0x` address, a
  `$TICKER`, a quoted name or leftover words, each bounded; addresses are validated and lowercased.
  Nothing from a message reaches a URL except as an encoded query parameter or a validated path
  segment.
- **Untrusted output:** project names, release titles and other text from sources are data. They
  are stripped of control, invisible and bidirectional-override characters, HTML tags and
  chat-template tokens, folded onto one line, bounded, quoted «like this», and flagged when they read
  like an instruction to a model, so the agent can tell them from HEY's words.
- **Local system:** the plugin reads and writes no files, spawns no processes, and keeps only an
  in-memory cache of up to 200 address lookups for ten minutes.

## Handling secrets

This project never needs HEY credentials. An optional `HEY_API_KEY` is read from the agent's
settings or the environment, sent only to the configured HEY origin as a bearer token, never
logged, never written to disk, never placed in a URL and never included in an answer or error.
Never commit a `.env` with values.

## Supported versions

The latest 0.x minor receives fixes.
