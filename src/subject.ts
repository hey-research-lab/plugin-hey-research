import { CHAIN_ID, UnsupportedChainError } from './chain.js';
import { normalizeAddress } from './evm.js';

/**
 * What a message asks about, read without a model: a HEY project link, a contract address, a
 * `$TICKER`, a quoted name, or the words left once the question's own words are removed.
 *
 * A host that already knows the subject passes it in the handler's options (`project`, `address`,
 * `query`, `chainId`, `days`) and skips the reading.
 */
export type Subject =
  | { kind: 'slug'; slug: string }
  | { kind: 'address'; address: string }
  | { kind: 'query'; query: string; ticker: boolean };

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

const HEY_PROJECT_URL_RE = /heyresearch\.xyz\/project\/([a-z0-9][a-z0-9-]{0,79})(?![a-z0-9-])/i;
const ADDRESS_IN_TEXT_RE = /(?<![0-9a-zA-Z])0[xX][0-9a-fA-F]{40}(?![0-9a-zA-Z])/;
const TICKER_RE = /(?:^|[\s(,])\$([A-Za-z][A-Za-z0-9]{0,19})(?![A-Za-z0-9])/;
const QUOTED_RE = /["“”'‘’`]([^"“”'‘’`\n]{2,64})["“”'‘’`]/;

/** The question's own words: what is left after removing them is the name asked about. */
const STOPWORDS = new Set(
  `a about after again agent all also an and any anything are as ask at be been before being build
  builder builders building built but by can chain check could did do does doing done ecosystem
  evidence find for from get give go has have hey heyresearch how i in info information is it its
  itself just know last lately latest look lookup made me more most my new news of on or our
  overview please project projects recent recently release released releases research researched
  robinhood rh search see shipped shipping ship ships show so some status still tell that the
  their them there these they thing things this those timeline to today token tokens up update
  updates us was we week weeks what whats what's when where whether which who why will with
  would you your xyz contract contracts ticker history going active alive dormant quiet
  working development developing developer developers team change changed changes happened
  happening day days past month months hour hours overall summary across many lot lots much anything something nothing anyone happen
  whole`.split(/\s+/),
);

/** A project link, a contract, a ticker or a quoted name in the text, in that order. */
export function explicitSubject(text: string): Subject | undefined {
  const link = HEY_PROJECT_URL_RE.exec(text);
  if (link?.[1]) return { kind: 'slug', slug: link[1].toLowerCase() };
  const address = ADDRESS_IN_TEXT_RE.exec(text);
  if (address) return { kind: 'address', address: normalizeAddress(`0x${address[0].slice(2)}`) };
  const ticker = TICKER_RE.exec(text);
  if (ticker?.[1]) return { kind: 'query', query: ticker[1], ticker: true };
  const quoted = QUOTED_RE.exec(text);
  if (quoted?.[1] && quoted[1].trim().length >= 2) {
    return { kind: 'query', query: quoted[1].trim(), ticker: false };
  }
  return undefined;
}

/** The words of the text that are not the question's own, at most three, proper names first. */
export function leftoverWords(text: string): string | undefined {
  const words = text
    .replace(/https?:\/\/\S+/g, ' ')
    .split(/[^\p{L}\p{N}._-]+/u)
    .map((w) => w.replace(/^[._-]+|[._-]+$/g, ''))
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w.toLowerCase()) && !/^\d+$/.test(w));
  if (words.length === 0) return undefined;
  const named = words.filter((w) => /[A-Z0-9]/.test(w.slice(1)) || /^[A-Z]/.test(w));
  const chosen = (named.length > 0 && words.length > 3 ? named : words).slice(0, 3).join(' ');
  return chosen.length >= 2 && chosen.length <= 64 ? chosen : undefined;
}

export type SubjectOptions = {
  project?: unknown;
  address?: unknown;
  query?: unknown;
};

/** The subject from the handler's options first, then from the text. */
export function readSubject(text: string, options: SubjectOptions = {}): Subject | undefined {
  if (typeof options.address === 'string' && options.address.trim() !== '') {
    return { kind: 'address', address: normalizeAddress(options.address.trim()) };
  }
  if (typeof options.project === 'string' && SLUG_RE.test(options.project.trim())) {
    return { kind: 'slug', slug: options.project.trim() };
  }
  if (typeof options.query === 'string' && options.query.trim().length >= 2) {
    const query = options.query.trim().slice(0, 64);
    return query.startsWith('$')
      ? { kind: 'query', query: query.slice(1), ticker: true }
      : { kind: 'query', query, ticker: false };
  }
  const explicit = explicitSubject(text);
  if (explicit) return explicit;
  const rest = leftoverWords(text);
  return rest ? { kind: 'query', query: rest, ticker: false } : undefined;
}

const NAMED_CHAINS: Readonly<Record<string, string>> = {
  ethereum: 'Ethereum',
  'ethereum mainnet': 'Ethereum',
  solana: 'Solana',
  base: 'Base',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  polygon: 'Polygon',
  avalanche: 'Avalanche',
  bsc: 'BNB Smart Chain',
  'bnb chain': 'BNB Smart Chain',
  'bnb smart chain': 'BNB Smart Chain',
};

const CHAIN_ID_RE = /\bchain[\s_-]?id\s*[:=#]?\s*(\d{1,12})\b/i;
const CAIP2_RE = /\beip155:(\d{1,12})\b/i;
const NAMED_CHAIN_RE = new RegExp(
  `\\bon\\s+(${Object.keys(NAMED_CHAINS)
    .sort((a, b) => b.length - a.length)
    .join('|')})(?:\\s+(?:chain|network|mainnet))?(?=$|[\\s.,;:!?)])`,
  'i',
);

/**
 * Throws `unsupported_chain` when the options or the text name a chain other than Robinhood
 * Chain: a `chainId` option, a "chain id N", an `eip155:N`, or "on Ethereum" and the like.
 */
export function assertRobinhoodChain(text: string, options: { chainId?: unknown } = {}): void {
  if (options.chainId !== undefined && options.chainId !== CHAIN_ID) {
    throw new UnsupportedChainError(options.chainId);
  }
  for (const re of [CHAIN_ID_RE, CAIP2_RE]) {
    const m = re.exec(text);
    if (m?.[1] && Number(m[1]) !== CHAIN_ID) throw new UnsupportedChainError(Number(m[1]));
  }
  const named = NAMED_CHAIN_RE.exec(text);
  if (named?.[1]) {
    throw new UnsupportedChainError(NAMED_CHAINS[named[1].toLowerCase()] ?? named[1]);
  }
}

/** A window in days from the options or the text: today = 1, a week = 7, a month = 30; default 7. */
export function readDays(text: string, options: { days?: unknown } = {}): number {
  const clamp = (n: number) => Math.min(30, Math.max(1, Math.round(n)));
  if (typeof options.days === 'number' && Number.isFinite(options.days)) return clamp(options.days);
  const n = /\b(\d{1,3})\s*(?:d|days?)\b/i.exec(text);
  if (n?.[1]) return clamp(Number(n[1]));
  if (/\b(\d{1,2})\s*weeks?\b/i.test(text)) {
    return clamp(Number(/\b(\d{1,2})\s*weeks?\b/i.exec(text)?.[1] ?? 1) * 7);
  }
  if (/\b(today|24\s*h|24\s*hours?|yesterday|last day)\b/i.test(text)) return 1;
  if (/\bmonth\b/i.test(text)) return 30;
  return 7;
}
