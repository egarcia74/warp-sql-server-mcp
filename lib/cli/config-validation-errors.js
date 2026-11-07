/** No message matching: inspect a bounded private code/number graph only. */
const TLS = new Set([
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED'
]);
const NETWORK = new Set([
  'ESOCKET',
  'ETIMEOUT',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EINSTLOOKUP'
]);
export function classifyValidationError(error, { stage } = {}) {
  const seen = new Set(),
    codes = new Set(),
    numbers = new Set();
  let cleanup = false;
  const visit = (e, depth) => {
    if (!e || typeof e !== 'object' || depth >= 4 || seen.has(e) || seen.size >= 15) return;
    seen.add(e);
    // Access only documented scalar properties; no error serialization or text parsing.
    if (typeof e.code === 'string' && e.code.length <= 80) codes.add(e.code);
    if (Number.isInteger(e.number)) numbers.add(e.number);
    if (e.cleanupFailed === true) cleanup = true;
    visit(e.cause, depth + 1);
    visit(e.originalError, depth + 1);
  };
  visit(error, 0);
  if (cleanup || stage === 'closing') return 'cleanup';
  if ([...codes].some(c => TLS.has(c))) return 'tls';
  if (numbers.has(4060) || numbers.has(916)) return 'database-access';
  if (codes.has('ELOGIN') || numbers.has(18456)) return 'authentication';
  if (codes.has('ABORT_ERR')) return 'cancelled';
  if ([...codes].some(c => NETWORK.has(c))) return 'network';
  return stage === 'querying' ? 'query' : stage === 'connecting' ? 'network' : 'runtime';
}
