/** Saved-only JSON projection for the permissive legacy display, never runtime resolution. */
const MASK = '***MASKED***'; // Preserve the legacy bare-config presentation.
const isPassword = key => key.toUpperCase() === 'SQL_SERVER_PASSWORD';
function passwordCandidates(value, candidates) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (isPassword(key)) {
      // Match legacy process.env assignment, including arrays/objects/boolean/null.
      // Unconvertible JSON values fail before any saved content reaches the console.
      const candidate = String(child);
      if (candidate) candidates.add(candidate);
    }
    passwordCandidates(child, candidates);
  }
}
function redactOriginal(text, candidates) {
  let remaining = text,
    result = '';
  while (remaining) {
    let first = remaining.length,
      match;
    for (const candidate of candidates) {
      const index = remaining.indexOf(candidate);
      if (index >= 0 && index < first) {
        first = index;
        match = candidate;
      }
    }
    if (!match) return result + remaining;
    result += remaining.slice(0, first) + MASK;
    remaining = remaining.slice(first + match.length);
  }
  return result;
}
export function projectSavedConfig(saved) {
  // Preserve legacy root spread semantics; nested arrays still remain arrays.
  const root = Object.create(null);
  for (const [key, value] of Object.entries(saved ?? {})) root[key] = value;
  const known = new Set();
  passwordCandidates(root, known);
  const candidates = [...known].sort((a, b) => b.length - a.length);
  const redact = text => redactOriginal(text, candidates);
  const object = value => {
    const entries = Object.entries(value).map(([key, child]) => [key, child, redact(key)]);
    // Ordinary keys retain their identity even when a sensitive key would redact onto them.
    const names = new Set(entries.filter(([key, , safe]) => key === safe).map(([key]) => key));
    const result = Object.create(null);
    for (const [key, child, safe] of entries) {
      let name = safe;
      if (name !== key) {
        while (names.has(name)) name += MASK;
        names.add(name);
      }
      if (isPassword(key)) result[name] = child === '' ? '' : MASK;
      else result[name] = project(child);
    }
    return result;
  };
  const project = value => {
    if (Array.isArray(value)) return value.map(project);
    if (value !== null && typeof value === 'object') return object(value);
    const original = String(value),
      safe = redact(original);
    // Only secret-bearing scalar leaves change type; ordinary JSON bytes/types are retained.
    return safe === original ? value : safe;
  };
  return object(root);
}
