import type { IAgentRuntime, Memory, Provider, ProviderResult } from '@elizaos/core';
import type { HeyClient, HeyTokenLookup } from '@hey-research-lab/sdk';

import { CHAIN_ID, CHAIN_NAME } from './chain.js';
import { normalizeAddress } from './evm.js';
import type { HeySettings } from './settings.js';
import { bound, foldText } from './text.js';
import { day, quoteExternal } from './words.js';

/**
 * HEY_RESEARCH_CONTEXT: one short line in the agent's context when the conversation names a
 * contract or a ticker, so the agent knows HEY Research is where to check a Robinhood Chain
 * project. It makes no network call unless the message carries a 0x address; then it reads that
 * one address from HEY's token index (cached for ten minutes) and never fails the message.
 */

export const PROVIDER_NAME = 'HEY_RESEARCH_CONTEXT';

const ADDRESS_RE = /(?<![0-9a-zA-Z])0[xX][0-9a-fA-F]{40}(?![0-9a-zA-Z])/;
const TICKER_RE = /(?:^|[\s(,])\$[A-Za-z][A-Za-z0-9]{0,19}(?![A-Za-z0-9])/;
const TOPIC_RE = /\b(robinhood chain|contract address|token contract|ticker)\b/i;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;
const LOOKUP_TIMEOUT_MS = 4_000;

export const HINT =
  `HEY Research Lab (heyresearch.xyz) records which ${CHAIN_NAME} projects are still building and what they shipped, ` +
  'with evidence links. For a project, $TICKER or contract named here, the HEY_RESEARCH_PROJECT action reads it; ' +
  'HEY_FIND_PROJECTS lists matches when a ticker is ambiguous. A ticker is not identity; a contract address is. ' +
  'HEY gives evidence, not price advice or a safety verdict.';

export type ProviderDeps = {
  client: (runtime: IAgentRuntime) => { client: HeyClient; settings: HeySettings };
  now: () => Date;
};

function lookupLine(address: string, lookup: HeyTokenLookup): string {
  if (lookup.status === 'published' && lookup.project) {
    const p = lookup.project;
    const last = p.lastShipAt ? `last ship ${day(p.lastShipAt)}` : 'last ship unknown';
    const verification =
      p.tokenVerification.status === 'VERIFIED'
        ? 'the project itself names this contract'
        : p.tokenVerification.status === 'MISMATCH'
          ? "the project's own site names a different contract, so its activity is the project's, not this token's"
          : 'HEY has not seen the project name this contract';
    return (
      `HEY Research Lab has a page for ${address} on ${CHAIN_NAME}: ${quoteExternal(p.name, 80)}, ` +
      `${bound(foldText(p.activityLabel), 40).text} (${last}; ${verification}). ${p.url} — ` +
      'use HEY_RESEARCH_PROJECT for the evidence and what HEY does not know. Source: HEY Research Lab — heyresearch.xyz'
    );
  }
  const issuer = lookup.issuer
    ? ` HEY records it as: ${bound(foldText(lookup.issuer.sentence), 200).text}`
    : '';
  return (
    `HEY Research Lab has no published project for ${address} on ${CHAIN_NAME}; that is an answer about HEY's index, ` +
    `not a finding about the contract.${issuer} HEY Scan: ${lookup.scanUrl}. Source: HEY Research Lab — heyresearch.xyz`
  );
}

export function createProvider(deps: ProviderDeps): Provider {
  const cache = new Map<string, { at: number; text: string; lookup: HeyTokenLookup }>();

  const lookupCached = async (
    runtime: IAgentRuntime,
    address: string,
  ): Promise<{ text: string; lookup: HeyTokenLookup } | undefined> => {
    const now = deps.now().getTime();
    const hit = cache.get(address);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit;
    const { client } = deps.client(runtime);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const lookup = await Promise.race([
        client.token.lookup(CHAIN_ID, address),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timeout')), LOOKUP_TIMEOUT_MS);
        }),
      ]);
      const entry = { at: now, text: lookupLine(address, lookup), lookup };
      if (cache.size >= CACHE_MAX) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(address, entry);
      return entry;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    name: PROVIDER_NAME,
    description:
      'Points the agent to HEY Research Lab when the conversation names a Robinhood Chain contract or $TICKER; reads HEY’s token index only for a 0x address.',
    get: async (runtime: IAgentRuntime, message: Memory): Promise<ProviderResult> => {
      const text =
        typeof message.content?.text === 'string' ? message.content.text.slice(0, 2000) : '';
      const address = ADDRESS_RE.exec(text)?.[0];
      if (address) {
        const normalized = normalizeAddress(`0x${address.slice(2)}`);
        try {
          const entry = await lookupCached(runtime, normalized);
          if (entry) {
            return {
              text: entry.text,
              values: { heyResearchContext: entry.text },
              data: { address: normalized, chainId: CHAIN_ID, lookup: entry.lookup },
            };
          }
        } catch {
          // A failed read never fails the message; the agent still gets the pointer.
        }
        return {
          text: HINT,
          values: { heyResearchContext: HINT },
          data: { address: normalized, chainId: CHAIN_ID, lookup: null },
        };
      }
      if (TICKER_RE.test(text) || TOPIC_RE.test(text)) {
        return { text: HINT, values: { heyResearchContext: HINT }, data: { chainId: CHAIN_ID } };
      }
      return { text: '', values: {}, data: {} };
    },
  };
}
