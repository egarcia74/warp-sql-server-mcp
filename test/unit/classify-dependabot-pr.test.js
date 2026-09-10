import { describe, it, expect } from 'vitest';
import { classifyDependabotPr, bumpTypeOf } from '../../scripts/ci/classify-dependabot-pr.mjs';

const decide = title => classifyDependabotPr(title).decision;
const rule = title => classifyDependabotPr(title).rule;

describe('bumpTypeOf', () => {
  it.each([
    ['1.2.3', '2.0.0', 'major'],
    ['1.2.3', '1.3.0', 'minor'],
    ['1.2.3', '1.2.4', 'patch'],
    ['1.2.3', '1.2.3', 'none'],
    ['3.4', '3.5', 'minor'],
    ['4.1.11', '5.0.0', 'major']
  ])('%s -> %s is a %s bump', (from, to, expected) => {
    expect(bumpTypeOf(from, to)).toBe(expected);
  });

  it('ignores prerelease and build metadata', () => {
    expect(bumpTypeOf('1.2.3-rc.1', '1.2.3+build.9')).toBe('none');
    expect(bumpTypeOf('1.2.3', '1.2.4-beta')).toBe('patch');
  });

  it('is unknown when either side is missing', () => {
    expect(bumpTypeOf('', '1.2.3')).toBe('unknown');
    expect(bumpTypeOf('1.2.3', '')).toBe('unknown');
  });
});

describe('hold rules, in priority order', () => {
  it('holds security-critical actions', () => {
    expect(rule('ci(deps): bump github/codeql-action/init from 3.1.0 to 3.2.0')).toBe(
      'security-critical-action'
    );
    expect(rule('ci(deps): bump step-security/harden-runner from 2.1.0 to 2.1.1')).toBe(
      'security-critical-action'
    );
  });

  // Regression: a patch bump of a driver used to merge while the notice
  // simultaneously told reviewers it had been held.
  it('holds core database and auth dependencies at EVERY bump level', () => {
    for (const title of [
      'deps(deps): bump mssql from 11.0.0 to 11.0.1',
      'deps(deps): bump tedious from 18.2.0 to 18.2.1',
      'deps(deps): bump @azure/msal-node from 3.1.0 to 3.1.1',
      'deps(deps): bump @aws-sdk/client-secrets-manager from 3.1126.0 to 3.1127.0 ',
      'deps(deps): bump aws-sdk from 2.1.0 to 2.1.1'
    ]) {
      expect(classifyDependabotPr(title)).toMatchObject({
        decision: 'hold',
        rule: 'core-dependency'
      });
    }
  });

  // The defect that actually shipped: #1071 and #1136 both merged unattended.
  // "security-actions" and "security-critical" contain the substring "security",
  // so the old keyword branch approved exactly the updates the rules above hold.
  it('holds grouped updates that name no dependency or version', () => {
    for (const title of [
      'deps(deps): bump the security-critical group with 12 updates',
      'deps(deps): bump the security-actions group with 4 updates',
      'deps-dev(deps-dev): bump the dev-dependencies group across 1 directory with 2 updates'
    ]) {
      expect(classifyDependabotPr(title)).toMatchObject({
        decision: 'hold',
        rule: 'grouped-unclassifiable'
      });
    }
  });

  it('holds major bumps', () => {
    expect(
      classifyDependabotPr('deps-dev(deps-dev): bump vitest from 4.1.11 to 5.0.0')
    ).toMatchObject({ decision: 'hold', rule: 'major-bump', bumpType: 'major' });
  });

  it('a major bump outranks a security keyword in the title', () => {
    expect(rule('deps(deps): bump foo from 1.0.0 to 2.0.0 (security, CVE-2026-1)')).toBe(
      'major-bump'
    );
  });
});

describe('merge rule', () => {
  it('merges patch and minor bumps', () => {
    expect(classifyDependabotPr('deps(deps): bump hono from 4.13.5 to 4.13.7')).toMatchObject({
      decision: 'merge',
      rule: 'patch-or-minor-bump',
      bumpType: 'patch',
      dependency: 'hono'
    });
    expect(decide('deps(deps): bump jose from 6.2.10 to 6.3.0')).toBe('merge');
  });

  // A grouped title that DOES carry a version pair is classifiable, so the
  // grouped rule must not swallow it.
  it('still classifies a grouped title that carries a version pair', () => {
    expect(
      classifyDependabotPr(
        'deps-dev(deps-dev): bump eslint from 10.9.1 to 10.10.0 in the dev-dependencies group across 1 directory'
      )
    ).toMatchObject({ decision: 'merge', bumpType: 'minor', toVersion: '10.10.0' });
  });
});

describe('unparseable titles are held, never merged', () => {
  // This is the behaviour change the shared classifier makes. The two shell
  // copies previously had a tail of keyword branches that answered "merge" for
  // a title they had just failed to parse a version from.
  it.each([
    'ci(deps): bump actions/checkout to a newer pinned sha',
    'ci(deps): bump ossf/scorecard-action to the latest release',
    'chore(deps): patch update for the http stack',
    'chore(deps): minor refresh of the toolchain',
    'deps(deps): security fix for an unversioned package',
    'deps(deps): bump foo from v1.2.3 to v1.2.4',
    'deps(deps): something entirely unclassifiable',
    ''
  ])('holds %j', title => {
    expect(classifyDependabotPr(title)).toMatchObject({
      decision: 'hold',
      rule: 'unclassifiable'
    });
  });

  it('holds a no-op bump from a version to itself', () => {
    expect(classifyDependabotPr('deps(deps): bump foo from 1.2.3 to 1.2.3')).toMatchObject({
      decision: 'hold',
      bumpType: 'none'
    });
  });

  it('tolerates a non-string title rather than throwing', () => {
    for (const bad of [undefined, null, 42, {}]) {
      expect(classifyDependabotPr(bad).decision).toBe('hold');
    }
  });
});

describe('every rule carries a reason', () => {
  it('never emits an empty reason', () => {
    for (const title of [
      'ci(deps): bump github/codeql-action/init from 3.1.0 to 3.2.0',
      'deps(deps): bump mssql from 11.0.0 to 11.0.1',
      'deps(deps): bump the security-critical group with 12 updates',
      'deps-dev(deps-dev): bump vitest from 4.1.11 to 5.0.0',
      'deps(deps): bump hono from 4.13.5 to 4.13.7',
      'nonsense'
    ]) {
      const r = classifyDependabotPr(title);
      expect(r.reason).toBeTruthy();
      expect(r.reason).not.toMatch(/undefined/);
    }
  });
});
