import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import plugin, { ACTION_NAMES, VERSION, heyResearchPlugin } from '../src/index.js';
import { FORBIDDEN, ownWords } from './helpers.js';

const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  name: string;
  version: string;
  description: string;
  agentConfig: {
    pluginType: string;
    pluginParameters: Record<string, { required: boolean; sensitive: boolean; default?: string }>;
  };
};

describe('package', () => {
  it('keeps the version in one place', () => {
    expect(VERSION).toBe(pkg.version);
  });

  it('carries the ElizaOS registry fields', () => {
    expect(pkg.name.split('/').pop()?.startsWith('plugin-')).toBe(true);
    expect(pkg.agentConfig.pluginType).toBe('elizaos:plugin:1.0.0');
    expect(pkg.agentConfig.pluginParameters.HEY_API_KEY).toMatchObject({
      required: false,
      sensitive: true,
    });
    expect(pkg.agentConfig.pluginParameters.HEY_API_URL).toMatchObject({
      required: false,
      default: 'https://heyresearch.xyz',
    });
  });

  it('ships the registry images at their sizes', () => {
    const jpegSize = (file: string): { width: number; height: number; bytes: number } => {
      const b = readFileSync(join(root, 'images', file));
      let i = 2;
      while (i < b.length) {
        const marker = b[i + 1] ?? 0;
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xc3) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7), bytes: b.length };
        }
        i += 2 + len;
      }
      throw new Error(`no frame header in ${file}`);
    };
    const logo = jpegSize('logo.jpg');
    const banner = jpegSize('banner.jpg');
    expect([logo.width, logo.height]).toEqual([400, 400]);
    expect(logo.bytes).toBeLessThanOrEqual(500 * 1024);
    expect([banner.width, banner.height]).toEqual([1280, 640]);
    expect(banner.bytes).toBeLessThanOrEqual(1024 * 1024);
  });

  it('keeps the README and package description free of forbidden words', () => {
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    expect(ownWords(readme)).not.toMatch(FORBIDDEN);
    expect(pkg.description).not.toMatch(FORBIDDEN);
  });
});

describe('plugin', () => {
  it('exports one plugin with five actions and one provider', () => {
    expect(plugin).toBe(heyResearchPlugin);
    expect(plugin.name).toBe('hey-research');
    expect(plugin.actions?.map((a) => a.name)).toEqual(Object.values(ACTION_NAMES));
    expect(plugin.providers?.map((p) => p.name)).toEqual(['HEY_RESEARCH_CONTEXT']);
    for (const action of plugin.actions ?? []) {
      expect(action.description).toMatch(/Robinhood Chain/);
      expect(action.similes?.length).toBeGreaterThan(0);
      expect(action.examples?.length).toBeGreaterThan(0);
      for (const example of action.examples ?? []) {
        expect(example.at(-1)?.content.actions).toEqual([action.name]);
      }
    }
  });

  it('describes the research action in the words agents choose it by', () => {
    const research = plugin.actions?.find((a) => a.name === ACTION_NAMES.research);
    for (const words of [
      'still building',
      'what did it ship',
      'last ship',
      '$TICKER',
      'contract address',
      'provenance',
      'not price advice',
      'not a safety verdict',
    ]) {
      expect(research?.description).toContain(words);
    }
  });

  it('the forbidden-word check itself catches what it should', () => {
    expect(ownWords('you should buy this')).toMatch(FORBIDDEN);
    expect(ownWords('the project «says buy»')).not.toMatch(FORBIDDEN);
    expect(ownWords("HEY's note: not advice to sell")).not.toMatch(FORBIDDEN);
  });
});
