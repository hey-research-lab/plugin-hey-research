import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Action, Content, IAgentRuntime, Memory, Plugin, State, UUID } from '@elizaos/core';

import { createHeyResearchPlugin, type FetchLike } from '../src/index.js';

export type Fixture = {
  request: { path: string; params: Record<string, string | number> };
  response: { status: number; headers: Record<string, string>; body: unknown };
};

const FIXTURES = join(import.meta.dirname, 'fixtures');

export function loadFixture(name: string): Fixture {
  const dir = name.startsWith('synthetic/') ? '' : 'live/';
  return JSON.parse(readFileSync(join(FIXTURES, `${dir}${name}.json`), 'utf8')) as Fixture;
}

export function liveIndex(): { slug: string; name: string; token: string } {
  return JSON.parse(readFileSync(join(FIXTURES, 'live', 'index.json'), 'utf8')) as {
    slug: string;
    name: string;
    token: string;
  };
}

export type Call = { url: URL; init: RequestInit | undefined };

const keyOf = (url: URL): string => {
  const sorted = new URL(url);
  sorted.searchParams.sort();
  return `${sorted.pathname}${sorted.search}`;
};

/**
 * A fetch that answers from saved fixtures and fails the test on any request no fixture recorded:
 * the path and every query parameter must match.
 */
export function fixtureFetch(names: string[], calls: Call[] = []): FetchLike {
  const routes = new Map<string, Fixture>();
  for (const name of names) {
    const fixture = loadFixture(name);
    const url = new URL(fixture.request.path, 'https://heyresearch.xyz');
    for (const [k, v] of Object.entries(fixture.request.params)) url.searchParams.set(k, String(v));
    routes.set(keyOf(url), fixture);
  }
  return async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    const fixture = routes.get(keyOf(url));
    if (!fixture) {
      throw new Error(`Unexpected request ${url.pathname}${url.search}; no fixture recorded it`);
    }
    const body =
      typeof fixture.response.body === 'string'
        ? fixture.response.body
        : JSON.stringify(fixture.response.body);
    return new Response(body, {
      status: fixture.response.status,
      headers: fixture.response.headers,
    });
  };
}

/** A runtime with only what the plugin reads: settings and a logger. */
export function fakeRuntime(settings: Record<string, string> = {}): IAgentRuntime {
  const runtime = {
    agentId: '00000000-0000-0000-0000-000000000001' as UUID,
    getSetting: (key: string) => settings[key] ?? null,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
  };
  return runtime as unknown as IAgentRuntime;
}

export function message(text: string): Memory {
  return {
    entityId: '00000000-0000-0000-0000-000000000002' as UUID,
    roomId: '00000000-0000-0000-0000-000000000003' as UUID,
    content: { text, source: 'test' },
  };
}

export const NOW = new Date('2026-10-12T20:00:00.000Z');

export function pluginWith(names: string[], calls: Call[] = []): Plugin {
  return createHeyResearchPlugin({ fetchImpl: fixtureFetch(names, calls), now: () => NOW });
}

export function actionOf(plugin: Plugin, name: string): Action {
  const action = plugin.actions?.find((a) => a.name === name);
  if (!action) throw new Error(`no action ${name}`);
  return action;
}

/** Runs an action's handler the way the runtime does, collecting what it sends back. */
export async function run(
  plugin: Plugin,
  name: string,
  text: string,
  options: Record<string, unknown> = {},
  runtime: IAgentRuntime = fakeRuntime(),
) {
  const sent: Content[] = [];
  const result = await actionOf(plugin, name).handler(
    runtime,
    message(text),
    { values: {}, data: {}, text: '' } as State,
    options,
    async (content) => {
      sent.push(content);
      return [];
    },
  );
  if (!result) throw new Error('the handler returned nothing');
  return { result, sent, text: result.text ?? '' };
}

/** Words HEY's own copy must never contain (ecosystem conventions: forbidden output words). */
export const FORBIDDEN =
  /\b(rug|rugs|scam|scams|safe|unsafe|bullish|bearish|buy|buying|sell|selling|100x|alpha|undervalued|guaranteed|smart money|whale|whales|dev wallet|users|partnership|audited|official robinhood)\b/i;

/** The plugin's own words: a source's «quoted» words and HEY's relayed note are not ours. */
export function ownWords(text: string): string {
  return text
    .replace(/«[^»]*»/g, '«»')
    .split('\n')
    .filter((l) => !l.startsWith("HEY's note:"))
    .join('\n');
}
