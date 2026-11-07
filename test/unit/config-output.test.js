import { expect, it } from 'vitest';
import { createConfigOutput } from '../../lib/cli/config-output.js';
it('redacts secrets in every field and strips terminal controls', () => {
  let text = '';
  const stream = {
    write: s => {
      text += s;
    }
  };
  const out = createConfigOutput({ stdout: stream, stderr: stream, secrets: ['test-secret-1559'] });
  out.line('host test-secret-1559\u001b]0;title\u0007\u001b[31mRED\nnext');
  out.field('SQL_SERVER_PASSWORD', 'test-secret-1559', 'file');
  out.error(new Error('test-secret-1559\u001b[31m'));
  out.review(
    {
      SQL_SERVER_HOST: 'test-secret-1559',
      SQL_SERVER_PASSWORD: 'test-secret-1559',
      UNKNOWN: 'never-display'
    },
    { environment: {}, sources: {} }
  );
  expect(text).not.toContain('test-secret-1559');
  expect([...text].some(c => (c.charCodeAt(0) < 32 && c !== '\n') || c.charCodeAt(0) === 127)).toBe(
    false
  );
  expect(text).not.toContain('never-display');
  expect(text).toContain('********');
});
it('shows contextual certificate trust and runtime defaults separately from explicitly empty sources', () => {
  let text = '';
  const out = createConfigOutput({
    stdout: { write: s => (text += s) },
    stderr: { write: s => (text += s) }
  });
  out.review(
    {},
    {
      environment: { SQL_SERVER_HOST: '', NODE_ENV: 'production' },
      sources: { SQL_SERVER_HOST: 'inherited' }
    }
  );
  expect(text.includes('SQL_SERVER_TRUST_CERT: true [contextual default]')).toBe(true);
  expect(
    text.includes('SQL_SERVER_HOST: localhost [inherited; explicit empty uses runtime default]')
  ).toBe(true);
});
it.each(['\u001b[31m', '\u001b]0;title\u0007', '\u0001', '\u0080', '\u202e', '\u2066'])(
  'does not reconstruct a known password after removing controls %#',
  control => {
    const out = createConfigOutput({ secrets: ['review-secret-1559'] });
    expect(out.safe(`review-${control}secret-1559`)).toBe('********');
  }
);
it('redacts both raw and sanitized known-password forms without changing stored bytes', () => {
  const secret = 'review-\u001b[31msecret-1559';
  const out = createConfigOutput({ secrets: [secret] });
  expect(out.safe('review-secret-1559')).toBe('********');
  expect(out.safe(secret)).toBe('********');
  expect(secret).toBe('review-\u001b[31msecret-1559');
});
