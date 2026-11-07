import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editConfigCommand } from '../../lib/cli/config-editor.js';
import { createConfigOutput } from '../../lib/cli/config-output.js';
vi.unmock('dotenv');
let home, cwd, text, file;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'config-editor-'));
  cwd = home;
  file = path.join(home, '.warp-sql-server-mcp.json');
  text = '';
});
afterEach(async () => fs.rm(home, { recursive: true, force: true }));
function output() {
  return createConfigOutput({
    stdout: { write: s => (text += s) },
    stderr: { write: s => (text += s) }
  });
}
function scripted(answers) {
  return Object.fromEntries(
    ['select', 'input', 'password', 'confirm'].map(method => [
      method,
      async options => {
        if (options.message === 'Validation running.') {
          return new Promise((_, reject) =>
            options.signal.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortPromptError' })),
              { once: true }
            )
          );
        }
        expect(answers.length, `${method} ${options.message}`).toBeGreaterThan(0);
        const next = answers.shift();
        if (typeof next === 'function') return next(options);
        return next;
      }
    ])
  );
}
async function run(answers, extra = {}) {
  return editConfigCommand({
    cwd,
    inherited: { HOME: home, NODE_ENV: 'production' },
    prompts: scripted(answers),
    output: output(),
    ...extra
  });
}
it('saves first-time secure defaults without copying inherited credentials or placeholders', async () => {
  const answers = ['save', true];
  expect(
    await run(answers, {
      inherited: {
        HOME: home,
        SQL_SERVER_USER: 'external',
        SQL_SERVER_PASSWORD: 'test-secret-1559'
      }
    })
  ).toBe(0);
  const saved = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(saved).toMatchObject({
    SQL_SERVER_ENCRYPT: 'true',
    SQL_SERVER_TRUST_CERT: 'false',
    SQL_SERVER_READ_ONLY: 'true'
  });
  expect(saved).not.toHaveProperty('SQL_SERVER_USER');
  expect(saved).not.toHaveProperty('SQL_SERVER_PASSWORD');
  expect(text).toContain('plaintext');
  expect(text).not.toContain('test-secret-1559');
  expect(answers).toHaveLength(0);
});
it('navigates Back, keeps existing password and preserves unknown values', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_HOST: 'old',
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'test-secret-1559',
      SQL_SERVER_TRUST_CERT: 'false',
      unknown: { secret: 'do-not-render' }
    })
  );
  const a = [
    'connection',
    'back',
    'authentication',
    'SQL_SERVER_PASSWORD',
    'keep',
    'back',
    'connection',
    'SQL_SERVER_HOST',
    'set',
    'new',
    'back',
    'review',
    'save',
    true
  ];
  expect(await run(a)).toBe(0);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toMatchObject({
    SQL_SERVER_HOST: 'new',
    SQL_SERVER_PASSWORD: 'test-secret-1559',
    unknown: { secret: 'do-not-render' }
  });
  expect(text).not.toContain('test-secret-1559');
  expect(text).not.toContain('do-not-render');
});
it('replaces a password with hidden entry without a default, preserves bytes', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'old',
      SQL_SERVER_TRUST_CERT: 'false'
    })
  );
  const a = [
    'authentication',
    'SQL_SERVER_PASSWORD',
    'replace',
    opts => {
      expect(opts).not.toHaveProperty('defaultValue');
      expect(opts.validate('')).not.toBe(true);
      return '  test-secret-1559  ';
    },
    'back',
    'save',
    true
  ];
  expect(await run(a)).toBe(0);
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_PASSWORD).toBe(
    '  test-secret-1559  '
  );
  expect(text).not.toContain('test-secret-1559');
});
it('removes a password explicitly and reveals dotenv without copying it', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'old',
      SQL_SERVER_TRUST_CERT: 'false'
    })
  );
  await fs.writeFile(path.join(home, '.env'), 'SQL_SERVER_PASSWORD=test-secret-1559\n');
  const a = [
    'authentication',
    'SQL_SERVER_PASSWORD',
    'remove',
    true,
    'back',
    'review',
    'save',
    true
  ];
  expect(await run(a)).toBe(0);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).not.toHaveProperty('SQL_SERVER_PASSWORD');
  expect(text).toContain('[dotenv]');
  expect(text).not.toContain('test-secret-1559');
});
it('requires explicit Save and confirms discarding edits on Cancel', async () => {
  const a = [
    'connection',
    'SQL_SERVER_HOST',
    'set',
    'changed',
    'back',
    'cancel',
    false,
    'cancel',
    true
  ];
  expect(await run(a)).toBe(130);
  await expect(fs.access(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('allows valid Save after failed Validate, marks results stale after editing', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'p',
      SQL_SERVER_HOST: 'old',
      SQL_SERVER_TRUST_CERT: 'false'
    })
  );
  const a = [
    'validate',
    true,
    'connection',
    'SQL_SERVER_HOST',
    'set',
    'new',
    'back',
    'review',
    'save',
    true
  ];
  const validateImpl = vi.fn().mockResolvedValue({
    version: 1,
    status: 'failure',
    category: 'network',
    stage: 'connecting',
    elapsedMs: 1,
    attempts: 1,
    cleanup: 'complete'
  });
  expect(await run(a, { validateImpl })).toBe(0);
  expect(validateImpl).toHaveBeenCalledTimes(1);
  expect(text).toContain('stale');
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST).toBe('new');
});
it('acknowledges host-only auto-trust reduction and dormant permissions', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_HOST: 'prod',
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'p',
      SQL_SERVER_READ_ONLY: 'true',
      SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'true'
    })
  );
  const a = ['connection', 'SQL_SERVER_HOST', 'set', 'localhost', true, 'back', 'save', true, true];
  expect(await run(a)).toBe(0);
  expect(text).toContain('Certificate verification');
  expect(text).toContain('dormant');
});
it('handles external conflict with explicit confirmed reload then cancel', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({ SQL_SERVER_HOST: 'old', SQL_SERVER_TRUST_CERT: 'false' })
  );
  const a = [
    'connection',
    'SQL_SERVER_HOST',
    'set',
    'new',
    'back',
    'save',
    true,
    async () => {
      await fs.writeFile(
        file,
        JSON.stringify({ SQL_SERVER_HOST: 'external', SQL_SERVER_TRUST_CERT: 'false' })
      );
      return true;
    },
    'reload',
    true,
    'cancel'
  ];
  expect(await run(a)).toBe(130);
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST).toBe('external');
  expect(text).toContain('Reload');
});
it('exits on session abort without asking to discard', async () => {
  const c = new globalThis.AbortController();
  c.abort('SIGTERM');
  expect(await run([], { signal: c.signal })).toBe(143);
});
it('fails non-TTY before importing prompt dependency', async () => {
  expect(
    await editConfigCommand({
      input: { isTTY: false },
      terminal: { isTTY: false },
      inherited: { HOME: home },
      output: output()
    })
  ).toBe(2);
  expect(text).toContain('interactive');
});

it('redacts a newly revealed dotenv password even in the first rendered field', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_HOST: 'test-secret-1559',
      SQL_SERVER_USER: 'u',
      SQL_SERVER_TRUST_CERT: 'false'
    })
  );
  await fs.writeFile(path.join(home, '.env'), 'SQL_SERVER_PASSWORD=test-secret-1559\n');
  expect(await run(['connection', 'SQL_SERVER_HOST', 'keep', 'back', 'cancel'])).toBe(130);
  expect(text).not.toContain('test-secret-1559');
});
it('Ctrl+C inside a section exits instead of reopening the prompt', async () => {
  const interrupted = () => {
    throw Object.assign(new Error('private'), { name: 'ExitPromptError' });
  };
  const answers = ['connection', 'SQL_SERVER_HOST', interrupted];
  expect(await run(answers)).toBe(130);
  expect(answers).toHaveLength(0);
});
it('Ctrl+C at the validation cancel prompt stops the probe and exits the editor', async () => {
  await fs.writeFile(
    file,
    JSON.stringify({
      SQL_SERVER_USER: 'u',
      SQL_SERVER_PASSWORD: 'p',
      SQL_SERVER_TRUST_CERT: 'false'
    })
  );
  const prompts = scripted(['validate', true]);
  const select = prompts.select;
  prompts.select = options =>
    options.message === 'Validation running.'
      ? Promise.reject(Object.assign(new Error('private'), { name: 'ExitPromptError' }))
      : select(options);
  const validateImpl = ({ signal }) =>
    new Promise(resolve =>
      signal.addEventListener(
        'abort',
        () =>
          resolve({
            version: 1,
            status: 'cancelled',
            category: 'cancelled',
            stage: 'connecting',
            elapsedMs: 1,
            attempts: 1,
            cleanup: 'complete'
          }),
        { once: true }
      )
    );
  expect(await run([], { prompts, validateImpl })).toBe(130);
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_USER).toBe('u');
});
it.each(['inherited', 'file'])(
  'redacts unused dotenv password when %s credentials win',
  async winner => {
    await fs.writeFile(path.join(cwd, '.env'), 'SQL_SERVER_PASSWORD=hidden-dotenv-review-1559\n');
    const saved = {
      SQL_SERVER_HOST: 'hidden-dotenv-review-1559',
      SQL_SERVER_USER: 'u',
      SQL_SERVER_TRUST_CERT: 'false',
      ...(winner === 'file' ? { SQL_SERVER_PASSWORD: 'saved-password' } : {})
    };
    const bytes = JSON.stringify(saved);
    await fs.writeFile(file, bytes);
    const inherited = {
      HOME: home,
      ...(winner === 'inherited' ? { SQL_SERVER_PASSWORD: 'inherited-password' } : {})
    };
    expect(await run(['review', 'cancel'], { inherited })).toBe(130);
    expect(text.includes('hidden-dotenv-review-1559')).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
);
