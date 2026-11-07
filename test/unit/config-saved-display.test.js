import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { projectSavedConfig } from '../../lib/cli/saved-config-display.js';
let home, file;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'config-saved-display-'));
  file = path.join(home, '.warp-sql-server-mcp.json');
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));
function display(value) {
  const bytes = JSON.stringify(value);
  fs.writeFileSync(file, bytes, { mode: 0o600 });
  fs.writeFileSync(path.join(home, '.env'), 'SQL_SERVER_HOST=dotenv-decoy\n');
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../../cli.js', import.meta.url)), 'config'],
    {
      cwd: home,
      env: { ...process.env, HOME: home, SQL_SERVER_HOST: 'inherited-decoy' },
      encoding: 'utf8',
      timeout: 5000
    }
  );
  expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
  const json = result.stdout.split('Current settings:\n')[1];
  return { result, projected: json === undefined ? undefined : JSON.parse(json) };
}
it.each([
  ['SQL_SERVER_PASSWORD', 'credential-1561', 'credential-1561'],
  ['sql_server_password', 'credential-1561', 'credential-1561'],
  ['Sql_Server_Password', 12345678, '12345678'],
  ['SQL_SERVER_PASSWORD', '12345678', 12345678],
  ['SQL_SERVER_PASSWORD', false, false],
  ['SQL_SERVER_PASSWORD', null, null, '***MASKED***'],
  ['SQL_SERVER_PASSWORD', [12, 'credential-1561'], '12,credential-1561'],
  ['SQL_SERVER_PASSWORD', { ordinary: true }, '[object Object]']
])('masks saved credential coercion and nested copies %#', (key, password, copy, absent = null) => {
  const { result, projected } = display({
    [key]: password,
    SQL_SERVER_HOST: 'saved-host',
    nested: [{ copy }],
    ordinary: { number: 42, flag: true, empty: '', absent: null }
  });
  expect(result.status).toBe(0);
  expect(projected[key]).toBe('***MASKED***');
  expect(projected.nested).toEqual([{ copy: '***MASKED***' }]);
  expect(projected.SQL_SERVER_HOST).toBe('saved-host');
  expect(projected.ordinary).toEqual({ number: 42, flag: true, empty: '', absent });
  if (typeof copy === 'string' || typeof copy === 'number')
    expect((result.stdout + result.stderr).includes(String(copy))).toBe(false);
});
it('preserves explicit empty passwords, unrelated JSON types, escapes and non-BMP text', () => {
  const saved = {
    SQL_SERVER_PASSWORD: '',
    unknown: [3, true, null, '', 'quote"\n\u001b[31m😀'],
    SQL_SERVER_HOST: 'saved-host'
  };
  const { result, projected } = display(saved);
  expect(result.status).toBe(0);
  expect(projected).toEqual(saved);
});
it('redacts longest original matches without recursively modifying inserted masks', () => {
  const { projected } = display({
    SQL_SERVER_PASSWORD: 'credential-1561',
    sql_server_password: 'credential',
    nested: { SQL_SERVER_PASSWORD: '*', copy: 'credential-1561/credential/*' }
  });
  expect(projected.nested.copy).toBe('***MASKED***/***MASKED***/***MASKED***');
  expect(projected.SQL_SERVER_PASSWORD).toBe('***MASKED***');
  expect(projected.sql_server_password).toBe('***MASKED***');
});
it('treats a password equal to the mask as masked rather than requiring impossible marker absence', () => {
  expect(display({ SQL_SERVER_PASSWORD: '***MASKED***', copy: '***MASKED***' }).projected).toEqual({
    SQL_SERVER_PASSWORD: '***MASKED***',
    copy: '***MASKED***'
  });
});
it('redacts quotes, control and non-BMP credential bytes before JSON serialization', () => {
  const password = 'credential-"\u001b[31m😀-1561';
  const { result, projected } = display({
    SQL_SERVER_PASSWORD: password,
    nested: { [password]: [password] }
  });
  expect(result.status).toBe(0);
  expect(projected.nested).toEqual({ '***MASKED***': ['***MASKED***'] });
  expect(result.stdout).not.toContain('credential-');
});
it.each([false, true])(
  'preserves prototype-named keys and colliding redacted members, reversed=%s',
  reverse => {
    const saved = JSON.parse(
      '{"__proto__":{"safe":true},"constructor":"ordinary-constructor","prototype":17,"SQL_SERVER_PASSWORD":"credential-1561"}'
    );
    const entries = [
      ['credential-1561', 'renamed-member'],
      ['***MASKED***', 'ordinary-member'],
      ['***MASKED***credential-1561', 'another-renamed-member']
    ];
    for (const [key, value] of reverse ? entries.reverse() : entries)
      Object.defineProperty(saved, key, { value, enumerable: true });
    const { result, projected } = display(saved);
    expect(result.status).toBe(0);
    expect(Object.keys(projected)).toHaveLength(7);
    expect(Object.hasOwn(projected, '__proto__')).toBe(true);
    expect(projected.__proto__).toEqual({ safe: true });
    expect(projected.constructor).toBe('ordinary-constructor');
    expect(projected.prototype).toBe(17);
    expect(projected['***MASKED***']).toBe('ordinary-member');
    expect(Object.values(projected)).toEqual(
      expect.arrayContaining(['renamed-member', 'another-renamed-member'])
    );
    expect(result.stdout).not.toContain('credential-1561');
  }
);
it.each([null, [1, { ordinary: true }], 'word', 3])(
  'preserves unusual legacy root spread presentation %#',
  saved => {
    const expected = Object.fromEntries(Object.entries(saved ?? {}));
    expect(display(saved).projected).toEqual(expected);
  }
);
it('fails generically before saved output when a password cannot undergo legacy String conversion', () => {
  const { result, projected } = display({
    SQL_SERVER_PASSWORD: { toString: 'non-callable-credential-1561' },
    ordinary: 'retain-on-disk'
  });
  expect(result.status).toBe(1);
  expect(projected).toBeUndefined();
  expect(result.stdout + result.stderr).not.toContain('non-callable-credential-1561');
  expect(result.stderr).toContain('invalid or unreadable JSON');
});

it('projects without mutation, recursion into replacements, prototype changes or member loss', () => {
  const input = JSON.parse(
    '{"__proto__":{"safe":true},"constructor":"unchanged","SQL_SERVER_PASSWORD":"credential-1561","sql_server_password":"credential","nested":{"SQL_SERVER_PASSWORD":"*","copy":"credential-1561/credential/*","credential-1561":"renamed","***MASKED***":"reserved"}}'
  );
  input.ordinary = [42, true, null, '', 'quote"\n😀'];
  const before = JSON.stringify(input);
  const output = projectSavedConfig(input);
  expect(JSON.stringify(input)).toBe(before);
  expect(Object.getPrototypeOf(output)).toBe(null);
  expect(output.__proto__).toEqual({ safe: true });
  expect(output.constructor).toBe('unchanged');
  expect(output.nested.copy).toBe('***MASKED***/***MASKED***/***MASKED***');
  expect(Object.values(output.nested)).toEqual(expect.arrayContaining(['reserved', 'renamed']));
  expect(output.ordinary).toEqual(input.ordinary);
  expect(Object.keys(output.nested)).toHaveLength(4);
});
it.each([
  [12345678, '12345678'],
  ['12345678', 12345678],
  [false, false],
  [null, null],
  [[12, 'credential-1561'], '12,credential-1561'],
  [{ ordinary: true }, '[object Object]']
])(
  'masks actual legacy String candidates and scalar copies in the production projection %#',
  (password, copy) => {
    const input = { SQL_SERVER_PASSWORD: password, nested: [copy], empty: '' };
    const before = JSON.stringify(input);
    expect(projectSavedConfig(input)).toEqual({
      SQL_SERVER_PASSWORD: '***MASKED***',
      nested: ['***MASKED***'],
      empty: ''
    });
    expect(JSON.stringify(input)).toBe(before);
  }
);
it('keeps empty and mask-equal passwords structurally safe', () => {
  expect(
    projectSavedConfig({
      SQL_SERVER_PASSWORD: '',
      nested: { sql_server_password: '***MASKED***', copy: '***MASKED***' }
    })
  ).toEqual({
    SQL_SERVER_PASSWORD: '',
    nested: { sql_server_password: '***MASKED***', copy: '***MASKED***' }
  });
});
it('does not print an unconvertible password or any unknown value before failing', () => {
  expect(() =>
    projectSavedConfig({ SQL_SERVER_PASSWORD: { toString: null }, copy: 'do-not-print' })
  ).toThrow(TypeError);
});

it('reserves unrelated literal-mask keys before assigning collision-safe sensitive names', () => {
  const saved = {
    SQL_SERVER_PASSWORD: 'credential-1561',
    'credential-1561': 'renamed',
    '***MASKED***': 'ordinary',
    '***MASKED***credential-1561': 'another'
  };
  expect(projectSavedConfig(saved)).toEqual({
    SQL_SERVER_PASSWORD: '***MASKED***',
    '***MASKED******MASKED***': 'renamed',
    '***MASKED***': 'ordinary',
    '***MASKED******MASKED******MASKED***': 'another'
  });
});
