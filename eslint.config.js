import js from '@eslint/js';

/**
 * Guards the fix from #1207 against being reintroduced by a new test (#1214).
 *
 * On 2026-09-11 `test/unit/verify-publish-tree.test.js`, run by the pre-commit hook from
 * inside a LINKED GIT WORKTREE, inherited `GIT_DIR`/`GIT_WORK_TREE`/`GIT_INDEX_FILE` from
 * the hook environment. Those beat `cwd`, so every git the test spawned against its
 * temp-directory fixtures operated on the REAL repository instead: `core.worktree` was
 * re-pointed at a since-deleted temp dir, the committer identity was overwritten, a fake
 * `v1.8.0` tag appeared and five fixture commits landed on a live branch. `scrubbedEnv()`
 * (exported from `scripts/ci/verify-publish-tree.mjs`) strips every `GIT_*` name, case
 * insensitively, and fixed that one file. Any NEW test that spawns git with the inherited
 * environment reintroduces the whole incident, so the absence of the scrub is a lint error.
 *
 * Scoped to `test/**` only. `scripts/` and `lib/` spawn git deliberately against the real
 * repository - that is their job - and are untouched by this rule.
 *
 * WHAT IS MATCHED: a `child_process` spawn whose command argument is the literal `git`
 * (`'git'`, `'git.exe'`, or a string/template command starting `git `), called either bare
 * (`execFileSync(...)`) or through a namespace (`cp.execFileSync(...)`), UNLESS the call
 * passes `env: scrubbedEnv()`. Routing the spawn through `runGit()` in
 * `test/helpers/git.js` is not a `child_process` call at all and so never matches.
 *
 * WHAT IS NOT MATCHED (the residual, deliberately stated rather than implied): the check is
 * syntactic. A command held in a variable (`const cmd = 'git'; execFileSync(cmd, ...)`), an
 * absolute path (`/usr/bin/git`), a git invoked through a shell wrapper or through `npm`,
 * an options object built elsewhere and spread in, a local function that is *named*
 * `scrubbedEnv` but scrubs nothing, and an `env: scrubbedEnv()` nested inside some other
 * property of the options object all slip past it. So does an aliased import
 * (`import { execFileSync as run }`), since the selectors match on the callee's name. It
 * also cannot see the runtime value of what `scrubbedEnv` returns - only that the name is
 * there.
 *
 * Matching on the name alone also errs the other way: the selectors never check that the
 * callee was imported from `node:child_process`, so an unrelated `runner.execFileSync(...)`
 * or a locally shadowed `execSync` is reported even though it cannot inherit git's
 * environment. esquery cannot resolve bindings, so this is accepted rather than solved -
 * route such a call through `runGit()`, or suppress it and let the pin below surface it.
 *
 * An `eslint-disable` comment defeats the rule outright, and so does an inline
 * configuration such as `/* eslint no-restricted-syntax: off *\/`, which produces no
 * problem at all and therefore appears in neither ESLint's reports nor its
 * `suppressedMessages`. `test/unit/git-spawn-scrub-guard.test.js` pins BOTH: the complete
 * set of suppressions, and the complete set of ESLint directive comments in the test tree.
 * Adding either fails a test until the allow-list is updated in the same change, where a
 * reviewer sees it.
 */
const GIT_SPAWN_CALLEES = '/^(exec|execSync|execFile|execFileSync|spawn|spawnSync)$/';
/**
 * `git`, `git.exe`, or a shell-command string that starts with one of them. Matched
 * case-insensitively: Windows resolves executables without regard to case, so `Git` and
 * `GIT.EXE` launch the same binary and inherit the same GIT_* variables.
 */
const GIT_COMMAND = String.raw`/^git(\.exe)?($|\s)/i`;
/** The one sanctioned shape for a direct spawn: the options object names the scrub. */
const NOT_SCRUBBED =
  ":not(:has(Property[key.name='env'] > CallExpression[callee.name='scrubbedEnv']))";

export const UNSCRUBBED_GIT_SPAWN_SELECTORS = [
  // execFileSync('git', args, opts) / spawnSync('git', ...) / execSync('git status', ...)
  `CallExpression[callee.name=${GIT_SPAWN_CALLEES}][arguments.0.value=${GIT_COMMAND}]${NOT_SCRUBBED}`,
  // cp.execFileSync('git', ...) / child_process.spawnSync('git', ...)
  `CallExpression[callee.property.name=${GIT_SPAWN_CALLEES}][arguments.0.value=${GIT_COMMAND}]${NOT_SCRUBBED}`,
  // execSync(`git ${subcommand}`) - a template literal has no `.value` to match on.
  `CallExpression[callee.name=${GIT_SPAWN_CALLEES}][arguments.0.quasis.0.value.raw=${GIT_COMMAND}]${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${GIT_SPAWN_CALLEES}][arguments.0.quasis.0.value.raw=${GIT_COMMAND}]${NOT_SCRUBBED}`
];

export const UNSCRUBBED_GIT_SPAWN_MESSAGE =
  'Spawning git from test/ must strip the inherited GIT_* environment, which otherwise ' +
  'beats cwd and redirects the child at the real repository (see #1207/#1214). Use ' +
  'runGit() from test/helpers/git.js, or pass env: scrubbedEnv() from ' +
  'scripts/ci/verify-publish-tree.mjs.';

export default [
  // A config object whose ONLY key is `ignores` sets GLOBAL ignores. With any other key
  // beside it, `ignores` merely narrows that one block - which is how this list sat inert:
  // before this was split out, `eslint .` still linted coverage/, dist/, build/ and
  // .codacy/ (89 files, 3 of them generated files under coverage/).
  //
  // .claude/worktrees/ and .worktrees/ are gitignored checkouts that agents work in.
  // Linting them lets one branch's work-in-progress fail an unrelated branch's pre-push
  // hook, which runs `eslint .` over the whole tree. That happened on 2026-09-12.
  {
    ignores: [
      'node_modules/**',
      'coverage/**',
      '.git/**',
      '.codacy/**',
      'dist/**',
      'build/**',
      '.claude/worktrees/**',
      '.worktrees/**'
    ]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        global: 'readonly',
        globalThis: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly'
      }
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_'
        }
      ],
      'no-console': 'off', // Allow console statements in server code
      'prefer-const': 'error',
      'no-var': 'error',
      semi: ['error', 'always'],
      quotes: ['error', 'single', { avoidEscape: true }],
      // Disable indent rule - let Prettier handle formatting
      indent: 'off',
      'comma-dangle': ['error', 'never'],
      'object-curly-spacing': ['error', 'always'],
      'array-bracket-spacing': ['error', 'never'],
      'space-before-blocks': 'error',
      'keyword-spacing': 'error',
      'space-infix-ops': 'error',
      'eol-last': 'error',
      'no-trailing-spaces': 'error',
      'no-multiple-empty-lines': ['error', { max: 2, maxEOF: 1 }]
    }
  },
  {
    files: ['**/*.test.js', '**/*.spec.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    }
  },
  {
    // Every JavaScript file under test/, not just the *.test.js suites: fixtures, helpers
    // and the docker/manual runners spawn child processes too.
    files: ['test/**/*.js', 'test/**/*.mjs', 'test/**/*.cjs'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...UNSCRUBBED_GIT_SPAWN_SELECTORS.map(selector => ({
          selector,
          message: UNSCRUBBED_GIT_SPAWN_MESSAGE
        }))
      ]
    }
  }
];
