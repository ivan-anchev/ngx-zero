import { defineConfig, type ViteUserConfig } from 'vitest/config';

type ProjectConfig = NonNullable<NonNullable<ViteUserConfig['test']>['projects']>[number];

/**
 * Zone matrix: the ENTIRE suite runs twice — zoneless (default) and with
 * zone.js loaded — because zone.js support is a hard requirement and no
 * library code may depend on either mode.
 */
const sharedTest = {
  environment: 'jsdom',
  include: ['tests/**/*.spec.ts'],
} as const;

const projects: ProjectConfig[] = [
  { test: { ...sharedTest, name: 'zoneless', setupFiles: ['tests/setup.ts'] } },
  { test: { ...sharedTest, name: 'zone', setupFiles: ['tests/zone/setup.ts'] } },
];

export default defineConfig({
  test: {
    projects,
  },
});
