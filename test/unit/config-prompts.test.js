import { PassThrough } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { createConfigOutput } from '../../lib/cli/config-output.js';
import { createPromptAdapter } from '../../lib/cli/config-prompts.js';
const calls = vi.hoisted(() => []);
vi.mock('@inquirer/prompts', () =>
  Object.fromEntries(
    ['input', 'select', 'confirm', 'password'].map(name => [
      name,
      vi.fn(async (...args) => {
        calls.push([name, ...args]);
        return name === 'confirm' ? true : 'value';
      })
    ])
  )
);
it('uses hidden password entry, abort context and sanitized messages/defaults', async () => {
  calls.length = 0;
  const stream = new PassThrough();
  const c = new globalThis.AbortController();
  const p = await createPromptAdapter({ input: stream, output: stream, signal: c.signal });
  await p.input({ message: 'host\u001b[31m', defaultValue: '\u001b]0;bad\u0007host' });
  await p.password({ message: 'Password', validate: () => true });
  await p.confirm({ message: 'save', defaultValue: false });
  expect(calls[0][1]).toMatchObject({ message: 'host', default: 'host' });
  expect(calls[0][2].signal).toBe(c.signal);
  expect(calls[1][1]).not.toHaveProperty('default');
  expect(calls[1][1].mask).toBe(false);
  expect(calls[2][1].default).toBe(false);
});
it('restores the input flow after an editor session so a TTY does not keep the CLI alive', async () => {
  const stream = new PassThrough();
  const adapter = await createPromptAdapter({ input: stream, output: new PassThrough() });
  stream.resume();
  adapter.dispose();
  expect(stream.isPaused()).toBe(true);
});

it('never reconstructs known passwords in renderer-backed prompt messages or defaults', async () => {
  calls.length = 0;
  const stream = new PassThrough();
  const renderer = createConfigOutput({ secrets: ['review-secret-1559'] });
  const adapter = await createPromptAdapter({ input: stream, output: stream, renderer });
  await adapter.input({
    message: 'review-\u001b[31msecret-1559',
    defaultValue: 'review-\u202esecret-1559'
  });
  expect(calls[0][1]).toMatchObject({ message: '********', default: '********' });
  adapter.dispose();
});
it('sanitizes string/object select choices while retaining values and per-prompt cancellation', async () => {
  calls.length = 0;
  const stream = new PassThrough();
  const controller = new globalThis.AbortController();
  const renderer = createConfigOutput({ secrets: ['credential-prompt-1561'] });
  const adapter = await createPromptAdapter({ input: stream, output: stream, renderer });
  await adapter.select({
    message: 'choose',
    signal: controller.signal,
    choices: [
      'credential-prompt-1561',
      {
        name: 'credential-prompt-1561\u001b[31m',
        description: 'credential-prompt-1561😀',
        value: 'keep-original-value'
      }
    ]
  });
  expect(calls[0][1].choices).toEqual([
    '********',
    { name: '********', description: '********😀', value: 'keep-original-value' }
  ]);
  expect(calls[0][2].signal).toBe(controller.signal);
  adapter.dispose();
});
