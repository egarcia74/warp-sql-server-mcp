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
 * set of suppressions, and the complete set of ESLint directive comments across everything
 * ESLint lints under `test/` - the set is taken from ESLint itself rather than a glob,
 * because a glob omits hidden paths and a hidden file is still linted.
 * Adding either fails a test until the allow-list is updated in the same change, where a
 * reviewer sees it.
 */
/**
 * `git`, `git.exe`, or a shell command starting with one of them.
 *
 * Case-insensitive: Windows resolves executables without regard to case, so `Git` and
 * `GIT.EXE` launch the same binary and inherit the same GIT_* variables. Leading whitespace
 * is allowed because `exec`/`execSync` take a shell command, where `' git status'` is valid.
 *
 * The boundary after the name accepts shell metacharacters, not only whitespace: in a shell
 * command `git>/dev/null init` and `git;echo hi` both run git. That over-matches slightly
 * for `execFile`/`spawn`, whose first argument is an executable name rather than a shell
 * command - a file literally called `git;` would be reported - which is a harmless false
 * positive in a guard whose remedy is to route the call through runGit().
 *
 * Quotes and a backslash count as boundaries too: a POSIX shell removes them before
 * execution, so `git"" status` and a backslash-newline continuation both run git status.
 */
/**
 * Two families, because they carry different risks and admit different checks.
 *
 * `exec`/`execSync` take a SHELL COMMAND. Locating the git word inside one means parsing
 * shell grammar - operators, reserved words like `then`, `{` grouping, leading redirections,
 * quoting, escaping, interpolation - and a regex in an esquery attribute cannot do that.
 * Successive attempts here missed `mkdir -p f && git init`, `{ git status; }` and
 * `if true; then git status; fi`, while reporting `echo "x; git status"`, where the word is
 * data. So position is no longer interpreted at all: a shell command that MENTIONS git as a
 * word must carry the scrub. That over-matches deliberately - `echo "git is nice"` is
 * reported - and the remedy is one argument, which is the right trade for a hazard whose
 * failure mode rewrote the real repository.
 *
 * `execFile`/`execFileSync`/`spawn`/`spawnSync` take an EXECUTABLE NAME with no shell, so
 * there is nothing to parse: the first argument either names git or does not.
 */
const SHELL_CALLEES = '/^(exec|execSync)$/';
const ARGV_CALLEES = '/^(execFile|execFileSync|spawn|spawnSync)$/';
/** git as a whole word, wherever it appears in a shell command. */
const GIT_MENTION = String.raw`/\bgit(\.exe)?\b/i`;
/**
 * An executable named git, with or without a directory. No shell is involved, so the name is
 * exact - but `/usr/bin/git` and `./git` run git just as surely as the bare name, and no
 * leading whitespace is stripped by these APIs, unlike a shell command.
 */
const GIT_EXECUTABLE = String.raw`/(^|[\\/])git(\.exe)?$/i`;
/** Options carrying `shell: true`, which turns an argv API into a shell one. */
const SHELL_OPTION = ":has(Property[key.name='shell'][value.value=true])";

/** The one sanctioned shape for a direct spawn: the options object names the scrub. */
const NOT_SCRUBBED =
  ":not(:has(Property[key.name='env'] > CallExpression[callee.name='scrubbedEnv']))";

export const UNSCRUBBED_GIT_SPAWN_SELECTORS = [
  // Shell commands: a string that mentions git...
  `CallExpression[callee.name=${SHELL_CALLEES}][arguments.0.value=${GIT_MENTION}]${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${SHELL_CALLEES}][arguments.0.value=${GIT_MENTION}]${NOT_SCRUBBED}`,
  // ...a template ANY of whose quasis does. Checking only quasis.0 missed
  // execSync(`cd ${dir} && git status`). Requiring arguments.0 to BE the template keeps a
  // template elsewhere in the call - an options value, say - from triggering this.
  `CallExpression[callee.name=${SHELL_CALLEES}][arguments.0.type='TemplateLiteral']:has(TemplateElement[value.raw=${GIT_MENTION}])${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${SHELL_CALLEES}][arguments.0.type='TemplateLiteral']:has(TemplateElement[value.raw=${GIT_MENTION}])${NOT_SCRUBBED}`,
  `CallExpression[callee.name=${SHELL_CALLEES}][arguments.0.type='TemplateLiteral']:has(TemplateElement[value.cooked=${GIT_MENTION}])${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${SHELL_CALLEES}][arguments.0.type='TemplateLiteral']:has(TemplateElement[value.cooked=${GIT_MENTION}])${NOT_SCRUBBED}`,
  // ...or a concatenation, whose `.value` does not exist at all: execSync('git ' + sub) was
  // silent because the first argument is a BinaryExpression, not a Literal.
  `CallExpression[callee.name=${SHELL_CALLEES}][arguments.0.type='BinaryExpression']:has(Literal[value=${GIT_MENTION}])${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${SHELL_CALLEES}][arguments.0.type='BinaryExpression']:has(Literal[value=${GIT_MENTION}])${NOT_SCRUBBED}`,
  // Executable names: exact, since no shell reinterprets them.
  `CallExpression[callee.name=${ARGV_CALLEES}][arguments.0.value=${GIT_EXECUTABLE}]${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${ARGV_CALLEES}][arguments.0.value=${GIT_EXECUTABLE}]${NOT_SCRUBBED}`,
  `CallExpression[callee.name=${ARGV_CALLEES}][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=${GIT_EXECUTABLE}]${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${ARGV_CALLEES}][arguments.0.expressions.length=0][arguments.0.quasis.0.value.cooked=${GIT_EXECUTABLE}]${NOT_SCRUBBED}`,
  // ...except with `shell: true`, which hands the first argument to a shell after all, so
  // the mention policy applies: spawnSync('mkdir -p f && git init', { shell: true }).
  `CallExpression[callee.name=${ARGV_CALLEES}]${SHELL_OPTION}[arguments.0.value=${GIT_MENTION}]${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${ARGV_CALLEES}]${SHELL_OPTION}[arguments.0.value=${GIT_MENTION}]${NOT_SCRUBBED}`,
  `CallExpression[callee.name=${ARGV_CALLEES}]${SHELL_OPTION}[arguments.0.type='TemplateLiteral']:has(TemplateElement[value.raw=${GIT_MENTION}])${NOT_SCRUBBED}`,
  `CallExpression[callee.property.name=${ARGV_CALLEES}]${SHELL_OPTION}[arguments.0.type='TemplateLiteral']:has(TemplateElement[value.raw=${GIT_MENTION}])${NOT_SCRUBBED}`
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
