import type {
  HeyAgentChange,
  HeyAgentResponseOf,
  HeyChain,
  HeySearchSuggestions,
  HeyTimeline,
} from '@hey-research-lab/sdk';

import { CHAIN_ID, CHAIN_NAME } from './chain.js';
import type { HeyPluginError } from './client.js';
import type { Resolved } from './resolve.js';
import { suggestionSlug } from './resolve.js';
import { bound, foldText } from './text.js';
import {
  activityWords,
  agentText,
  day,
  evidenceUrl,
  footer,
  projectUrl,
  quoteExternal,
  RESEARCH_LEVEL_WORDS,
  STILL_BUILDING_WORDS,
  TOKEN_VERIFICATION_WORDS,
  unknownLine,
  when,
} from './words.js';

/**
 * Plain-text answers for an agent's conversation. Every answer leads with HEY's one-line answer,
 * keeps unknown as unknown, links the evidence and ends with the as-of time and
 * "Source: HEY Research Lab — heyresearch.xyz" with the project link. Market figures are never
 * relayed: market is context on HEY, never building evidence, and the link carries it.
 */

export type Rendered = { text: string; link: string | undefined };

const join = (lines: (string | undefined)[]): string =>
  lines.filter((l): l is string => l !== undefined).join('\n');

/** One change-ledger event: date at its precision, summary, verification, evidence receipt. */
function changeLine(c: HeyAgentChange, baseUrl: string): string {
  const summary = agentText(c.summary, 280) ?? c.type;
  const verification = c.verification ? ` [${c.verification}]` : '';
  const counts = c.countsAsBuilding ? '' : ' (context, not counted as building)';
  const evidence = c.evidence[0];
  const receipt = evidence
    ? ` — evidence ${evidence.id}: ${evidence.receiptUrl || evidenceUrl(baseUrl, evidence.id)}`
    : '';
  return `- ${when(c.occurredAt, c.precision, c.detectedAt)}: ${summary}${verification}${counts}${receipt}`;
}

const LATEST_CHANGE_REASON: Readonly<Record<string, string>> = {
  not_in_recent_changes:
    'HEY holds meaningful building for this project, but none of it is among the newest changes listed',
  none_recorded: 'HEY has recorded no meaningful building for this project',
  changes_unavailable: "HEY's change ledger could not be read for this answer",
};

const STILL_BUILDING_REASON: Readonly<Record<string, string>> = {
  no_token: 'the project has no tracked token',
  market_too_thin: 'the market is too thin to measure a drawdown',
  market_not_live: 'the market is not live',
  token_not_the_projects: "the token is not the project's own",
  valuation_not_plausible: 'the valuation reading is not plausible',
  active_pool_not_read: 'the active pool has no current reading',
  no_market_reading: 'there is no current market reading',
  activity_unknown: 'building HEY cannot read',
  not_scored: 'no score under the current rules',
};

export function renderResearch(
  answer: HeyAgentResponseOf<'research_project'>,
  baseUrl: string,
  resolved?: Extract<Resolved, { found: true }>,
): Rendered {
  const project = answer.subject?.project;
  const link =
    answer.links.page ??
    project?.url ??
    (resolved ? projectUrl(baseUrl, resolved.slug) : undefined);
  if (answer.status !== 'ok' || !answer.data) {
    const message =
      agentText(answer.error?.message) ?? agentText(answer.answer) ?? 'HEY did not answer.';
    return {
      text: join([
        `HEY Research: ${message}`,
        `Status: ${answer.status}${answer.error?.code ? ` (${answer.error.code})` : ''}. This is an answer about HEY's records, not a finding about the project.`,
        ...footer({
          baseUrl,
          asOf: answer.asOf,
          link,
          disclaimer: answer.boundaries?.disclaimer?.text,
        }),
      ]),
      link,
    };
  }
  const d = answer.data;
  const b = d.builderState;
  const name = agentText(d.identity.name) ?? d.identity.slug;
  const symbol = agentText(d.identity.symbol);
  const narrative = d.identity.narrative ? agentText(d.identity.narrative.name) : undefined;

  const lines: (string | undefined)[] = [];
  lines.push(`HEY Research on ${name}${symbol ? ` (${symbol})` : ''} — ${CHAIN_NAME}`);
  lines.push(`Answer: ${agentText(answer.answer) ?? 'not given'} [${answer.answerStatus}]`);
  if (resolved?.via === 'token') lines.push('Found by its contract address in HEY’s token index.');
  if (resolved?.via === 'search') lines.push('Found by name or ticker in HEY’s search.');
  lines.push('');
  lines.push(`Activity: ${activityWords(b.activityStatus, b.activityMeasured)}`);
  lines.push(
    `Last meaningful ship: ${
      b.lastMeaningfulShipAt
        ? day(b.lastMeaningfulShipAt)
        : `unknown${d.latestMeaningfulChangeReason ? ` — ${LATEST_CHANGE_REASON[d.latestMeaningfulChangeReason] ?? d.latestMeaningfulChangeReason}` : ''}`
    }`,
  );
  lines.push(
    `Meaningful building events in 30 days: ${b.meaningfulEvents30d === null ? 'not measured' : String(b.meaningfulEvents30d)}`,
  );
  lines.push(
    `Build Momentum (0–100, development evidence only, never price): ${
      b.buildMomentum === null
        ? `not measured${b.buildMomentumReason ? ` — ${b.buildMomentumReason}` : ''}`
        : String(b.buildMomentum)
    }`,
  );
  const sbState = b.stillBuildingState ?? (b.stillBuilding ? 'HELD' : undefined);
  lines.push(
    `Still Building: ${
      sbState
        ? `${STILL_BUILDING_WORDS[sbState] ?? sbState}${b.stillBuildingWithheld ? ` — ${STILL_BUILDING_REASON[b.stillBuildingWithheld] ?? b.stillBuildingWithheld}` : ''}`
        : 'unknown'
    }`,
  );
  lines.push(
    `Research level: ${RESEARCH_LEVEL_WORDS[d.identity.researchLevel] ?? d.identity.researchLevel}${narrative ? ` · ${narrative}` : ''}`,
  );
  const token = d.contractIdentity.token;
  lines.push(
    token
      ? `Token: ${token.address} — ${token.verification ? `${token.verification}: ${TOKEN_VERIFICATION_WORDS[token.verification] ?? token.verification}` : 'verification unknown'}`
      : 'Token: none recorded for this project (a project is not a token)',
  );
  lines.push(`Owner verified: ${d.contractIdentity.ownerVerified ? 'yes' : 'not verified'}`);

  if (d.latestMeaningfulChange) {
    lines.push('', 'Latest meaningful ship:', changeLine(d.latestMeaningfulChange, baseUrl));
  }
  const recent = d.recentChanges.available
    ? d.recentChanges.items.filter((c) => c.id !== d.latestMeaningfulChange?.id).slice(0, 3)
    : [];
  if (recent.length > 0) {
    lines.push(
      '',
      'Other recent changes HEY recorded:',
      ...recent.map((c) => changeLine(c, baseUrl)),
    );
  } else if (!d.recentChanges.available) {
    lines.push(
      '',
      `Recent changes: unknown — ${d.recentChanges.reason ?? 'the change ledger could not be read'}`,
    );
  }

  if (answer.unknowns.length > 0) {
    lines.push('', 'What HEY does not know:', ...answer.unknowns.slice(0, 6).map(unknownLine));
    if (answer.unknowns.length > 6)
      lines.push(`- and ${answer.unknowns.length - 6} more at ${link ?? baseUrl}`);
  }
  for (const disclosure of answer.disclosures ?? []) {
    const text = agentText(disclosure.statement);
    if (text) lines.push('', `Disclosure: ${text}`);
  }
  if (d.marketContext) {
    lines.push(
      '',
      `Market context (not building evidence, not relayed here): ${d.marketContext.url}`,
    );
  }
  if (resolved && resolved.alternatives.length > 0) {
    lines.push(
      '',
      `Other projects matching the name: ${resolved.alternatives
        .map((a) => `${quoteExternal(a.name, 80)} ${projectUrl(baseUrl, a.slug)}`)
        .join('; ')}`,
    );
  }
  lines.push(`Why HEY says so: ${b.explainUrl}`);
  if (answer.citation) lines.push(`Cite: ${answer.citation.url} (as of ${answer.citation.asOf})`);
  lines.push(
    ...footer({ baseUrl, asOf: answer.asOf, link, disclaimer: answer.boundaries.disclaimer.text }),
  );
  return { text: join(lines), link };
}

export function renderNotFound(
  resolved: Extract<Resolved, { found: false }>,
  baseUrl: string,
  readAt: string,
): Rendered {
  const s = resolved.subject;
  const lines: string[] = [];
  if (s.kind === 'address') {
    const lookup = resolved.lookup;
    lines.push(
      `HEY Research has no published project for contract ${s.address} on ${CHAIN_NAME}. That is an answer about HEY's index, not a finding about the contract.`,
    );
    if (lookup?.issuer)
      lines.push(`HEY records it as: ${bound(foldText(lookup.issuer.sentence), 300).text}`);
    if (lookup?.scanUrl)
      lines.push(`HEY Scan reads any address on ${CHAIN_NAME}: ${lookup.scanUrl}`);
    lines.push(
      ...footer({ baseUrl, asOf: readAt, link: lookup?.scanUrl, disclaimer: lookup?.disclaimer }),
    );
    return { text: lines.join('\n'), link: lookup?.scanUrl };
  }
  const shown = s.kind === 'query' ? `${s.ticker ? '$' : ''}${s.query}` : s.slug;
  lines.push(
    `HEY Research found no published project matching ${quoteExternal(shown, 64)} on ${CHAIN_NAME}. That is an answer about HEY's search, not a finding about the project.`,
  );
  lines.push(...otherRecords(resolved.search));
  lines.push(
    'Try the exact project name, its $TICKER or its contract address (0x…); a contract address is the surest identity.',
  );
  lines.push(...footer({ baseUrl, asOf: readAt, link: `${baseUrl}/search` }));
  return { text: lines.join('\n'), link: `${baseUrl}/search` };
}

/** Launch records and issuer tokens the search listed: never presented as projects. */
function otherRecords(search: HeySearchSuggestions | undefined): string[] {
  if (!search) return [];
  const lines: string[] = [];
  const launches = search.suggestions.filter((x) => x.type === 'launch');
  if (launches.length > 0) {
    const first = launches[0];
    lines.push(
      `HEY holds ${launches.length}${search.moreLaunchRecords ? '+' : ''} launch record${launches.length === 1 ? '' : 's'} under that name: tokens HEY has not researched as projects${first && first.type === 'launch' ? ` (for example ${first.contract}, launched via ${quoteExternal(first.launchedVia, 40)})` : ''}. A launch record is not a project and says nothing about building.`,
    );
  }
  for (const issuer of search.suggestions) {
    if (issuer.type === 'issuer') {
      lines.push(
        `${quoteExternal(issuer.name, 80)} ${issuer.contract}: ${bound(foldText(issuer.label), 120).text}`,
      );
    }
  }
  return lines;
}

export function renderSearch(
  search: HeySearchSuggestions,
  baseUrl: string,
  readAt: string,
): Rendered {
  const projects = search.suggestions.filter((s) => s.type === 'project');
  const lines: string[] = [];
  if (projects.length === 0) {
    lines.push(
      `HEY Research found no published project matching ${quoteExternal(search.q, 64)} on ${CHAIN_NAME}. That is an answer about HEY's search, not a finding about any project.`,
    );
  } else {
    lines.push(
      `HEY Research: ${projects.length} published project${projects.length === 1 ? '' : 's'} matching ${quoteExternal(search.q, 64)} on ${CHAIN_NAME}:`,
    );
    for (const p of projects) {
      if (p.type !== 'project') continue;
      const slug = suggestionSlug(p);
      const status = (p as { status?: unknown }).status;
      const parts = [
        `- ${quoteExternal(p.name, 80)}`,
        p.symbol ? ` (${quoteExternal(p.symbol, 24)})` : '',
        typeof status === 'string' ? ` — ${bound(foldText(status), 80).text}` : '',
        p.contract ? ` · contract ${p.contract}` : '',
        p.sameNameDifferentContract
          ? ' · another project shares this name on a different contract'
          : '',
        slug ? ` · ${projectUrl(baseUrl, slug)}` : '',
      ];
      lines.push(parts.join(''));
    }
    lines.push('Names and tickers are not identity; the contract address is.');
  }
  lines.push(...otherRecords(search));
  const link = `${baseUrl}/search?q=${encodeURIComponent(search.q)}`;
  lines.push(...footer({ baseUrl, asOf: readAt, link }));
  return { text: lines.join('\n'), link };
}

export function renderChanges(
  answer: HeyAgentResponseOf<'what_changed'>,
  baseUrl: string,
): Rendered {
  const project = answer.subject?.project;
  const link = answer.links.page ?? project?.url ?? `${baseUrl}/updates`;
  if (answer.status !== 'ok' || !answer.data) {
    const message =
      agentText(answer.error?.message) ?? agentText(answer.answer) ?? 'HEY did not answer.';
    return {
      text: join([
        `HEY Research: ${message}`,
        `Status: ${answer.status}${answer.error?.code ? ` (${answer.error.code})` : ''}.`,
        ...footer({
          baseUrl,
          asOf: answer.asOf,
          link,
          disclaimer: answer.boundaries?.disclaimer?.text,
        }),
      ]),
      link,
    };
  }
  const d = answer.data;
  const lines: string[] = [];
  lines.push(
    d.scope === 'project' && project
      ? `HEY Research: what changed for ${agentText(project.name) ?? project.slug} in the last ${d.window.days} day${d.window.days === 1 ? '' : 's'}`
      : `HEY Research: what changed on ${CHAIN_NAME} in the last ${d.window.days} day${d.window.days === 1 ? '' : 's'}`,
  );
  lines.push(`Answer: ${agentText(answer.answer) ?? 'not given'} [${answer.answerStatus}]`);
  lines.push(
    `Window: ${day(d.window.from)} to ${day(d.window.to)}, by when it happened, else when HEY detected it.`,
  );
  if (d.items.length > 0) {
    lines.push('', `Newest ${d.shown} of ${d.total}:`);
    for (const c of d.items) {
      lines.push(`${changeLine(c, baseUrl)}${d.scope === 'chain' ? ` · ${c.project.url}` : ''}`);
    }
  } else {
    lines.push(
      '',
      `No change recorded in this window by HEY's ledger (${d.total} in total). That is a reading of HEY's ledger, not of the chain.`,
    );
  }
  if (answer.unknowns.length > 0) {
    lines.push('', 'What HEY does not know:', ...answer.unknowns.slice(0, 4).map(unknownLine));
  }
  lines.push(`More: ${d.more}`);
  lines.push(
    ...footer({ baseUrl, asOf: answer.asOf, link, disclaimer: answer.boundaries.disclaimer.text }),
  );
  return { text: lines.join('\n'), link };
}

export function renderTimeline(
  timeline: HeyTimeline,
  baseUrl: string,
  asOf: string,
  resolved?: Extract<Resolved, { found: true }>,
): Rendered {
  const link = timeline.project.url;
  const lines: string[] = [];
  lines.push(
    `HEY Research: ships and building evidence for ${quoteExternal(timeline.project.name, 80)} on ${CHAIN_NAME}`,
  );
  if (timeline.items.length === 0) {
    lines.push(
      "HEY's timeline holds no building entry for this project. That is a reading of HEY's records, not a finding that nothing was built.",
    );
  } else {
    lines.push(
      `Newest ${timeline.items.length} of ${timeline.total} entries (${timeline.totals.ships} ships):`,
    );
    for (const e of timeline.items) {
      const title = quoteExternal(e.title, 160);
      const verification = e.verification ? ` [${e.verification}]` : '';
      const counts = e.countsAsBuilding ? '' : ' (context, not counted as building)';
      const source =
        e.source && /^https?:\/\//.test(e.source) ? ` · source ${bound(e.source, 200).text}` : '';
      const evidence = /^[a-z0-9]+:/.test(e.id) ? ` · evidence ${evidenceUrl(baseUrl, e.id)}` : '';
      lines.push(
        `- ${when(e.at, e.precision)} ${e.kind}: ${title}${verification}${counts}${source}${evidence}`,
      );
    }
    if (timeline.truncated) lines.push(`Older entries: ${link}`);
  }
  if (resolved && resolved.alternatives.length > 0) {
    lines.push(
      `Other projects matching the name: ${resolved.alternatives
        .map((a) => `${quoteExternal(a.name, 80)} ${projectUrl(baseUrl, a.slug)}`)
        .join('; ')}`,
    );
  }
  lines.push(...footer({ baseUrl, asOf, link, disclaimer: timeline.disclaimer }));
  return { text: lines.join('\n'), link };
}

const count = (n: number | undefined): string =>
  n === undefined ? 'not measured' : n.toLocaleString('en-US');

export function renderChain(chain: HeyChain, baseUrl: string, asOf: string): Rendered {
  const link = `${baseUrl}/pulse`;
  const lines: string[] = [];
  const fullDays = chain.days.filter((d) => d.day !== chain.today);
  const last = chain.days.find((d) => d.day === chain.lastFullDay) ?? fullDays[fullDays.length - 1];
  lines.push(
    `HEY Research: ${CHAIN_NAME} (${CHAIN_ID}) overview, ${fullDays.length} complete day${fullDays.length === 1 ? '' : 's'}`,
  );
  const sum = (key: 'ships' | 'projectsPublished' | 'buildersVerified'): string => {
    const values = fullDays.map((d) => d[key]);
    if (values.length === 0 || values.some((v) => v === undefined))
      return 'not measured on every day';
    return (values as number[]).reduce((a, v) => a + v, 0).toLocaleString('en-US');
  };
  lines.push(`Builder side (HEY's records, counted on the day HEY recorded them):`);
  lines.push(`- Ships recorded: ${sum('ships')}`);
  lines.push(`- Projects published: ${sum('projectsPublished')}`);
  lines.push(`- Projects recorded as Verified Builders: ${sum('buildersVerified')}`);
  if (last) {
    lines.push(`Last complete day, ${last.day}:`);
    lines.push(`- Projects shipping: ${count(last.buildersShipping)}; ships: ${count(last.ships)}`);
    lines.push(
      `- Chain activity: ${count(last.transactions)} transactions, ${count(last.transfers)} transfers, ${count(last.launches)} token launches${last.launchesBackfill ? ' (mostly a backfill of earlier launches)' : ''}${last.basis.chain ? ` (${last.basis.chain.replace(/_/g, ' ')})` : ' (no chain reading for the day)'}`,
    );
  } else {
    lines.push('Last complete day: not recorded yet.');
  }
  lines.push(
    'Aggregates only: no address, no ranking. Trading figures are market context on HEY and are not relayed here.',
  );
  lines.push(...footer({ baseUrl, asOf, link, disclaimer: chain.disclaimer }));
  return { text: lines.join('\n'), link };
}

export function renderError(error: HeyPluginError, baseUrl: string): Rendered {
  const parts = [
    `HEY Research could not answer: ${bound(foldText(error.message), 400).text} (code ${error.code}`,
  ];
  if (error.requestId) parts.push(`, request ${error.requestId}`);
  if (error.retryAfterSeconds !== undefined)
    parts.push(`, retry after ${error.retryAfterSeconds} s`);
  parts.push(')');
  const lines = [parts.join('')];
  if (error.code === 'unsupported_chain') {
    lines.push(
      `HEY Research covers ${CHAIN_NAME} (chain id ${CHAIN_ID}, eip155:${CHAIN_ID}) only.`,
    );
  } else if (error.retryable) {
    lines.push('This is temporary on HEY’s side; the same question can be asked again later.');
  }
  lines.push(`Source: HEY Research Lab — ${new URL(baseUrl).host}`);
  return { text: lines.join('\n'), link: undefined };
}
