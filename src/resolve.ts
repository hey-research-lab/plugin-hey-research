import type {
  HeyClient,
  HeySearchSuggestion,
  HeySearchSuggestions,
  HeyTokenLookup,
} from '@hey-research-lab/sdk';

import { CHAIN_ID } from './chain.js';
import type { Subject } from './subject.js';

/** A project HEY publishes, found from a slug, a contract or a name. */
export type Resolved =
  | {
      found: true;
      slug: string;
      /** How the slug was found, so the answer can say it. */
      via: 'slug' | 'token' | 'search';
      /** False when the search's first project was taken without an exact name, ticker or slug match. */
      exact: boolean;
      /** Other published projects the search matched, for the agent to mention. */
      alternatives: { name: string; slug: string; symbol?: string }[];
      lookup?: HeyTokenLookup;
      search?: HeySearchSuggestions;
    }
  | {
      found: false;
      subject: Subject;
      lookup?: HeyTokenLookup;
      search?: HeySearchSuggestions;
    };

type ProjectSuggestion = Extract<HeySearchSuggestion, { type: 'project' }>;

/** The slug of a project suggestion, from its `/project/<slug>` target. */
export function suggestionSlug(s: ProjectSuggestion): string | undefined {
  const m = /^\/project\/([a-z0-9][a-z0-9-]{0,79})$/.exec(s.target);
  return m?.[1];
}

/**
 * Turns what the message names into a published project's slug with one read: a contract through
 * `GET /api/token/4663/{address}`, a name or ticker through `GET /api/search/suggest`. A slug is used
 * as given. Nothing found is an answer about HEY's index, never about the project.
 */
export async function resolveProject(client: HeyClient, subject: Subject): Promise<Resolved> {
  if (subject.kind === 'slug')
    return { found: true, slug: subject.slug, via: 'slug', exact: true, alternatives: [] };
  if (subject.kind === 'address') {
    const lookup = await client.token.lookup(CHAIN_ID, subject.address);
    if (lookup.status === 'published' && lookup.project) {
      return {
        found: true,
        slug: lookup.project.slug,
        via: 'token',
        exact: true,
        alternatives: [],
        lookup,
      };
    }
    return { found: false, subject, lookup };
  }
  const search = await client.search.suggest(subject.query);
  const projects = search.suggestions.filter(
    (s): s is ProjectSuggestion => s.type === 'project' && suggestionSlug(s) !== undefined,
  );
  const q = subject.query.toLowerCase();
  const exact = projects.find((s) =>
    subject.ticker
      ? s.symbol?.toLowerCase() === q
      : s.name.toLowerCase() === q || s.symbol?.toLowerCase() === q || suggestionSlug(s) === q,
  );
  const chosen = exact ?? projects[0];
  if (!chosen) return { found: false, subject, search };
  const alternatives = projects
    .filter((s) => s !== chosen)
    .slice(0, 3)
    .map((s) => ({
      name: s.name,
      slug: suggestionSlug(s) as string,
      ...(s.symbol ? { symbol: s.symbol } : {}),
    }));
  return {
    found: true,
    slug: suggestionSlug(chosen) as string,
    via: 'search',
    exact: exact !== undefined,
    alternatives,
    search,
  };
}
