import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CHECKS, runCheck } from '../../scripts/docs/run-doc-checks.mjs';

// `npm run docs:check` used to chain the checks with `&&`, which stops at the first failure -
// the exact masking that docs.yml avoids with `if: always()` on its report steps. A contributor
// would fix the orphan drift, push, and only then learn about the tool drift, paying a second
// CI round trip for information the first run already had.
describe('every documentation check runs, even after one fails', () => {
  it('runs all three checks regardless of earlier failures', () => {
    const run = vi.fn().mockReturnValue({ status: 1 });

    for (const check of CHECKS) runCheck(check.script, run);

    expect(run).toHaveBeenCalledTimes(CHECKS.length);
  });

  it('reports a non-zero exit as a failure and zero as a pass', () => {
    expect(runCheck('x.mjs', () => ({ status: 0 }))).toBe(true);
    expect(runCheck('x.mjs', () => ({ status: 1 }))).toBe(false);
    expect(runCheck('x.mjs', () => ({ status: null }))).toBe(false);
  });

  it('covers each check script that exists, and nothing that does not', () => {
    const repoRoot = join(import.meta.dirname, '..', '..');
    const scripts = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).scripts;

    expect(scripts['docs:check']).toBe('node scripts/docs/run-doc-checks.mjs');
    expect(CHECKS.map(check => check.script)).toEqual([
      'check-orphan-docs.mjs',
      'check-env-var-docs.mjs',
      'check-tool-docs.mjs'
    ]);
    for (const check of CHECKS) {
      expect(() => readFileSync(join(repoRoot, 'scripts/docs', check.script))).not.toThrow();
    }
  });
});
