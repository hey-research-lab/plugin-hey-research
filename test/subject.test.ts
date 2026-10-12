import { describe, expect, it } from 'vitest';

import { assertRobinhoodChain, readDays, readSubject } from '../src/subject.js';

describe('readSubject', () => {
  it('reads a HEY project link first', () => {
    expect(readSubject('see https://heyresearch.xyz/project/agentos please')).toEqual({
      kind: 'slug',
      slug: 'agentos',
    });
  });

  it('reads a contract address in either case and lowercases it', () => {
    expect(readSubject('what is 0X6EDA83FC299C10D474068A7E69771C809BCBBBA3?')).toEqual({
      kind: 'address',
      address: '0x6eda83fc299c10d474068a7e69771c809bcbbba3',
    });
  });

  it('ignores a hex string that is not 40 digits', () => {
    expect(readSubject('tx 0x6eda83fc299c10d474068a7e69771c809bcbbba3ff')?.kind).not.toBe(
      'address',
    );
  });

  it('reads a $TICKER as a ticker query', () => {
    expect(readSubject('is $AGENTOS still building?')).toEqual({
      kind: 'query',
      query: 'AGENTOS',
      ticker: true,
    });
  });

  it('reads a quoted name', () => {
    expect(readSubject('research "Agent OS" for me')).toEqual({
      kind: 'query',
      query: 'Agent OS',
      ticker: false,
    });
  });

  it('keeps the name once the question’s own words are removed', () => {
    expect(readSubject('Is AgentOS still building?')).toEqual({
      kind: 'query',
      query: 'AgentOS',
      ticker: false,
    });
    expect(readSubject('What did musepass ship recently on Robinhood Chain?')).toEqual({
      kind: 'query',
      query: 'musepass',
      ticker: false,
    });
  });

  it('finds nothing in a question that names nothing', () => {
    expect(readSubject('What shipped on Robinhood Chain this week?')).toBeUndefined();
    expect(readSubject('is it still building?')).toBeUndefined();
  });

  it('prefers the host’s options', () => {
    expect(readSubject('Is AgentOS building?', { project: 'musepass-musepass' })).toEqual({
      kind: 'slug',
      slug: 'musepass-musepass',
    });
    expect(readSubject('x', { query: '$HEY' })).toEqual({
      kind: 'query',
      query: 'HEY',
      ticker: true,
    });
    expect(() => readSubject('x', { address: '0x123' })).toThrow(/not an EVM address/);
  });
});

describe('assertRobinhoodChain', () => {
  it('accepts Robinhood Chain and messages that name no chain', () => {
    expect(() => assertRobinhoodChain('what shipped on Robinhood Chain')).not.toThrow();
    expect(() => assertRobinhoodChain('chain id 4663', { chainId: 4663 })).not.toThrow();
    expect(() => assertRobinhoodChain('eip155:4663')).not.toThrow();
    expect(() => assertRobinhoodChain('the Base layer of the protocol')).not.toThrow();
  });

  it('refuses another chain with unsupported_chain', () => {
    for (const [text, options] of [
      ['x', { chainId: 1 }],
      ['x', { chainId: 4663.5 }],
      ['chainId: 8453', {}],
      ['eip155:1', {}],
      ['tokens on Solana', {}],
      ['projects on BNB Chain?', {}],
    ] as const) {
      expect(() => assertRobinhoodChain(text, options)).toThrow(
        expect.objectContaining({ code: 'unsupported_chain' }),
      );
    }
  });
});

describe('readDays', () => {
  it('reads the window, 1–30 days, default 7', () => {
    expect(readDays('what changed')).toBe(7);
    expect(readDays('what changed today')).toBe(1);
    expect(readDays('last 24 hours')).toBe(1);
    expect(readDays('last 3 days')).toBe(3);
    expect(readDays('past 2 weeks')).toBe(14);
    expect(readDays('this month')).toBe(30);
    expect(readDays('last 90 days')).toBe(30);
    expect(readDays('x', { days: 0 })).toBe(1);
  });
});
