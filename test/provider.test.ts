import type { State } from '@elizaos/core';
import { describe, expect, it } from 'vitest';

import { createHeyResearchPlugin, HINT, PROVIDER_NAME } from '../src/index.js';
import {
  FORBIDDEN,
  NOW,
  fakeRuntime,
  liveIndex,
  message,
  ownWords,
  pluginWith,
  type Call,
} from './helpers.js';

const STATE = { values: {}, data: {}, text: '' } as State;
const { token, slug } = liveIndex();

function provider(plugin = pluginWith(['token', 'token-unknown'])) {
  const p = plugin.providers?.find((x) => x.name === PROVIDER_NAME);
  if (!p) throw new Error('no provider');
  return p;
}

describe(PROVIDER_NAME, () => {
  it('adds nothing and calls nothing when the message names no contract or ticker', async () => {
    const calls: Call[] = [];
    const result = await provider(pluginWith([], calls)).get(
      fakeRuntime(),
      message('good morning'),
      STATE,
    );
    expect(result.text).toBe('');
    expect(calls).toHaveLength(0);
  });

  it('points to HEY for a ticker without a network call', async () => {
    const calls: Call[] = [];
    const result = await provider(pluginWith([], calls)).get(
      fakeRuntime(),
      message('anyone looked at $AGENTOS?'),
      STATE,
    );
    expect(result.text).toBe(HINT);
    expect(result.text).toContain('heyresearch.xyz');
    expect(calls).toHaveLength(0);
  });

  it('reads a 0x address from HEY’s token index once, then from its cache', async () => {
    const calls: Call[] = [];
    const p = provider(pluginWith(['token'], calls));
    const runtime = fakeRuntime();
    const first = await p.get(runtime, message(`thoughts on ${token}?`), STATE);
    const second = await p.get(
      runtime,
      message(`and ${token.toUpperCase().replace('0X', '0x')} again`),
      STATE,
    );
    expect(calls).toHaveLength(1);
    expect(first.text).toBe(second.text);
    expect(first.text).toContain(
      `HEY Research Lab has a page for ${token} on Robinhood Chain: «AgentOS», Shipping`,
    );
    expect(first.text).toContain('the project itself names this contract');
    expect(first.text).toContain(`https://heyresearch.xyz/project/${slug}`);
    expect(first.text).toContain('Source: HEY Research Lab — heyresearch.xyz');
    expect(first.data).toMatchObject({ address: token, chainId: 4663 });
  });

  it('says HEY has no project for an unknown address, as a reading of its index', async () => {
    const nobody = '0x0000000000000000000000000000000000000001';
    const result = await provider().get(fakeRuntime(), message(`what is ${nobody}`), STATE);
    expect(result.text).toContain(
      `HEY Research Lab has no published project for ${nobody} on Robinhood Chain`,
    );
    expect(result.text).toContain(`https://heyresearch.xyz/scan/${nobody}`);
  });

  it('never fails the message when HEY cannot be read', async () => {
    const plugin = createHeyResearchPlugin({
      fetchImpl: async () => {
        throw new TypeError('fetch failed');
      },
      now: () => NOW,
    });
    const result = await provider(plugin).get(fakeRuntime(), message(`what is ${token}`), STATE);
    expect(result.text).toBe(HINT);
    expect(result.data).toMatchObject({ lookup: null });
  });

  it('uses no forbidden word', async () => {
    const result = await provider().get(fakeRuntime(), message(`what is ${token}`), STATE);
    expect(ownWords(result.text ?? '')).not.toMatch(FORBIDDEN);
    expect(HINT).not.toMatch(FORBIDDEN);
  });
});
