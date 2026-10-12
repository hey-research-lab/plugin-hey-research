import type {
  Action,
  ActionExample,
  ActionResult,
  HandlerCallback,
  HandlerOptions,
  IAgentRuntime,
  Memory,
} from '@elizaos/core';
import type { HeyClient } from '@hey-research-lab/sdk';

import { CHAIN_ID } from './chain.js';
import { HeyPluginError, toPluginError } from './client.js';
import {
  renderChain,
  renderChanges,
  renderError,
  renderNotFound,
  renderResearch,
  renderSearch,
  renderTimeline,
  type Rendered,
} from './render.js';
import { resolveProject } from './resolve.js';
import { quoteExternal } from './words.js';
import type { HeySettings } from './settings.js';
import {
  assertRobinhoodChain,
  explicitSubject,
  readDays,
  readSubject,
  type Subject,
} from './subject.js';

/** What every action needs: a HEY client for the runtime, and a clock for the as-of time. */
export type ActionDeps = {
  client: (runtime: IAgentRuntime) => { client: HeyClient; settings: HeySettings };
  now: () => Date;
};

export const ACTION_NAMES = {
  research: 'HEY_RESEARCH_PROJECT',
  find: 'HEY_FIND_PROJECTS',
  changes: 'HEY_WHAT_CHANGED',
  ships: 'HEY_PROJECT_SHIPS',
  chain: 'HEY_CHAIN_OVERVIEW',
} as const;

/**
 * What a host may pass in the handler's options when it already knows the subject:
 * `project` (a HEY slug), `address` (0x…), `query` (a name or $TICKER), `chainId` (4663 only) and
 * `days` (1–30, for HEY_WHAT_CHANGED).
 */
export type HostOptions = {
  project?: unknown;
  address?: unknown;
  query?: unknown;
  chainId?: unknown;
  days?: unknown;
};

type Work = (ctx: {
  client: HeyClient;
  settings: HeySettings;
  text: string;
  options: HostOptions;
}) => Promise<{
  rendered: Rendered;
  data: Record<string, unknown>;
  values?: Record<string, unknown>;
}>;

const textOf = (message: Memory): string =>
  typeof message.content?.text === 'string' ? message.content.text.slice(0, 2000) : '';

/**
 * Runs one read and answers once: through the callback when the host passes one, and as the
 * ActionResult. A failure is an answer too: HEY's code and message, never a stack.
 */
function handlerFor(name: string, deps: ActionDeps, work: Work): Action['handler'] {
  return async (
    runtime: IAgentRuntime,
    message: Memory,
    _state,
    options?: HandlerOptions,
    callback?: HandlerCallback,
  ): Promise<ActionResult> => {
    const text = textOf(message);
    const opts: HostOptions = {
      project: options?.project,
      address: options?.address,
      query: options?.query,
      chainId: options?.chainId,
      days: options?.days,
    };
    let baseUrl = 'https://heyresearch.xyz';
    try {
      const { client, settings } = deps.client(runtime);
      baseUrl = settings.baseUrl;
      assertRobinhoodChain(text, opts);
      const { rendered, data, values } = await work({ client, settings, text, options: opts });
      if (callback) {
        await callback({ text: rendered.text, actions: [name], source: message.content?.source });
      }
      return {
        success: true,
        text: rendered.text,
        values: { ...values, heyLink: rendered.link, heyChainId: CHAIN_ID },
        data: {
          actionName: name,
          chainId: CHAIN_ID,
          source: { name: 'HEY Research Lab', url: baseUrl, fetchedAt: deps.now().toISOString() },
          ...data,
        },
      };
    } catch (raw) {
      const error = toPluginError(raw);
      const rendered = renderError(error, baseUrl);
      if (callback) {
        await callback({ text: rendered.text, actions: [name], source: message.content?.source });
      }
      return {
        success: false,
        text: rendered.text,
        error: error.code,
        data: {
          actionName: name,
          chainId: CHAIN_ID,
          error: {
            code: error.code,
            message: error.message,
            retryable: error.retryable,
            ...(error.requestId ? { requestId: error.requestId } : {}),
            ...(error.retryAfterSeconds !== undefined
              ? { retryAfterSeconds: error.retryAfterSeconds }
              : {}),
          },
        },
      };
    }
  };
}

function requireSubject(text: string, options: HostOptions): Subject {
  const subject = readSubject(text, options);
  if (!subject) {
    throw new HeyPluginError(
      'missing_subject',
      'Name the project, its $TICKER or its contract address (0x…) on Robinhood Chain.',
    );
  }
  return subject;
}

const ADDRESS_OR_TICKER_RE =
  /0[xX][0-9a-fA-F]{40}|\$[A-Za-z][A-Za-z0-9]{0,19}\b|heyresearch\.xyz\/project\//;
const has = (re: RegExp) => async (_runtime: IAgentRuntime, message: Memory) =>
  re.test(textOf(message)) || ADDRESS_OR_TICKER_RE.test(textOf(message));

const user = (text: string): ActionExample => ({ name: '{{name1}}', content: { text } });
const agent = (text: string, action: string): ActionExample => ({
  name: '{{agentName}}',
  content: { text, actions: [action] },
});

export function createActions(deps: ActionDeps): Action[] {
  const research: Action = {
    name: ACTION_NAMES.research,
    similes: [
      'HEY_RESEARCH',
      'RESEARCH_ROBINHOOD_CHAIN_PROJECT',
      'CHECK_PROJECT_BUILDING',
      'IS_PROJECT_STILL_BUILDING',
      'CHECK_TOKEN_PROJECT',
      'CHECK_CONTRACT_PROJECT',
    ],
    description:
      'Research one Robinhood Chain project on HEY Research Lab by project name, $TICKER or contract address (0x…): is it still building, what did it ship and when (last ship), its activity status, Build Momentum and Still Building, its token and whether the project names that contract, and what HEY does not know. Returns evidence with provenance (evidence ids, receipt links, as-of time, the heyresearch.xyz project page). It is not price advice, not a safety verdict and not a recommendation.',
    validate: has(
      /\b(research|building|built|ship|shipped|shipping|project|token|contract|builder|hey|dev|developing|active|dormant)\b/i,
    ),
    handler: handlerFor(
      ACTION_NAMES.research,
      deps,
      async ({ client, settings, text, options }) => {
        const resolved = await resolveProject(client, requireSubject(text, options));
        if (!resolved.found) {
          return {
            rendered: renderNotFound(resolved, settings.baseUrl, deps.now().toISOString()),
            data: { found: false, lookup: resolved.lookup, search: resolved.search },
          };
        }
        const answer = await client.agent.answer('research_project', { project: resolved.slug });
        return {
          rendered: renderResearch(answer, settings.baseUrl, resolved),
          data: {
            found: answer.status === 'ok',
            slug: resolved.slug,
            via: resolved.via,
            alternatives: resolved.alternatives,
            hey: answer,
          },
          values: { heyProjectSlug: resolved.slug },
        };
      },
    ),
    examples: [
      [
        user('Is AgentOS still building?'),
        agent('Checking HEY Research for AgentOS on Robinhood Chain.', ACTION_NAMES.research),
      ],
      [
        user('What do we know about 0x6eda83fc299c10d474068a7e69771c809bcbbba3?'),
        agent('Looking that contract up on HEY Research.', ACTION_NAMES.research),
      ],
      [
        user('Did the team behind $AGENTOS ship anything lately?'),
        agent('Reading HEY’s record of what they shipped.', ACTION_NAMES.research),
      ],
    ],
  };

  const find: Action = {
    name: ACTION_NAMES.find,
    similes: [
      'HEY_SEARCH',
      'SEARCH_ROBINHOOD_CHAIN_PROJECTS',
      'FIND_PROJECT_BY_TICKER',
      'LOOKUP_TICKER',
      'WHICH_PROJECT_IS_THIS',
    ],
    description:
      'Find Robinhood Chain projects on HEY Research Lab by name, $TICKER or contract address and list the matches with their contract and heyresearch.xyz link. Use it when a name or ticker is ambiguous: tickers are not identity, a contract address is. Launch records HEY has not researched are listed apart, never as projects. Search results, not an endorsement.',
    validate: has(
      /\b(find|search|look ?up|which project|what project|ticker|contract|called|named)\b/i,
    ),
    handler: handlerFor(ACTION_NAMES.find, deps, async ({ client, settings, text, options }) => {
      const subject = requireSubject(text, options);
      const q =
        subject.kind === 'address'
          ? subject.address
          : subject.kind === 'slug'
            ? subject.slug
            : subject.query;
      const search = await client.search.suggest(q);
      return {
        rendered: renderSearch(search, settings.baseUrl, deps.now().toISOString()),
        data: { hey: search },
      };
    }),
    examples: [
      [
        user('Find projects called AgentOS on Robinhood Chain'),
        agent('Searching HEY Research.', ACTION_NAMES.find),
      ],
      [
        user('Which project is $AGENTOS?'),
        agent('Here is what HEY’s search matches for that ticker.', ACTION_NAMES.find),
      ],
    ],
  };

  const changes: Action = {
    name: ACTION_NAMES.changes,
    similes: [
      'HEY_WHATS_NEW',
      'ROBINHOOD_CHAIN_RECENT_SHIPS',
      'WHAT_SHIPPED_RECENTLY',
      'RECENT_BUILDER_ACTIVITY',
    ],
    description:
      'What changed recently on Robinhood Chain, or for one named project: releases, code activity, contract deployments and other building that HEY Research Lab recorded in the last 1–30 days (default 7; "today" is 1), newest first, with true totals, dates at their precision and evidence links. Building evidence only, not market moves, not price advice.',
    validate: has(
      /\b(change|changed|changes|new|latest|recent|recently|update|updates|shipped|happen|happened|happening|today|this week)\b/i,
    ),
    handler: handlerFor(ACTION_NAMES.changes, deps, async ({ client, settings, text, options }) => {
      const days = readDays(text, options);
      // Only a subject the message names explicitly narrows the answer to a project; loose
      // leftover words that match nothing fall back to the chain-wide answer, said so.
      const subject = readSubject(text, options);
      let project: string | undefined;
      let note: string | undefined;
      if (subject) {
        const named = Boolean(
          explicitSubject(text) || options.project || options.address || options.query,
        );
        const resolved = await resolveProject(client, subject);
        if (resolved.found && (named || resolved.exact)) project = resolved.slug;
        else if (!resolved.found && named) {
          return {
            rendered: renderNotFound(resolved, settings.baseUrl, deps.now().toISOString()),
            data: { found: false, lookup: resolved.lookup, search: resolved.search },
          };
        } else {
          note = `HEY's search has no published project named exactly ${quoteExternal(subject.kind === 'query' ? subject.query : '', 64)}, so this is the chain-wide answer.`;
        }
      }
      const answer = await client.agent.answer('what_changed', {
        ...(project ? { project } : {}),
        days,
        limit: 8,
        building: 'only',
      });
      const rendered = renderChanges(answer, settings.baseUrl);
      if (note) rendered.text = `${note}\n${rendered.text}`;
      return {
        rendered,
        data: { project: project ?? null, days, hey: answer },
        values: project ? { heyProjectSlug: project } : {},
      };
    }),
    examples: [
      [
        user('What shipped on Robinhood Chain this week?'),
        agent('Here is HEY’s record of the week.', ACTION_NAMES.changes),
      ],
      [
        user('Anything new from AgentOS in the last 30 days?'),
        agent('Reading HEY’s change ledger for AgentOS.', ACTION_NAMES.changes),
      ],
    ],
  };

  const ships: Action = {
    name: ACTION_NAMES.ships,
    similes: [
      'HEY_PROJECT_TIMELINE',
      'PROJECT_RELEASES',
      'PROJECT_SHIP_HISTORY',
      'WHAT_DID_PROJECT_SHIP',
    ],
    description:
      "A Robinhood Chain project's ships and building timeline from HEY Research Lab, by name, $TICKER or contract address: releases, code activity weeks and contract deployments, newest first, each with its date precision, verification state (self-reported stays distinct from verified), source link and evidence receipt. Evidence of building, not of price.",
    validate: has(
      /\b(ship|ships|shipped|release|releases|timeline|history|commits?|deploy|deployed|deployments?|built)\b/i,
    ),
    handler: handlerFor(ACTION_NAMES.ships, deps, async ({ client, settings, text, options }) => {
      const resolved = await resolveProject(client, requireSubject(text, options));
      if (!resolved.found) {
        return {
          rendered: renderNotFound(resolved, settings.baseUrl, deps.now().toISOString()),
          data: { found: false, lookup: resolved.lookup, search: resolved.search },
        };
      }
      const timeline = await client.projects.timeline(resolved.slug, { lens: 'build', limit: 8 });
      return {
        rendered: renderTimeline(timeline, settings.baseUrl, deps.now().toISOString(), resolved),
        data: { found: true, slug: resolved.slug, via: resolved.via, hey: timeline },
        values: { heyProjectSlug: resolved.slug },
      };
    }),
    examples: [
      [
        user('Show me what AgentOS has shipped'),
        agent('Here is HEY’s timeline for AgentOS.', ACTION_NAMES.ships),
      ],
      [
        user('Release history for $AGENTOS?'),
        agent('Reading the ships HEY recorded.', ACTION_NAMES.ships),
      ],
    ],
  };

  const chain: Action = {
    name: ACTION_NAMES.chain,
    similes: [
      'HEY_CHAIN_PULSE',
      'ROBINHOOD_CHAIN_OVERVIEW',
      'ROBINHOOD_CHAIN_ACTIVITY',
      'HOW_MANY_BUILDERS',
    ],
    description:
      'A short overview of Robinhood Chain from HEY Research Lab for the last complete days: ships recorded, projects shipping, projects published, Verified Builders, and chain activity counts (transactions, transfers, token launches). Aggregates only, with dates and their basis; no addresses, no rankings, no price advice.',
    validate: has(/\b(robinhood chain|chain|ecosystem|overview|pulse|how many|activity|stats)\b/i),
    handler: handlerFor(ACTION_NAMES.chain, deps, async ({ client, settings }) => {
      const overview = await client.chain({ days: 7 });
      return {
        rendered: renderChain(overview, settings.baseUrl, deps.now().toISOString()),
        data: { hey: overview },
      };
    }),
    examples: [
      [
        user('How is Robinhood Chain doing for builders?'),
        agent('Here is HEY’s overview of the last days.', ACTION_NAMES.chain),
      ],
      [
        user('Give me a Robinhood Chain overview'),
        agent('Reading HEY’s chain overview.', ACTION_NAMES.chain),
      ],
    ],
  };

  return [research, find, changes, ships, chain];
}
