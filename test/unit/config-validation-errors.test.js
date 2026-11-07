import { expect, it } from 'vitest';
import { classifyValidationError } from '../../lib/cli/config-validation-errors.js';
it.each([
  [{ number: 18456 }, 'authentication'],
  [{ code: 'ELOGIN' }, 'authentication'],
  [{ number: 4060 }, 'database-access'],
  [{ number: 916 }, 'database-access'],
  [{ code: 'ESOCKET', originalError: { code: 'CERT_HAS_EXPIRED' } }, 'tls'],
  [{ code: 'ENOTFOUND' }, 'network'],
  [{ code: 'ETIMEOUT' }, 'network'],
  [{ code: 'ABORT_ERR', cleanupFailed: true }, 'cleanup'],
  [{ code: 'ABORT_ERR' }, 'cancelled']
])('classifies safe codes %#', (e, want) =>
  expect(classifyValidationError(e, { stage: 'connecting' })).toBe(want)
);
it('bounds circular/deep causes and never parses raw text', () => {
  const e = new Error('test-secret-1559 ELOGIN');
  e.cause = e;
  expect(classifyValidationError(e, { stage: 'querying' })).toBe('query');
  let deep = { code: 'ELOGIN' };
  for (let i = 0; i < 6; i++) deep = { cause: deep };
  expect(classifyValidationError(deep, { stage: 'connecting' })).toBe('network');
});
