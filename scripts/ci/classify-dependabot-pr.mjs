#!/usr/bin/env node
/**
 * Decides whether a Dependabot PR may merge unattended, from its title alone.
 *
 * Why this exists: this logic used to be written twice, in
 * .github/workflows/dependabot-auto-merge.yml (per PR event) and
 * .github/workflows/dependabot-retriage.yml (bulk workflow_dispatch). Three
 * separate defects came out of that duplication - a grouped-title rule added to
 * one copy and not the other, a `v?` in one parser and not the other, and a
 * core-dependency hold present in one copy only - and in each case the copy that
 * was missing the rule was the one that queued `gh pr merge --auto`. One
 * classifier, called by both, is the fix. It is a pure function of the title so
 * it can be unit-tested, which shell embedded in YAML could not be.
 *
 * The contract is deliberately blunt: **a title we cannot parse a version pair
 * from is held, never merged.** See the `unclassifiable` rule for why.
 */

import { pathToFileURL } from 'node:url';

/** Ordered rules. The first match wins; order is load-bearing. */
const RULES = [
  {
    id: 'security-critical-action',
    reason: 'a security-critical GitHub Action',
    decision: 'hold'
  },
  {
    id: 'core-dependency',
    reason: 'a core database or authentication dependency, held at every bump level',
    decision: 'hold'
  },
  {
    id: 'grouped-unclassifiable',
    reason:
      'a grouped update whose title names no dependency or version, so its contents cannot be classified from the title',
    decision: 'hold'
  },
  { id: 'major-bump', reason: 'a major version bump', decision: 'hold' },
  { id: 'patch-or-minor-bump', reason: 'a patch or minor version bump', decision: 'merge' },
  {
    id: 'unclassifiable',
    reason: 'unclassifiable from its title, which carries no parseable version pair',
    decision: 'hold'
  }
];

const RULE = Object.fromEntries(RULES.map(r => [r.id, r]));

// Actions whose own releases gate this repository's security posture. A bad
// version here weakens scanning silently, so it never merges unattended.
const SECURITY_CRITICAL_ACTION = /github\/codeql-action|step-security/i;

// Database drivers and cloud-auth SDKs: held at EVERY bump level, including
// patch. This must be evaluated before the bump-type rules, otherwise a patch
// bump of mssql/tedious/Azure/AWS merges while the notice says it did not.
const CORE_DEPENDENCY = /bump (@?[^ ]*(mssql|tedious)|@azure\/[^ ]+|aws-sdk|@aws-sdk\/[^ ]+) /i;

// "bump the <group> group with N updates" names neither a package nor a version.
const GROUPED = /the [^ ]+ group/i;

// Gate, then extract. Leading `.*` is greedy in both sed and JS, so where a
// title contains more than one " from X to Y" the LAST is taken - matching the
// shell this replaces.
const HAS_VERSION_PAIR = /bump .+ from [0-9]/i;
const DEPENDENCY = /^.*bump ([^ ]+) from .*$/i;
const FROM_VERSION = /^.* from ([0-9][^ ]*) to .*$/i;
const TO_VERSION = /^.* from [0-9][^ ]* to ([0-9][^ ]*).*$/i;

/** Drop prerelease and build metadata: 1.2.3-rc.1+build -> 1.2.3 */
const core = v => v.split('-')[0].split('+')[0];

/**
 * Compare two versions positionally, the way the shell did: split on ".", compare
 * major, then minor, then patch as STRINGS. A missing component is "", which
 * compares equal to another missing one. Deliberately not semver-aware - it
 * decides which *component changed*, not which version is newer.
 */
export function bumpTypeOf(fromVersion, toVersion) {
  if (!fromVersion || !toVersion) return 'unknown';
  const [fmaj = '', fmin = '', fpat = ''] = core(fromVersion).split('.');
  const [tmaj = '', tmin = '', tpat = ''] = core(toVersion).split('.');
  if (tmaj !== fmaj) return 'major';
  if (tmin !== fmin) return 'minor';
  if (tpat !== fpat) return 'patch';
  return 'none';
}

/**
 * Classify one Dependabot PR title.
 * @param {string} title
 * @returns {{decision:'merge'|'hold', rule:string, reason:string, bumpType:string,
 *            dependency:string, fromVersion:string, toVersion:string}}
 */
export function classifyDependabotPr(title) {
  const t = typeof title === 'string' ? title : '';

  let dependency = '';
  let fromVersion = '';
  let toVersion = '';
  if (HAS_VERSION_PAIR.test(t)) {
    dependency = t.match(DEPENDENCY)?.[1] ?? '';
    fromVersion = t.match(FROM_VERSION)?.[1] ?? '';
    toVersion = t.match(TO_VERSION)?.[1] ?? '';
  }
  const bumpType = bumpTypeOf(fromVersion, toVersion);

  const decide = id => ({ ...RULE[id], rule: id, bumpType, dependency, fromVersion, toVersion });

  if (SECURITY_CRITICAL_ACTION.test(t)) return decide('security-critical-action');
  if (CORE_DEPENDENCY.test(t)) return decide('core-dependency');
  if (bumpType === 'unknown' && GROUPED.test(t)) return decide('grouped-unclassifiable');
  if (bumpType === 'major') return decide('major-bump');
  if (bumpType === 'patch' || bumpType === 'minor') return decide('patch-or-minor-bump');

  // Everything else - including a title with no version pair at all, and a
  // no-op bump from X to X. The shell this replaces had a tail of keyword
  // branches here ("security"/"vulnerability"/"cve", an allowlist of build
  // actions, and a bare \bpatch\b|\bminor\b match) that answered "merge" for a
  // title it had just failed to parse. That is the exact shape that merged
  // #1071 and #1136: the group names "security-actions" and "security-critical"
  // contain "security", so the keyword branch approved the very updates the
  // rules above exist to hold. Measured against all 400 Dependabot PRs this
  // repository has ever had, no title reaches this rule with a parseable
  // version, so dropping those branches costs nothing and closes the hole.
  return decide('unclassifiable');
}

/** CLI: print key=value lines, the shape GITHUB_OUTPUT wants. */
function main() {
  const title = process.argv.slice(2).join(' ');
  if (!title) {
    console.error('usage: classify-dependabot-pr.mjs <pr title>');
    process.exit(2);
  }
  const r = classifyDependabotPr(title);
  process.stdout.write(
    [
      `auto_merge=${r.decision === 'merge'}`,
      `decision=${r.decision}`,
      `rule=${r.rule}`,
      `reason=${r.reason}`,
      `bump_type=${r.bumpType}`,
      `dependency=${r.dependency}`,
      `from_version=${r.fromVersion}`,
      `to_version=${r.toVersion}`,
      ''
    ].join('\n')
  );
}

// Only run as a CLI when invoked directly, so importing it in tests is inert.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
