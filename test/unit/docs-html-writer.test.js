import { describe, it, expect } from 'vitest';
import { preserveUnchangedTimestamp } from '../../scripts/docs/write-html.js';

// `generate-tools-html.js` renders `Last updated: ${new Date().toLocaleDateString()}`
// into the footer. That is date-only, so the generated page differed from the
// committed one on the first build of any new calendar day even when no tool
// documentation had changed -- opening a throwaway "auto-update API
// documentation" PR per day. The guard rolls the date back when nothing else
// on the page changed, mirroring what extract-docs.js already does for
// docs-data/tools.json.
describe('preserveUnchangedTimestamp', () => {
  const page = (date, body = '<p>one tool</p>') =>
    `<html><body>${body}<footer><p>Generated automatically from code • Last updated: ${date}</p></footer></body></html>`;

  it('keeps the committed date when only the date changed', () => {
    const result = preserveUnchangedTimestamp(page('9/6/2026'), page('9/8/2026'));
    expect(result).toBe(page('9/6/2026'));
    expect(result).not.toMatch(/9\/8\/2026/);
  });

  it('adopts the new date when the page content changed', () => {
    const next = page('9/8/2026', '<p>two tools</p>');
    // A real documentation change must carry a truthful date, so the whole
    // point of the guard is that it does not fire here.
    expect(preserveUnchangedTimestamp(page('9/6/2026'), next)).toBe(next);
  });

  it('returns the content unchanged when nothing is committed yet', () => {
    const next = page('9/8/2026');
    expect(preserveUnchangedTimestamp(null, next)).toBe(next);
  });

  it('leaves a page with no timestamp footer alone', () => {
    // index.html carries no `Last updated:`; masking is then the identity, so
    // the guard must be a no-op rather than throwing on a missing match.
    const landing = '<html><body><p>Built with love</p></body></html>';
    expect(preserveUnchangedTimestamp(landing, landing)).toBe(landing);
    const changed = '<html><body><p>Built with care</p></body></html>';
    expect(preserveUnchangedTimestamp(landing, changed)).toBe(changed);
  });

  it('carries a date containing $ without treating it as a backreference', () => {
    // The replacement uses a function, not a `$1` string, so a value that looks
    // like a backreference is copied literally rather than expanded.
    expect(preserveUnchangedTimestamp(page('$&weird$1'), page('9/8/2026'))).toBe(page('$&weird$1'));
  });

  it('compares against the committed content, not whatever is on disk', () => {
    // Regression: the guard took a path and read it, but `writeDocsHtml` writes
    // the UNFORMATTED markup before formatting, so the path already held that
    // raw write. Masked comparison then differed on whitespace alone, the guard
    // never fired, and the daily churn continued -- while its unit tests passed,
    // because they never simulated the intervening write. Taking the previous
    // content as an argument is what makes that class of mistake impossible.
    const committed = page('9/6/2026');
    const raw =
      '<html><body>   <p>one tool</p>\n<footer><p>Generated automatically from code • Last updated: 9/8/2026</p></footer>  </body></html>';
    // Formatted output equals the committed page apart from the date; the raw
    // intermediate does not. The guard must key off the former.
    expect(preserveUnchangedTimestamp(committed, page('9/8/2026'))).toBe(committed);
    expect(preserveUnchangedTimestamp(raw, page('9/8/2026'))).toBe(page('9/8/2026'));
  });
});
