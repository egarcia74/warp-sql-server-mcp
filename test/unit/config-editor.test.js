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
it('declining password removal preserves the original saved value and bytes', async () => {
  const bytes = JSON.stringify({
    SQL_SERVER_USER: 'u',
    SQL_SERVER_PASSWORD: 'credential-editor-1561',
    SQL_SERVER_TRUST_CERT: 'false'
  });
  await fs.writeFile(file, bytes);
  expect(
    await run(['authentication', 'SQL_SERVER_PASSWORD', 'remove', false, 'back', 'cancel'])
  ).toBe(130);
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  expect(text).not.toContain('credential-editor-1561');
});
it('declining a boolean security reduction restores the draft without saving', async () => {
  const a = ['tls', 'SQL_SERVER_ENCRYPT', 'set', 'false', false, 'back', 'review', 'cancel', true];
  expect(await run(a)).toBe(130);
  expect(text).toContain('SQL_SERVER_ENCRYPT: true [draft]');
  expect(text).not.toContain('SQL_SERVER_ENCRYPT: false [draft]');
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('validates trimmed port input through the real field validator', async () => {
  expect(
    await run([
      'connection',
      'SQL_SERVER_PORT',
      'set',
      options => {
        expect(options.validate(' 1559 ')).toBe(true);
        expect(options.validate('15x')).not.toBe(true);
        return ' 1559 ';
      },
      'back',
      'review',
      'cancel',
      true
    ])
  ).toBe(130);
  expect(text).toContain('SQL_SERVER_PORT: 1559 [draft]');
});
it('recovers from a field-prompt error and disposes the session exactly once', async () => {
  const prompts = scripted([
    'connection',
    'SQL_SERVER_HOST',
    () => {
      throw new Error('credential-editor-1561');
    },
    'back',
    'cancel',
    true
  ]);
  prompts.dispose = vi.fn();
  expect(await run([], { prompts })).toBe(130);
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
  expect(text).not.toContain('credential-editor-1561');
});
it('recovers from a review output failure instead of discarding the draft', async () => {
  const renderer = output();
  renderer.review = () => {
    throw new Error('credential-editor-1561');
  };
  expect(await run(['review', 'cancel', true], { output: renderer })).toBe(130);
  expect(text).toContain('The operation failed.');
  expect(text).not.toContain('credential-editor-1561');
});
it('refuses unsupported worker startup values without spawning or printing them', async () => {
  const validateImpl = vi.fn();
  expect(
    await run(['validate', 'cancel', true], {
      inherited: {
        HOME: home,
        SQL_SERVER_USER: 'u',
        SQL_SERVER_PASSWORD: 'credential-editor-1561',
        NODE_OPTIONS: 'credential-startup-1561'
      },
      validateImpl
    })
  ).toBe(130);
  expect(validateImpl).not.toHaveBeenCalled();
  expect(text).toContain('NODE_OPTIONS');
  expect(text).not.toContain('credential-startup-1561');
});
it('menu probe cancellation returns to the editor without saving', async () => {
  const prompts = scripted(['validate', true, 'cancel', true]);
  const select = prompts.select;
  prompts.select = options =>
    options.message === 'Validation running.' ? Promise.resolve('cancel-probe') : select(options);
  prompts.dispose = vi.fn();
  const validateImpl = vi.fn(
    ({ signal }) =>
      new Promise(resolve =>
        signal.addEventListener(
          'abort',
          () => resolve({ status: 'cancelled', category: 'cancelled', cleanup: 'complete' }),
          { once: true }
        )
      )
  );
  expect(
    await run([], {
      prompts,
      inherited: {
        HOME: home,
        SQL_SERVER_USER: 'u',
        SQL_SERVER_PASSWORD: 'credential-editor-1561'
      },
      validateImpl
    })
  ).toBe(130);
  expect(validateImpl).toHaveBeenCalledTimes(1);
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
  expect(text).toContain('Validation cancelled.');
  await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('forwards first and repeated session cancellation into an active probe', async () => {
  const controller = new globalThis.AbortController();
  let began, finish;
  const started = new Promise(resolve => (began = resolve));
  const prompts = scripted(['validate', true]);
  prompts.dispose = vi.fn();
  const validateImpl = ({ signal }) => {
    began(signal);
    return new Promise(resolve => (finish = resolve));
  };
  const running = run([], {
    prompts,
    signal: controller.signal,
    inherited: { HOME: home, SQL_SERVER_USER: 'u', SQL_SERVER_PASSWORD: 'credential-editor-1561' },
    validateImpl
  });
  const probeSignal = await started;
  let aborts = 0;
  probeSignal.addEventListener('abort', () => aborts++);
  controller.abort('SIGINT');
  controller.signal.dispatchEvent(new globalThis.Event('abort'));
  expect(aborts).toBe(2);
  finish({ status: 'cancelled', category: 'cancelled', cleanup: 'complete' });
  expect(await running).toBe(130);
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
});
it('returns SIGTERM from the main-loop abort and disposes once', async () => {
  const controller = new globalThis.AbortController();
  const prompts = scripted([
    () => {
      controller.abort('SIGTERM');
      return 'unknown';
    }
  ]);
  prompts.dispose = vi.fn();
  expect(await run([], { prompts, signal: controller.signal })).toBe(143);
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
});
it('uses the lazy adapter only for interactive terminals', async () => {
  const prompts = scripted(['cancel', true]);
  prompts.dispose = vi.fn();
  const create = vi.fn().mockResolvedValue(prompts);
  vi.doMock('../../lib/cli/config-prompts.js', () => ({ createPromptAdapter: create }));
  try {
    expect(
      await editConfigCommand({
        cwd,
        inherited: { HOME: home },
        output: output(),
        input: { isTTY: true },
        terminal: { isTTY: true }
      })
    ).toBe(130);
    expect(create).toHaveBeenCalledTimes(1);
    expect(prompts.dispose).toHaveBeenCalledTimes(1);
  } finally {
    vi.doUnmock('../../lib/cli/config-prompts.js');
  }
});
it('rejects Windows case-colliding stored values before any prompt and labels Windows limits', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    await fs.writeFile(file, '{"SQL_SERVER_HOST":"first","sql_server_host":"second"}');
    expect(await run([])).toBe(2);
    expect(text).toContain('Saved keys collide');
    await fs.unlink(file);
    text = '';
    expect(await run(['cancel', true])).toBe(130);
    expect(text).toContain('DACL');
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});
it('reports a committed directory-close warning as Saved without pretending rollback', async () => {
  const open = fs.open;
  const parent = await fs.realpath(home);
  const spy = vi.spyOn(fs, 'open').mockImplementation(async (p, ...args) => {
    const handle = await open(p, ...args);
    if (p !== parent) return handle;
    return new Proxy(handle, {
      get: (target, key) =>
        key === 'close'
          ? async () => {
              await target.close();
              throw new Error('credential-editor-1561');
            }
          : typeof target[key] === 'function'
            ? target[key].bind(target)
            : target[key]
    });
  });
  try {
    expect(
      await run(['save', true], {
        inherited: {
          HOME: home,
          SQL_SERVER_USER: 'u',
          SQL_SERVER_PASSWORD: 'credential-editor-1561'
        }
      })
    ).toBe(0);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_TRUST_CERT).toBe('false');
    expect(text).toContain('Saved, but directory durability');
    expect(text).not.toContain('credential-editor-1561');
  } finally {
    spy.mockRestore();
  }
});
it('recovers from a failed atomic publication without saving partial content', async () => {
  const spy = vi.spyOn(fs, 'link').mockRejectedValue(new Error('credential-editor-1561'));
  try {
    expect(
      await run(['save', true, 'cancel', true], {
        inherited: {
          HOME: home,
          SQL_SERVER_USER: 'u',
          SQL_SERVER_PASSWORD: 'credential-editor-1561'
        }
      })
    ).toBe(130);
    expect(text).toContain('Cannot access or save');
    expect(text).not.toContain('credential-editor-1561');
    await expect(fs.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    spy.mockRestore();
  }
});
it('reports an outer generic prompt failure without its raw bytes', async () => {
  const prompts = scripted([
    () => {
      throw new Error('credential-editor-1561');
    }
  ]);
  prompts.dispose = vi.fn();
  expect(await run([], { prompts })).toBe(2);
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
  expect(text).not.toContain('credential-editor-1561');
});
it('keeps editing after failed Save and reports uncertain lock cleanup without claiming Saved', async () => {
  const fail = new Error('credential-editor-1561\u001b[31m');
  const publication = vi.spyOn(fs, 'link').mockRejectedValue(fail);
  const remove = vi.spyOn(fs, 'rmdir').mockRejectedValue(fail);
  const answers = ['save', true, 'cancel', true];
  try {
    expect(
      await run(answers, {
        inherited: {
          HOME: home,
          SQL_SERVER_USER: 'u',
          SQL_SERVER_PASSWORD: 'credential-editor-1561'
        }
      })
    ).toBe(130);
    expect(answers).toHaveLength(0);
    expect(text).toContain('Cannot access or save');
    expect(text.match(/Lock cleanup could not be confirmed/g)).toHaveLength(1);
    expect(text).toContain('Confirm no editor is running');
    expect(text).not.toMatch(/^Saved[.,]/m);
    expect(text).not.toContain('credential-editor-1561');
    expect(text).not.toContain('\u001b');
    await expect(fs.lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.lstat(file + '.lock')).isDirectory()).toBe(true);
  } finally {
    publication.mockRestore();
    remove.mockRestore();
  }
});
const transactionDraft = () => ({
  SQL_SERVER_HOST: 'old',
  SQL_SERVER_USER: 'u',
  SQL_SERVER_PASSWORD: 'old-transaction-secret',
  SQL_SERVER_ENCRYPT: 'true',
  SQL_SERVER_TRUST_CERT: 'false',
  SQL_SERVER_READ_ONLY: 'true',
  unknown: { preserved: [1, null, true] }
});
const transactionProbe = () =>
  vi.fn().mockResolvedValue({
    version: 1,
    status: 'success',
    category: 'ok',
    stage: 'finished',
    elapsedMs: 1,
    attempts: 1,
    cleanup: 'complete'
  });
function captureReviews(renderer) {
  const reviews = [];
  const review = renderer.review;
  renderer.review = (draft, resolved) => {
    reviews.push(JSON.parse(JSON.stringify(draft)));
    return review(draft, resolved);
  };
  return reviews;
}
it('rolls back a downgrade when acknowledgement throws and safely saves the unchanged validated draft', async () => {
  const original = transactionDraft();
  await fs.writeFile(file, JSON.stringify(original));
  const prompts = scripted([
    'validate',
    true,
    'tls',
    'SQL_SERVER_ENCRYPT',
    'set',
    'false',
    'back',
    'review',
    'save',
    true
  ]);
  const confirm = prompts.confirm;
  let rejected = false;
  prompts.confirm = options => {
    if (options.message === 'Acknowledge these effective security warnings?') {
      if (!rejected) {
        rejected = true;
        throw new Error('synthetic-transaction-secret');
      }
      return true;
    }
    return confirm(options);
  };
  const renderer = output();
  const reviews = captureReviews(renderer);
  const validateImpl = transactionProbe();
  expect(await run([], { prompts, output: renderer, validateImpl })).toBe(0);
  expect(rejected).toBe(true);
  expect(validateImpl).toHaveBeenCalledTimes(1);
  expect(reviews.at(-1)).toEqual(original);
  expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(original);
  expect(text).toContain('Last validation: current draft');
  expect(text).not.toContain('Draft updated.');
  expect(text).not.toContain('synthetic-transaction-secret');
  expect(text).toContain('The operation failed.');
});
it.each(['set', 'remove', 'password'])(
  'restores the %s proposal after a real post-mutation dotenv resolution failure',
  async mutation => {
    const original = transactionDraft();
    const bytes = JSON.stringify(original);
    await fs.writeFile(file, bytes);
    const dotenv = path.join(cwd, '.env');
    await fs.writeFile(dotenv, '');
    const candidate = 'rejected-candidate-secret-1561';
    const breakSource = async () => {
      await fs.unlink(dotenv);
      await fs.mkdir(dotenv);
      return mutation === 'remove' ? true : mutation === 'password' ? candidate : 'new';
    };
    const renderer = output();
    const reviews = captureReviews(renderer);
    const repair = async () => {
      await fs.rmdir(dotenv);
      await fs.writeFile(dotenv, '');
      if (mutation === 'password') renderer.line(candidate);
      return 'back';
    };
    const prompts = scripted([
      'validate',
      true,
      mutation === 'set' ? 'connection' : 'authentication',
      mutation === 'set' ? 'SQL_SERVER_HOST' : 'SQL_SERVER_PASSWORD',
      mutation === 'password' ? 'replace' : mutation,
      breakSource,
      repair,
      'review',
      'cancel',
      true
    ]);
    const validateImpl = transactionProbe();
    expect(await run([], { prompts, output: renderer, validateImpl })).toBe(130);
    expect(reviews.at(-1)).toEqual(original);
    expect(text).toContain('Last validation: current draft');
    expect(text).not.toContain('Draft updated.');
    expect(text).toContain('The selected dotenv source or encoding cannot be read.');
    expect(text).not.toContain(candidate);
    if (mutation === 'password') expect(text).toContain('********');
    expect(validateImpl).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
);
it.each([false, true])('commits generation only for an acknowledged proposal: %s', async accept => {
  const original = transactionDraft();
  const bytes = JSON.stringify(original);
  await fs.writeFile(file, bytes);
  const prompts = scripted([
    'validate',
    true,
    'tls',
    'SQL_SERVER_ENCRYPT',
    'set',
    'false',
    'back',
    'review',
    'cancel',
    true
  ]);
  const confirm = prompts.confirm;
  prompts.confirm = options =>
    options.message === 'Acknowledge these effective security warnings?'
      ? accept
      : confirm(options);
  const renderer = output();
  const reviews = captureReviews(renderer);
  expect(await run([], { prompts, output: renderer, validateImpl: transactionProbe() })).toBe(130);
  expect(reviews.at(-1).SQL_SERVER_ENCRYPT).toBe(accept ? 'false' : 'true');
  expect(text).toContain('Last validation: ' + (accept ? 'stale' : 'current draft'));
  expect(text.match(/Draft updated\./g) || []).toHaveLength(accept ? 1 : 0);
  expect(await fs.readFile(file, 'utf8')).toBe(bytes);
});
it.each(['SIGINT', 'SIGTERM', 'ExitPromptError'])(
  'does not accept a field proposal when acknowledgement ends with %s',
  async reason => {
    const bytes = JSON.stringify(transactionDraft());
    await fs.writeFile(file, bytes);
    const controller = new globalThis.AbortController();
    const prompts = scripted(['tls', 'SQL_SERVER_ENCRYPT', 'set', 'false']);
    prompts.confirm = () => {
      if (reason === 'ExitPromptError')
        throw Object.assign(new Error('synthetic-transaction-secret'), { name: reason });
      controller.abort(reason);
      return true;
    };
    prompts.dispose = vi.fn();
    const validateImpl = transactionProbe();
    expect(await run([], { prompts, signal: controller.signal, validateImpl })).toBe(
      reason === 'SIGTERM' ? 143 : 130
    );
    expect(text).not.toContain('Draft updated.');
    expect(text).not.toContain('synthetic-transaction-secret');
    expect(validateImpl).not.toHaveBeenCalled();
    expect(prompts.dispose).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(file, 'utf8')).toBe(bytes);
  }
);
it('keeps an accepted draft and stale generation if final success presentation fails', async () => {
  const original = transactionDraft();
  await fs.writeFile(file, JSON.stringify(original));
  const renderer = output();
  const line = renderer.line;
  renderer.line = value => {
    if (value.startsWith('Draft updated.')) throw new Error('synthetic-transaction-secret');
    return line(value);
  };
  const reviews = captureReviews(renderer);
  const validateImpl = transactionProbe();
  expect(
    await run(
      [
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
      ],
      { output: renderer, validateImpl }
    )
  ).toBe(0);
  expect(reviews.at(-1).SQL_SERVER_HOST).toBe('new');
  expect(JSON.parse(await fs.readFile(file, 'utf8')).SQL_SERVER_HOST).toBe('new');
  expect(text).toContain('Last validation: stale');
  expect(text).not.toContain('synthetic-transaction-secret');
  expect(validateImpl).toHaveBeenCalledTimes(1);
});
it('reports missing home through the actual editor path with injected interactive prompts', async () => {
  const prompts = scripted([]);
  prompts.dispose = vi.fn();
  expect(
    await run([], { inherited: {}, prompts, input: { isTTY: true }, terminal: { isTTY: true } })
  ).toBe(2);
  expect(text).toContain('HOME or USERPROFILE is required.');
  expect(text).not.toContain('interactive stdin');
  expect(prompts.dispose).toHaveBeenCalledTimes(1);
});
