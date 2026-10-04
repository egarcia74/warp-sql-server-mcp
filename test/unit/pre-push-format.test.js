import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { describe, expect, it } from 'vitest';

const hook = readFileSync(new URL('../../hooks/pre-push', import.meta.url), 'utf8');

describe('pre-push formatting gate', () => {
  it('uses the same formatting check as local CI', () => {
    expect(hook).toContain('if ! npm run format:check; then');
    expect(hook).not.toContain('npx prettier --check');
  });
});
