import type { IAgentRuntime, Plugin } from '@elizaos/core';

import { createActions } from './actions.js';
import { clientCache, type FetchLike } from './client.js';
import { createProvider } from './provider.js';
import { readSettings } from './settings.js';

export { ACTION_NAMES, createActions, type ActionDeps } from './actions.js';
export { createProvider, PROVIDER_NAME, HINT } from './provider.js';
export { HeyPluginError, toPluginError, type FetchLike } from './client.js';
export { DEFAULT_API_URL, HeySettingError, parseApiUrl, readSettings } from './settings.js';
export { CAIP2, CHAIN_ID, CHAIN_NAME, UnsupportedChainError, assertChainId } from './chain.js';
export { VERSION } from './version.js';

export type HeyResearchPluginOptions = {
  /** A fetch for HEY's API; the global one by default. Tests pass a stub over saved fixtures. */
  fetchImpl?: FetchLike;
  /** The clock for as-of times; `new Date()` by default. */
  now?: () => Date;
};

/**
 * The HEY Research plugin: read-only answers from HEY Research Lab's public API about Robinhood
 * Chain projects — still building, what shipped, what changed, what HEY does not know — with the
 * evidence links. No API key is required (`HEY_API_KEY` only lifts the anonymous rate limit).
 */
export function createHeyResearchPlugin(options: HeyResearchPluginOptions = {}): Plugin {
  const deps = { client: clientCache(options.fetchImpl), now: options.now ?? (() => new Date()) };
  return {
    name: 'hey-research',
    description:
      'Robinhood Chain builder research from HEY Research Lab: is a project still building, what did it ship, what changed recently and what HEY does not know, by name, $TICKER or contract address, with evidence links. Read-only; not price advice or a safety verdict.',
    init: async (_config: Record<string, string>, runtime: IAgentRuntime) => {
      // Fails the agent's start on an unusable HEY_API_URL rather than on its first question.
      readSettings(runtime);
    },
    actions: createActions(deps),
    providers: [createProvider(deps)],
  };
}

export const heyResearchPlugin: Plugin = createHeyResearchPlugin();

export default heyResearchPlugin;
