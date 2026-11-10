/** Shared compatibility overlay and isolated, platform-aware resolution. */
import path from 'node:path';
import os from 'node:os';
import dotenv from 'dotenv';

export function configError(code, field) {
  const error = new Error(code);
  error.code = code;
  if (field) error.field = field;
  return error;
}
export const environmentKey = (key, platform = process.platform) =>
  platform === 'win32' ? key.toUpperCase() : key;

export function copyEnvironment(values, { platform = process.platform, strict = false } = {}) {
  const result = Object.create(null);
  for (const [key, value] of Object.entries(values)) {
    const name = environmentKey(key, platform);
    if (strict && Object.hasOwn(result, name)) throw configError('duplicate-environment-key');
    result[name] = String(value);
  }
  return result;
}
export function getConfigPath(env, { platform = process.platform } = {}) {
  const normalized = copyEnvironment(env, { platform });
  const home = normalized.HOME || normalized.USERPROFILE;
  if (!home) throw configError('missing-home');
  return path.join(home, '.warp-sql-server-mcp.json');
}
export function applyFileEnvironment(env, values, { platform = process.platform } = {}) {
  const result = copyEnvironment(env, { platform });
  for (const [key, value] of Object.entries(values)) {
    const name = environmentKey(key, platform);
    if (!result[name]) result[name] = String(value);
  }
  return result;
}
// Match installed dotenv 18 option aliases/false tokens, but use only the candidate map.
function dotenvOptions(environment, cwd, platform) {
  const option = name => environment[`DOTENV_${name}`] ?? environment[`DOTENV_CONFIG_${name}`];
  const boolean = value => !['false', '0', 'no', 'off', ''].includes((value ?? '').toLowerCase());
  let source = option('PATH') || '.env';
  if (source.startsWith('~')) {
    const homeKey = platform === 'win32' ? 'USERPROFILE' : 'HOME';
    const home = Object.hasOwn(environment, homeKey) ? environment[homeKey] : os.userInfo().homedir;
    source = path.join(home, source.slice(1));
  }
  return {
    path: path.resolve(cwd, source),
    encoding: option('ENCODING') || 'utf8',
    override: boolean(option('OVERRIDE')),
    fast: boolean(option('FAST')),
    quiet: true,
    debug: false
  };
}
/** All supported options are explicit so dotenv cannot use ambient process.env fallbacks. */
export function loadDotenvQuiet({ environment, cwd = process.cwd(), platform = process.platform }) {
  const result = copyEnvironment(environment, { platform });
  // Give dotenv a platform-aware map so its own duplicate ordering/population rules apply.
  const loadedKeys = [];
  const destination = new Proxy(result, {
    get: (map, key) => map[typeof key === 'string' ? environmentKey(key, platform) : key],
    set: (map, key, value) => {
      const name = environmentKey(key, platform);
      loadedKeys.push(name); // Includes override and same-value writes for exact provenance.
      map[name] = value;
      return true;
    },
    getOwnPropertyDescriptor: (map, key) =>
      Object.getOwnPropertyDescriptor(map, environmentKey(key, platform))
  });
  const options = dotenvOptions(result, cwd, platform);
  const loaded = dotenv.config({
    ...options,
    processEnv: destination
  });
  return {
    environment: result,
    loadedKeys: [...new Set(loadedKeys)],
    dotenv: { path: options.path, override: options.override },
    passwordCandidates: Object.entries(loaded?.parsed || {})
      .filter(([key]) => key.toUpperCase() === 'SQL_SERVER_PASSWORD')
      .map(([, value]) => value),
    ...(loaded?.error && loaded.error.code !== 'ENOENT' ? { errorCode: 'dotenv-unreadable' } : {})
  };
}
export function resolveEffectiveConfig({
  inherited,
  fileValues,
  cwd,
  platform = process.platform
}) {
  const original = copyEnvironment(inherited, { platform, strict: true });
  const keys = new Set();
  for (const key of Object.keys(fileValues)) {
    const name = environmentKey(key, platform);
    if (keys.has(name)) throw configError('duplicate-file-key');
    keys.add(name);
  }
  const environment = applyFileEnvironment(original, fileValues, { platform });
  const sources = Object.create(null);
  for (const key of Object.keys(original)) sources[key] = 'inherited';
  for (const key of keys) if (!original[key]) sources[key] = 'file';
  const dotenvResult = loadDotenvQuiet({ environment, cwd, platform });
  if (dotenvResult.errorCode) throw configError(dotenvResult.errorCode);
  for (const key of dotenvResult.loadedKeys) sources[key] = 'dotenv';
  return {
    environment: dotenvResult.environment,
    sources,
    dotenv: dotenvResult.dotenv,
    passwordCandidates: dotenvResult.passwordCandidates
  };
}
