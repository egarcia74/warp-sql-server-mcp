/** Outer-process regression host: harness owns cleanup of the deliberately surviving child. */
import { spawn } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { runConfigValidation } from '../../lib/cli/config-validation.js';
const result = await runConfigValidation({
  resolved: {
    environment: { SQL_SERVER_USER: 'u', SQL_SERVER_PASSWORD: 'synthetic' },
    sources: {}
  },
  spawnImpl: (exe, _args, options) => {
    const child = spawn(
      exe,
      [fileURLToPath(new URL('./config-validation-process.js', import.meta.url)), 'hang'],
      options
    );
    process.stdout.write(JSON.stringify({ worker: child.pid }) + '\n');
    // Model an OS kill that could not be executed/confirmed; never claim disposal.
    child.kill = () => false;
    return child;
  },
  timers: { setTimeout: (fn, ms) => setTimeout(fn, Math.max(10, ms / 1000)), clearTimeout }
});
process.stdout.write(JSON.stringify({ result }) + '\n');
