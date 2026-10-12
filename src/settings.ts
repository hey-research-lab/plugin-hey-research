import type { IAgentRuntime } from '@elizaos/core';

/** HEY's public API. The only host the plugin talks to unless an operator points it elsewhere. */
export const DEFAULT_API_URL = 'https://heyresearch.xyz';

export type HeySettings = {
  /** The origin of HEY's public API, without a trailing slash. */
  baseUrl: string;
  /** Optional. Lifts the anonymous rate limit and nothing else; never logged or printed. */
  apiKey: string | undefined;
};

/** A setting the plugin cannot use, with the setting's name; never the value. */
export class HeySettingError extends Error {
  readonly code = 'invalid_setting';
  constructor(
    readonly setting: string,
    message: string,
  ) {
    super(message);
    this.name = 'HeySettingError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** One setting, from the agent's settings first, then the process environment. */
function readSetting(runtime: Pick<IAgentRuntime, 'getSetting'>, key: string): string | undefined {
  const fromRuntime = runtime.getSetting(key);
  const value =
    typeof fromRuntime === 'string' && fromRuntime.trim() !== ''
      ? fromRuntime
      : typeof process !== 'undefined'
        ? process.env[key]
        : undefined;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * `HEY_API_URL` must be `https:`, or `http:` on this machine (a local HEY for testing). It may not
 * carry credentials, a query or a fragment; only its origin is used.
 */
export function parseApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HeySettingError('HEY_API_URL', 'HEY_API_URL is not a URL.');
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new HeySettingError(
      'HEY_API_URL',
      'HEY_API_URL must use https: (http: is allowed only for localhost).',
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HeySettingError(
      'HEY_API_URL',
      'HEY_API_URL may not carry credentials, a query or a fragment.',
    );
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new HeySettingError('HEY_API_URL', 'HEY_API_URL must be an origin, with no path.');
  }
  return url.origin;
}

export function readSettings(runtime: Pick<IAgentRuntime, 'getSetting'>): HeySettings {
  const rawUrl = readSetting(runtime, 'HEY_API_URL');
  return {
    baseUrl: rawUrl ? parseApiUrl(rawUrl) : DEFAULT_API_URL,
    apiKey: readSetting(runtime, 'HEY_API_KEY'),
  };
}
