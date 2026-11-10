import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { editConfigCommand } from '../../lib/cli/config-editor.js';
import { createConfigOutput } from '../../lib/cli/config-output.js';
vi.unmock('dotenv');
let home, file, text, callbackErrors;
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'config-field-editor-'));
  file = path.join(home, '.warp-sql-server-mcp.json');
  text = '';
  callbackErrors = [];
});
afterEach(async () => fs.rm(home, { recursive: true, force: true }));
function output() {
  const stream = { write: s => (text += s) };
  return createConfigOutput({ stdout: stream, stderr: stream });
}
function scripted(answers) {
  return Object.fromEntries(
    ['select', 'input', 'password', 'confirm'].map(method => [
      method,
      async options => {
        if (options.message === 'Validation running.')
          return new Promise((_, reject) =>
            options.signal.addEventListener(
              'abort',
              () => reject(Object.assign(new Error('aborted'), { name: 'AbortPromptError' })),
              { once: true }
            )
          );
        expect(answers.length, method + ' ' + options.message).toBeGreaterThan(0);
        const answer = answers.shift();
        if (typeof answer !== 'function') return answer;
        try {
          return await answer(options);
        } catch (error) {
          callbackErrors.push(error);
          throw error;
        }
      }
    ])
  );
}
async function run(answers, options = {}) {
  const result = await editConfigCommand({
    cwd: home,
    inherited: { HOME: home, NODE_ENV: 'production' },
    prompts: scripted(answers),
    output: output(),
    validateImpl: () => {
      throw new Error('Unexpected network probe');
    },
    ...options
  });
  expect(callbackErrors).toEqual([]);
  expect(answers).toHaveLength(0);
  return result;
}
async function saved(values = {}) {
  const bytes = JSON.stringify({ SQL_SERVER_TRUST_CERT: 'false', ...values });
  await fs.writeFile(file, bytes);
  return bytes;
}
const field = 'SQL_SERVER_HOST';

it('shows inherited provenance before choosing an action and after changing the draft', async () => {
  const bytes = await saved({ [field]: 'saved-host' });
  const answers = [
    'connection',
    field,
    options => {
      expect(text).toContain('File value (draft): saved-host');
      expect(text).toContain('Effective here: external-host');
      expect(text).toContain('Source: inherited environment variable SQL_SERVER_HOST');
      expect(text).toContain('will not change the effective value here');
      expect(options.choices.find(c => c.value === 'keep').name).toBe('Leave unchanged');
      return 'set';
    },
    'new-host',
    () => {
      expect(text).toContain('File value (draft): new-host');
      expect(text.match(/Effective here: external-host/g)).toHaveLength(2);
      return 'back';
    },
    'cancel',
    true
  ];
  expect(await run(answers, { inherited: { HOME: home, [field]: 'external-host' } })).toBe(130);
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
});

it.each(['dotenv', 'inherited empty'])(
  'allows a file value to replace the %s fallback',
  async source => {
    const bytes = await saved();
    if (source === 'dotenv')
      await fs.writeFile(path.join(home, '.env'), 'SQL_SERVER_HOST=fallback-host\n');
    const inherited = { HOME: home, ...(source === 'inherited empty' ? { [field]: '' } : {}) };
    const answers = [
      'connection',
      field,
      () => {
        expect(text).toContain('Setting a file value can replace this fallback');
        expect(text).not.toContain('will not change');
        return 'set';
      },
      'new-host',
      () => {
        expect(text).toContain('Effective here: new-host');
        expect(text).toContain('Source: file value (draft)');
        return 'back';
      },
      'cancel',
      true
    ];
    expect(await run(answers, { inherited })).toBe(130);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
);

it('removing a saved host reveals a replaceable dotenv fallback immediately', async () => {
  await saved({ [field]: 'saved-host' });
  await fs.writeFile(path.join(home, '.env'), 'SQL_SERVER_HOST=fallback-host\n');
  expect(
    await run([
      'connection',
      field,
      'remove',
      () => {
        expect(text).toContain('File value (draft): (not set)');
        expect(text).toContain('Effective here: fallback-host');
        expect(text).toContain('Setting a file value can replace this fallback');
        expect(text).not.toContain('will not change');
        return 'back';
      },
      'cancel',
      true
    ])
  ).toBe(130);
});

it('shows custom overriding dotenv before and after a file edit without copying credentials', async () => {
  await saved({ [field]: 'same-host' });
  await fs.writeFile(
    path.join(home, 'selected.env'),
    'SQL_SERVER_HOST=same-host\nSQL_SERVER_USER=external-user\nSQL_SERVER_PASSWORD=synthetic-field-secret\n'
  );
  const answers = [
    'connection',
    field,
    () => {
      expect(text).toContain('Source: dotenv file ' + path.join(home, 'selected.env'));
      expect(text).toContain('override enabled');
      expect(text).toContain('will not change');
      return 'set';
    },
    'new-host',
    () => {
      expect(text.match(/Effective here: same-host/g)).toHaveLength(2);
      return 'back';
    },
    'save',
    true
  ];
  expect(
    await run(answers, {
      inherited: { HOME: home, DOTENV_CONFIG_PATH: 'selected.env', DOTENV_CONFIG_OVERRIDE: 'true' }
    })
  ).toBe(0);
  const result = JSON.parse(await fs.readFile(file, 'utf8'));
  expect(result[field]).toBe('new-host');
  expect(result).not.toHaveProperty('SQL_SERVER_USER');
  expect(result).not.toHaveProperty('SQL_SERVER_PASSWORD');
  expect(text).not.toContain('synthetic-field-secret');
});

it('shows first-run values as draft and explains the editor launch context without saving', async () => {
  expect(
    await run([
      'connection',
      field,
      () => {
        expect(text).toContain('File value (draft): localhost');
        expect(text).toContain('Effective here: localhost');
        expect(text).toContain("editor's captured environment and working directory");
        expect(text).toContain('MCP client may launch with different settings');
        expect(text).toContain(
          'cannot identify their original shell profile or MCP client configuration'
        );
        return 'keep';
      },
      'back',
      'cancel',
      true
    ])
  ).toBe(130);
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('refreshes dotenv but preserves the captured inherited environment between fields', async () => {
  const bytes = await saved();
  const dotenv = path.join(home, '.env');
  await fs.writeFile(dotenv, 'SQL_SERVER_DATABASE=first-db\n');
  const inherited = { HOME: home, [field]: 'captured-host' };
  expect(
    await run(
      [
        'connection',
        'SQL_SERVER_DATABASE',
        'keep',
        async () => {
          inherited[field] = 'later-host';
          await fs.writeFile(dotenv, 'SQL_SERVER_DATABASE=second-db\n');
          return 'SQL_SERVER_DATABASE';
        },
        'keep',
        field,
        'keep',
        'back',
        'cancel'
      ],
      { inherited }
    )
  ).toBe(130);
  expect(text).toContain('Effective here: first-db');
  expect(text).toContain('Effective here: second-db');
  expect(text).toContain('Effective here: captured-host');
  expect(text).not.toContain('later-host');
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
});

it('retains an accepted edit and stale generation when its field rendering fails', async () => {
  await saved({
    [field]: 'old-host',
    SQL_SERVER_USER: 'u',
    SQL_SERVER_PASSWORD: 'synthetic-field-secret'
  });
  const renderer = output();
  const fieldReview = renderer.fieldReview;
  let calls = 0;
  renderer.fieldReview = (...args) => {
    if (++calls === 2) throw new Error('private-render-error');
    return fieldReview(...args);
  };
  const validateImpl = async () => ({
    version: 1,
    status: 'success',
    category: 'ok',
    stage: 'finished',
    elapsedMs: 1,
    attempts: 1,
    cleanup: 'complete'
  });
  expect(
    await run(
      ['validate', true, 'connection', field, 'set', 'new-host', 'back', 'review', 'save', true],
      { output: renderer, validateImpl }
    )
  ).toBe(0);
  expect(calls).toBe(2);
  expect(text).toContain('Last validation: stale');
  expect(text).toContain('The operation failed.');
  expect(text).not.toContain('private-render-error');
  expect(JSON.parse(await fs.readFile(file, 'utf8'))[field]).toBe('new-host');
});
