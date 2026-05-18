import path from 'node:path';

// Include current Node.js bin to ensure npm/node are reachable
const NODE_BIN = path.dirname(process.execPath);

// Safe path for execSync to satisfy Sonar S4036
export const SAFE_PATH = `${NODE_BIN}:/usr/bin:/usr/local/bin:/usr/sbin:/usr/local/sbin:/bin:/sbin`;

export function parseCommandArguments(command) {
  const args = [];
  let current = '';
  let inQuotes = false;

  for (const char of command) {
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        args.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}

export function buildMergedEnv(customEnv) {
  const mergedEnv = {
    ...process.env
  };

  if (customEnv) {
    Object.assign(mergedEnv, customEnv);
  }

  mergedEnv.PATH = SAFE_PATH;

  return mergedEnv;
}
