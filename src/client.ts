import type { IAgentRuntime } from '@elizaos/core';
import { HeyApiError, HeyClient, type FetchLike } from '@hey-research-lab/sdk';

import { UnsupportedChainError } from './chain.js';
import { HeySettingError, readSettings, type HeySettings } from './settings.js';
import { INTEGRATION } from './version.js';

/**
 * The plugin's only door to HEY: read-only GETs on HEY's public API through the published
 * `@hey-research-lab/sdk`. Never `POST /api/scan`, never an account, alert or write route, never a
 * page, never a third-party provider.
 */

export type { FetchLike };

/** The most bytes of one HEY answer the plugin reads. */
export const MAX_RESPONSE_BYTES = 1024 * 1024;
export const HEY_TIMEOUT_MS = 10_000;

/** A failure, with HEY's own code when it gave one. The message never carries the API key. */
export class HeyPluginError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly requestId: string | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly status: number | undefined;
  constructor(
    code: string,
    message: string,
    options: {
      retryable?: boolean;
      requestId?: string | undefined;
      retryAfterSeconds?: number | undefined;
      status?: number | undefined;
    } = {},
  ) {
    super(message);
    this.name = 'HeyPluginError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
    this.retryAfterSeconds = options.retryAfterSeconds;
    this.status = options.status;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const REQUEST_ID_RE = /^[A-Za-z0-9-]{1,100}$/;
const CODE_RE = /^[a-z][a-z0-9_]{0,60}$/;

/** Maps anything thrown on the way to HEY to one HeyPluginError with HEY's own words. */
export function toPluginError(error: unknown): HeyPluginError {
  if (error instanceof HeyPluginError) return error;
  if (error instanceof UnsupportedChainError) return new HeyPluginError(error.code, error.message);
  if (error instanceof HeySettingError) return new HeyPluginError(error.code, error.message);
  if (error instanceof HeyApiError) {
    const body = isRecord(error.body) ? error.body : undefined;
    let code: string = error.code;
    let message = error.message;
    if (body && typeof body.error === 'string' && CODE_RE.test(body.error)) {
      code = body.error;
      if (typeof body.message === 'string') message = body.message;
    } else if (body && isRecord(body.error) && typeof body.error.code === 'string') {
      // The agent contract's refusal envelope: `error: { code, message: { text } }`.
      if (CODE_RE.test(body.error.code)) code = body.error.code;
      const text = isRecord(body.error.message) ? body.error.message.text : undefined;
      if (typeof text === 'string') message = text;
    }
    const requestId =
      body && typeof body.requestId === 'string' && REQUEST_ID_RE.test(body.requestId)
        ? body.requestId
        : undefined;
    const retryable =
      body && typeof body.retryable === 'boolean'
        ? body.retryable
        : ['rate_limited', 'unavailable', 'network', 'timeout'].includes(error.code) ||
          (error.status !== undefined && error.status >= 500);
    return new HeyPluginError(code, message, {
      retryable,
      requestId,
      retryAfterSeconds: error.retryAfterSeconds,
      status: error.status,
    });
  }
  return new HeyPluginError('internal_error', 'The HEY plugin could not complete this read.');
}

/**
 * A fetch that only talks to the configured HEY origin and reads at most `MAX_RESPONSE_BYTES` of
 * an answer. The SDK already refuses redirects to other hosts; this keeps a misbehaving answer from
 * exhausting the agent's memory.
 */
export function boundedFetch(base: string, fetchImpl: FetchLike): FetchLike {
  const origin = new URL(base).origin;
  return async (input, init) => {
    if (new URL(input).origin !== origin) {
      throw new Error('refused a request outside the configured HEY origin');
    }
    const response = await fetchImpl(input, init);
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('HEY answer larger than the plugin reads');
    }
    if (!response.body) return response;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('HEY answer larger than the plugin reads');
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // A 3xx keeps its status and Location so the SDK can apply its own redirect rule.
    const nullBody = [101, 204, 205, 304].includes(response.status);
    return new Response(nullBody ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

export function createHeyClient(settings: HeySettings, fetchImpl?: FetchLike): HeyClient {
  return new HeyClient({
    baseUrl: settings.baseUrl,
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
    fetchImpl: boundedFetch(
      settings.baseUrl,
      fetchImpl ?? ((input, init) => globalThis.fetch(input, init)),
    ),
    timeoutMs: HEY_TIMEOUT_MS,
    userAgent: INTEGRATION,
    integration: INTEGRATION,
  });
}

/** One client per agent runtime and settings; rebuilt when an operator changes a setting. */
export function clientCache(fetchImpl?: FetchLike): (runtime: IAgentRuntime) => {
  client: HeyClient;
  settings: HeySettings;
} {
  const cache = new WeakMap<object, { key: string; client: HeyClient; settings: HeySettings }>();
  return (runtime) => {
    const settings = readSettings(runtime);
    const key = `${settings.baseUrl}\u0000${settings.apiKey ?? ''}`;
    const hit = cache.get(runtime);
    if (hit && hit.key === key) return { client: hit.client, settings: hit.settings };
    const client = createHeyClient(settings, fetchImpl);
    cache.set(runtime, { key, client, settings });
    return { client, settings };
  };
}
