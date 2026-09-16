import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ARCHIVE_INDEX,
  ENTRY,
  EXEMPTIONS,
  SKIPPED_DIRS,
  collectLinkTargets,
  resolveTarget,
  reachableFrom,
  findOrphanDocs,
  listMarkdownFiles,
  readDocs,
  formatReport
} from '../../scripts/docs/check-orphan-docs.mjs';

/** Builds the in-memory docs map the pure functions consume. */
const docsMap = entries => new Map(Object.entries(entries));

/** A throwaway docs tree on disk, for the filesystem-walking half. */
function withTempDocs(build) {
  const root = mkdtempSync(join(tmpdir(), 'orphan-docs-'));
  try {
    mkdirSync(join(root, 'docs'), { recursive: true });
    return build(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const write = (root, relative, content) => {
  const target = join(root, relative);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
};

describe('collectLinkTargets', () => {
  it('finds inline, angle-bracketed, titled, reference and HTML links', () => {
    const targets = collectLinkTargets(
      [
        '[inline](user/QUICKSTART.md)',
        '[angled](<user/with space.md>)',
        '[titled](reference/ENV-VARS.md "the reference")',
        'and the [maintenance guide][ref]',
        '[ref]: operations/MAINTENANCE.md',
        '<a href="architecture/ARCHITECTURE.md">html</a>'
      ].join('\n\n')
    );

    // Collection order is by spelling: inline links, then HTML anchors, then the
    // definitions a reference actually uses. Order does not matter to the walk, but
    // asserting it keeps a regression in one of the regexes from hiding behind the others.
    expect(targets).toEqual([
      'user/QUICKSTART.md',
      'user/with space.md',
      'reference/ENV-VARS.md',
      'architecture/ARCHITECTURE.md',
      'operations/MAINTENANCE.md'
    ]);
  });

  it('ignores links inside fenced code blocks, which are examples and not nav', () => {
    const markdown = ['# Nav', '', '```md', '[example](developer/SAMPLE.md)', '```'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual([]);
  });

  it('ignores tilde-fenced blocks too', () => {
    const markdown = ['~~~markdown', '[example](developer/SAMPLE.md)', '~~~'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual([]);
  });

  // Regression: an HTML comment renders as nothing, so a commented-out nav entry is a link
  // a reader cannot follow. Counting it kept the target "reachable" and the gate silent.
  it('ignores links inside HTML comments, single and multi-line', () => {
    const markdown = [
      '# Nav',
      '',
      '<!-- [commented out](user/HIDDEN.md) -->',
      '',
      '<!--',
      '[block commented](developer/ALSO-HIDDEN.md)',
      '-->',
      '',
      '[live](user/VISIBLE.md)'
    ].join('\n');

    expect(collectLinkTargets(markdown)).toEqual(['user/VISIBLE.md']);
  });

  // Regression (CodeQL alert 168): an UNTERMINATED `<!--` comments out the rest of the
  // rendered document, so nothing after it is navigable - but the balanced-pair regex
  // cannot match it, and a single replace pass left the links behind looking like edges.
  it('ignores links after an unterminated HTML comment', () => {
    const markdown = ['[live](user/VISIBLE.md)', '', '<!--', '[dead](user/HIDDEN.md)'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual(['user/VISIBLE.md']);
  });

  it('ignores an opener left exposed by removing a balanced comment', () => {
    const markdown = '<!-- x --> <!-- [dead](user/HIDDEN.md)';
    expect(collectLinkTargets(markdown)).toEqual([]);
  });

  it('strips nested openers rather than leaving a stray marker behind', () => {
    const markdown = '<!-- <!-- [dead](user/HIDDEN.md) --> [live](user/VISIBLE.md)';
    expect(collectLinkTargets(markdown)).not.toContain('user/HIDDEN.md');
  });

  it('ignores an HTML-commented reference definition and its reference', () => {
    const markdown = ['<!-- [hidden]: user/HIDDEN.md -->', '', 'see [hidden]'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual([]);
  });

  // Regression: a definition nobody references renders as nothing at all, so it must not
  // count as an edge. Previously every definition was collected unconditionally.
  it('ignores a reference definition whose label is never used', () => {
    const markdown = ['# Nav', '', '[old]: user/STALE.md', '', 'No link uses that label.'].join(
      '\n'
    );

    expect(collectLinkTargets(markdown)).toEqual([]);
  });

  it('follows a definition that a full, collapsed or shortcut reference actually uses', () => {
    const full = ['[text][full]', '', '[full]: user/FULL.md'].join('\n');
    const collapsed = ['[collapsed][]', '', '[collapsed]: user/COLLAPSED.md'].join('\n');
    const shortcut = ['see [shortcut] here', '', '[shortcut]: user/SHORTCUT.md'].join('\n');

    expect(collectLinkTargets(full)).toEqual(['user/FULL.md']);
    expect(collectLinkTargets(collapsed)).toEqual(['user/COLLAPSED.md']);
    expect(collectLinkTargets(shortcut)).toEqual(['user/SHORTCUT.md']);
  });

  it('matches reference labels case-insensitively, as markdown does', () => {
    const markdown = ['[text][See Also]', '', '[see   also]: user/A.md'].join('\n');
    expect(collectLinkTargets(markdown)).toEqual(['user/A.md']);
  });

  // Regression: an inline code span renders as literal text, exactly like a fenced
  // example but on one line. A doc reachable only from someone's illustration of link
  // syntax is not reachable at all.
  it('ignores links inside inline code spans', () => {
    expect(collectLinkTargets('Write it as `[example](ORPHAN.md)` in the nav.')).toEqual([]);
  });

  it('ignores a link in a multi-backtick span and keeps a real link beside it', () => {
    const markdown = 'Use ``[a](ORPHAN.md)`` but follow [real](user/REAL.md).';
    expect(collectLinkTargets(markdown)).toEqual(['user/REAL.md']);
  });

  // Regression: `![alt](x)` matched from the `[` after the `!`, so an image destination
  // counted as navigation. An image is fetched, not followed.
  it('ignores inline image destinations', () => {
    expect(collectLinkTargets('![diagram](ORPHAN.md)')).toEqual([]);
  });

  it('ignores reference-style and collapsed image destinations', () => {
    expect(collectLinkTargets(['![alt][img]', '', '[img]: ORPHAN.md'].join('\n'))).toEqual([]);
    expect(collectLinkTargets(['![img][]', '', '[img]: ORPHAN.md'].join('\n'))).toEqual([]);
  });

  it('still follows a real link that sits next to an image', () => {
    const markdown = '![diagram](diagram.png) and [the guide](user/GUIDE.md)';
    expect(collectLinkTargets(markdown)).toEqual(['user/GUIDE.md']);
  });
});

describe('resolveTarget', () => {
  const from = 'docs/README.md';

  it('resolves relative links against the linking file', () => {
    expect(resolveTarget('user/QUICKSTART.md', from)).toBe('docs/user/QUICKSTART.md');
    expect(resolveTarget('../reference/ENV-VARS.md', 'docs/user/QUICKSTART.md')).toBe(
      'docs/reference/ENV-VARS.md'
    );
  });

  it('strips anchors and query strings', () => {
    expect(resolveTarget('user/QUICKSTART.md#install', from)).toBe('docs/user/QUICKSTART.md');
    expect(resolveTarget('user/QUICKSTART.md?plain=1', from)).toBe('docs/user/QUICKSTART.md');
  });

  it('drops same-page anchors, external URLs and non-markdown targets', () => {
    expect(resolveTarget('#where-things-live', from)).toBeNull();
    expect(resolveTarget('https://example.com/docs/X.md', from)).toBeNull();
    expect(resolveTarget('mailto:someone@example.com', from)).toBeNull();
    expect(resolveTarget('//cdn.example.com/x.md', from)).toBeNull();
    expect(resolveTarget('user', from)).toBeNull(); // folder link
    expect(resolveTarget('tools.html', from)).toBeNull(); // generated page
  });

  it('refuses to follow links that leave docs/, so the root README cannot launder an orphan', () => {
    expect(resolveTarget('../README.md', from)).toBeNull();
    expect(resolveTarget('../CONTRIBUTING.md', from)).toBeNull();
    expect(resolveTarget('../../elsewhere/X.md', 'docs/user/QUICKSTART.md')).toBeNull();
  });

  it('treats a root-relative link as repo-relative', () => {
    expect(resolveTarget('/docs/user/QUICKSTART.md', from)).toBe('docs/user/QUICKSTART.md');
  });

  // Regression: a percent-encoded filename never matched the on-disk key, so a perfectly
  // navigable document was reported as an orphan and failed CI. A false alarm is worse
  // than a miss - it teaches maintainers that the gate is wrong rather than the docs.
  it('percent-decodes a path so it matches the file on disk', () => {
    expect(resolveTarget('user/My%20Guide.md', from)).toBe('docs/user/My Guide.md');
    expect(resolveTarget('user/Caf%C3%A9.md', from)).toBe('docs/user/Café.md');
  });

  it('keeps a malformed escape as written rather than throwing', () => {
    expect(resolveTarget('user/100%.md', from)).toBe('docs/user/100%.md');
  });

  it('does not let an encoded traversal smuggle a path out of docs/', () => {
    expect(resolveTarget('%2E%2E/%2E%2E/etc/passwd.md', from)).toBeNull();
  });
});

describe('a percent-encoded link end to end', () => {
  it('reaches the document it names, instead of reporting it orphaned', () => {
    const result = findOrphanDocs(
      docsMap({
        'docs/README.md': '[guide](user/My%20Guide.md)',
        'docs/user/My Guide.md': 'a doc whose name has a space'
      })
    );

    expect(result.orphans).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('reachableFrom', () => {
  it('walks transitively', () => {
    const docs = docsMap({
      'docs/README.md': '[a](a/A.md)',
      'docs/a/A.md': '[b](../b/B.md)',
      'docs/b/B.md': 'leaf',
      'docs/c/C.md': 'nobody links here'
    });

    expect([...reachableFrom(docs)].sort()).toEqual([
      'docs/README.md',
      'docs/a/A.md',
      'docs/b/B.md'
    ]);
  });

  it('terminates on link cycles', () => {
    const docs = docsMap({
      'docs/README.md': '[a](a/A.md)',
      'docs/a/A.md': '[back](../README.md) and [self](A.md)'
    });

    expect([...reachableFrom(docs)].sort()).toEqual(['docs/README.md', 'docs/a/A.md']);
  });

  it('ignores links to files that do not exist - that is the link checker’s report', () => {
    const docs = docsMap({ 'docs/README.md': '[gone](user/DELETED.md)' });
    expect([...reachableFrom(docs)]).toEqual(['docs/README.md']);
  });

  it('returns nothing when the nav file itself is missing', () => {
    expect([...reachableFrom(docsMap({ 'docs/user/X.md': 'x' }))]).toEqual([]);
  });
});

describe('findOrphanDocs', () => {
  it('passes when every doc is linked from the nav', () => {
    const result = findOrphanDocs(
      docsMap({
        'docs/README.md': '[a](user/A.md) [b](developer/B.md)',
        'docs/user/A.md': 'a',
        'docs/developer/B.md': 'b'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.orphans).toEqual([]);
    expect(result.total).toBe(3);
    expect(result.reachable).toHaveLength(3);
  });

  it('fails, and names the file, when a doc is unreachable', () => {
    const result = findOrphanDocs(
      docsMap({
        'docs/README.md': '[a](user/A.md)',
        'docs/user/A.md': 'a',
        'docs/operations/FORGOTTEN.md': 'nothing links here'
      })
    );

    expect(result.ok).toBe(false);
    expect(result.orphans).toEqual(['docs/operations/FORGOTTEN.md']);
    expect(formatReport(result)).toContain('docs/operations/FORGOTTEN.md');
    expect(formatReport(result)).toContain('❌');
  });

  it('exempts the doc template and the archive contents, and says why', () => {
    const result = findOrphanDocs(
      docsMap({
        // The archive pointer is the one link the nav must carry; TEMPLATE.md and the
        // archived documents themselves are not required to be in it.
        'docs/README.md': '[archive](archive/README.md)',
        'docs/TEMPLATE.md': 'template',
        'docs/archive/README.md': 'archive index',
        'docs/archive/OLD.md': 'historical'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.orphans).toEqual([]);
    expect(result.exempted.map(item => item.file)).toEqual([
      'docs/TEMPLATE.md',
      'docs/archive/OLD.md'
    ]);
    // Reported, never silent: each exemption carries its reason into the report.
    const report = formatReport(result);
    expect(report).toContain('Exempt (by design, 2)');
    expect(report).toContain('linked from CONTRIBUTING.md');
    expect(report).toContain('docs/archive/README.md');
  });

  // Regression: the exemption used to cover docs/archive/README.md itself, so deleting the
  // single nav pointer left the whole archive unreachable with the check still passing -
  // the "single pointer" invariant enforced nothing.
  it('fails when the nav drops its pointer to the archive index', () => {
    const result = findOrphanDocs(
      docsMap({
        'docs/README.md': 'nav with no archive pointer',
        [ARCHIVE_INDEX]: '[old](OLD.md)',
        'docs/archive/OLD.md': 'historical'
      })
    );

    expect(result.ok).toBe(false);
    expect(result.orphans).toEqual([ARCHIVE_INDEX]);
    // The descendants stay exempt - only the pointer is being enforced.
    expect(result.exempted.map(item => item.file)).toEqual(['docs/archive/OLD.md']);
  });

  it('passes when the nav keeps the archive pointer, however sparse the archive index is', () => {
    const result = findOrphanDocs(
      docsMap({
        'docs/README.md': 'see [archive](archive/README.md)',
        [ARCHIVE_INDEX]: 'index that links to nothing',
        'docs/archive/OLD.md': 'historical, linked from nowhere'
      })
    );

    expect(result.ok).toBe(true);
    expect(result.exempted.map(item => item.file)).toEqual(['docs/archive/OLD.md']);
  });

  it('exempts nothing else - a docs/ root file still has to be in the nav', () => {
    const result = findOrphanDocs(
      docsMap({ 'docs/README.md': 'nav', 'docs/STRAY.md': 'at the docs root' })
    );

    expect(result.ok).toBe(false);
    expect(result.orphans).toEqual(['docs/STRAY.md']);
  });

  it('fails loudly when the nav file is missing rather than reporting every doc orphaned', () => {
    const result = findOrphanDocs(docsMap({ 'docs/user/A.md': 'a' }));

    expect(result.ok).toBe(false);
    expect(result.missingEntry).toBe(true);
    expect(formatReport(result)).toContain(`Nav file \`${ENTRY}\` is missing`);
  });
});

describe('listMarkdownFiles', () => {
  it('collects markdown recursively and ignores other file types', () => {
    withTempDocs(root => {
      write(root, 'docs/README.md', '# nav');
      write(root, 'docs/user/A.md', 'a');
      write(root, 'docs/tools.html', '<html></html>');

      expect(listMarkdownFiles('docs', root)).toEqual(['docs/README.md', 'docs/user/A.md']);
    });
  });

  it('never walks the gitignored scratch and generated directories, or node_modules', () => {
    withTempDocs(root => {
      write(root, 'docs/README.md', '# nav');
      // Gitignored: agent scratch plans (.gitignore docs/superpowers/).
      write(root, 'docs/superpowers/plan.md', 'scratch');
      // Gitignored: generated V8 coverage output (.gitignore coverage/).
      write(root, 'docs/coverage/report.md', 'generated');
      // Never ours to walk, even if one somehow appeared under docs/.
      write(root, 'docs/node_modules/pkg/README.md', 'dependency');
      write(root, 'docs/.claude/worktrees/wt/docs/README.md', 'worktree copy');

      expect(listMarkdownFiles('docs', root)).toEqual(['docs/README.md']);
    });
  });

  it('keeps every skipped directory name reachable from the exported set', () => {
    for (const name of ['node_modules', '.git', '.claude', 'superpowers', 'coverage']) {
      expect(SKIPPED_DIRS.has(name)).toBe(true);
    }
  });

  it('ignores a symlink that does not resolve to a regular file', () => {
    withTempDocs(root => {
      write(root, 'docs/README.md', '# nav');
      mkdirSync(join(root, 'elsewhere'), { recursive: true });
      symlinkSync(join(root, 'elsewhere'), join(root, 'docs', 'linked.md'));

      expect(listMarkdownFiles('docs', root)).toEqual(['docs/README.md']);
    });
  });
});

describe('the repository as it stands', () => {
  it('has no orphaned documentation', () => {
    const result = findOrphanDocs(readDocs());

    expect(result.orphans).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('starts from a nav file that exists', () => {
    expect(readDocs().has(ENTRY)).toBe(true);
  });

  it('declares a reason for every exemption', () => {
    for (const exemption of EXEMPTIONS) {
      expect(exemption.reason).toMatch(/\S/);
      expect(typeof exemption.matches).toBe('function');
    }
  });
});
