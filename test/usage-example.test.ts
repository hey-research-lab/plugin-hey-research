// The README's usage example, kept compiling against @elizaos/core by `pnpm typecheck`.
import type { Character, Project, ProjectAgent } from '@elizaos/core';
import { expect, it } from 'vitest';

import heyResearchPlugin from '../src/index.js';

const character: Character = {
  name: 'Scout',
  bio: ['Checks which Robinhood Chain projects are still building, with evidence.'],
  plugins: ['@elizaos/plugin-sql', '@elizaos/plugin-bootstrap'],
  secrets: { HEY_API_KEY: process.env.HEY_API_KEY ?? '' }, // optional
};

const agent: ProjectAgent = { character, plugins: [heyResearchPlugin] };
const project: Project = { agents: [agent] };

it('the README example builds a project with the plugin', () => {
  expect(project.agents[0]?.plugins?.[0]?.name).toBe('hey-research');
});
