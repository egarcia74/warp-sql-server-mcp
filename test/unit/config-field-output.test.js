import { expect, it } from 'vitest';
import { createConfigOutput } from '../../lib/cli/config-output.js';

function render(
  key,
  draft,
  environment,
  sources,
  dotenv = { path: '/project/selected.env', override: false },
  candidates = []
) {
  let text = '';
  const stream = { write: s => (text += s) };
  const output = createConfigOutput({ stdout: stream, stderr: stream });
  output.fieldReview(key, draft, { environment, sources, dotenv, passwordCandidates: candidates });
  return text;
}

it.each(['same', 'different'])(
  'shows the inherited winner and blocking warning even when the saved value is %s',
  saved => {
    const text = render(
      'SQL_SERVER_HOST',
      { SQL_SERVER_HOST: saved },
      { SQL_SERVER_HOST: 'same' },
      { SQL_SERVER_HOST: 'inherited' }
    );
    expect(text).toContain(`File value (draft): ${saved}`);
    expect(text).toContain('Effective here: same');
    expect(text).toContain('Source: inherited environment variable SQL_SERVER_HOST');
    expect(text).toContain('Changing the file value will not change the effective value here');
  }
);

it('distinguishes an empty inherited fallback from a blocking override', () => {
  const text = render(
    'SQL_SERVER_HOST',
    {},
    { SQL_SERVER_HOST: '' },
    { SQL_SERVER_HOST: 'inherited' }
  );
  expect(text).toContain('File value (draft): (not set)');
  expect(text).toContain('Effective here: localhost');
  expect(text).toContain('explicit empty uses runtime default');
  expect(text).toContain('Setting a file value can replace this fallback');
  expect(text).not.toContain('will not change');
});

it.each([false, true])('labels the actual dotenv path and distinguishes override=%s', override => {
  const text = render(
    'SQL_SERVER_HOST',
    {},
    { SQL_SERVER_HOST: 'dotenv-host' },
    { SQL_SERVER_HOST: 'dotenv' },
    { path: '/project/custom.env', override }
  );
  expect(text).toContain('Effective here: dotenv-host');
  expect(text).toContain('Source: dotenv file /project/custom.env');
  expect(text).toContain(`override ${override ? 'enabled' : 'disabled'}`);
  expect(text).toContain(
    override
      ? 'Changing the file value will not change'
      : 'Setting a file value can replace this fallback'
  );
});

it('warns for identical dotenv and draft values with override enabled', () => {
  const text = render(
    'SQL_SERVER_HOST',
    { SQL_SERVER_HOST: 'same' },
    { SQL_SERVER_HOST: 'same' },
    { SQL_SERVER_HOST: 'dotenv' },
    { path: '/project/.env', override: true }
  );
  expect(text).toContain('Changing the file value will not change');
});

it.each([
  [
    'SQL_SERVER_HOST',
    { SQL_SERVER_HOST: 'saved' },
    { SQL_SERVER_HOST: 'saved' },
    { SQL_SERVER_HOST: 'file' },
    'saved',
    'file value (draft)'
  ],
  ['SQL_SERVER_HOST', {}, {}, {}, 'localhost', 'built-in default'],
  ['SQL_SERVER_TRUST_CERT', {}, { SQL_SERVER_HOST: 'localhost' }, {}, 'true', 'contextual default'],
  ['SQL_SERVER_USER', {}, {}, {}, '(not set)', 'not set']
])(
  'renders %s draft and effective source accurately %#',
  (key, draft, env, sources, effective, source) => {
    const text = render(key, draft, env, sources);
    expect(text).toContain(`Effective here: ${effective}`);
    expect(text).toContain(`Source: ${source}`);
    expect(text).not.toContain('will not change');
  }
);

it.each([
  [{}, {}, {}, '(not set)', '(not set)'],
  [
    { SQL_SERVER_PASSWORD: '' },
    { SQL_SERVER_PASSWORD: '' },
    { SQL_SERVER_PASSWORD: 'file' },
    '(explicit empty)',
    '(explicit empty)'
  ],
  [
    {},
    { SQL_SERVER_PASSWORD: 'synthetic-field-password' },
    { SQL_SERVER_PASSWORD: 'inherited' },
    '(not set)',
    '********'
  ]
])(
  'keeps password absence, empty and presence distinct %#',
  (draft, environment, sources, saved, effective) => {
    const text = render('SQL_SERVER_PASSWORD', draft, environment, sources);
    expect(text).toContain(`File value (draft): ${saved}`);
    expect(text).toContain(`Effective here: ${effective}`);
    expect(text).not.toContain('synthetic-field-password');
  }
);

it('registers unused password candidates before rendering source paths and strips controls', () => {
  const text = render(
    'SQL_SERVER_HOST',
    { SQL_SERVER_HOST: 'unused-password' },
    { SQL_SERVER_HOST: 'effective-password', SQL_SERVER_PASSWORD: 'effective-password' },
    { SQL_SERVER_HOST: 'dotenv' },
    { path: '/project/unused-\u001b[31mpassword.env', override: true },
    ['unused-password']
  );
  expect(text).toContain('/project/********.env');
  expect(text).not.toContain('unused-password');
  expect(text).not.toContain('effective-password');
  expect(text).not.toContain('\u001b');
});

it('looks up a mixed-case Windows saved field without changing it', () => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const draft = { Sql_Server_Host: 'saved-host' };
  try {
    expect(
      render(
        'SQL_SERVER_HOST',
        draft,
        { SQL_SERVER_HOST: 'saved-host' },
        { SQL_SERVER_HOST: 'file' }
      )
    ).toContain('File value (draft): saved-host');
    expect(draft).toEqual({ Sql_Server_Host: 'saved-host' });
  } finally {
    Object.defineProperty(process, 'platform', descriptor);
  }
});
