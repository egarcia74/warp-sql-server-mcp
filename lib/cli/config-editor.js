import { getConfigPath, resolveEffectiveConfig, environmentKey } from '../config/environment.js';
import { readConfigSnapshot, saveConfigSnapshot } from '../config/config-store.js';
import {
  CONFIG_FIELDS,
  isValidValue,
  checkStoredConfig,
  checkEffectiveConfig,
  assessSecurityChanges
} from '../config/config-schema.js';
import { createConfigOutput, MESSAGES } from './config-output.js';
import {
  runConfigValidation,
  reportProbe,
  unsupportedStartupVariables
} from './config-validation.js';
const SECTIONS = {
  connection: ['SQL_SERVER_HOST', 'SQL_SERVER_PORT', 'SQL_SERVER_DATABASE'],
  authentication: ['SQL_SERVER_USER', 'SQL_SERVER_PASSWORD', 'SQL_SERVER_DOMAIN'],
  tls: ['SQL_SERVER_ENCRYPT', 'SQL_SERVER_TRUST_CERT'],
  safety: [
    'SQL_SERVER_READ_ONLY',
    'SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS',
    'SQL_SERVER_ALLOW_SCHEMA_CHANGES'
  ],
  advanced: [
    'SQL_SERVER_CONNECT_TIMEOUT_MS',
    'SQL_SERVER_REQUEST_TIMEOUT_MS',
    'SQL_SERVER_MAX_RETRIES',
    'SQL_SERVER_RETRY_DELAY_MS',
    'SQL_SERVER_POOL_MAX',
    'SQL_SERVER_POOL_MIN',
    'SQL_SERVER_POOL_IDLE_TIMEOUT_MS'
  ]
};
const choices = (...items) => items.map(([value, name]) => ({ value, name }));
const MAIN = choices(
  ['connection', 'Connection'],
  ['authentication', 'Authentication'],
  ['tls', 'TLS'],
  ['safety', 'Safety'],
  ['advanced', 'Advanced connection settings'],
  ['review', 'Review'],
  ['validate', 'Validate connection'],
  ['save', 'Save'],
  ['cancel', 'Cancel']
);
const DEFAULTS = {
  SQL_SERVER_HOST: 'localhost',
  SQL_SERVER_PORT: '1433',
  SQL_SERVER_DATABASE: 'master',
  SQL_SERVER_ENCRYPT: 'true',
  SQL_SERVER_TRUST_CERT: 'false',
  SQL_SERVER_READ_ONLY: 'true',
  SQL_SERVER_ALLOW_DESTRUCTIVE_OPERATIONS: 'false',
  SQL_SERVER_ALLOW_SCHEMA_CHANGES: 'false',
  SQL_SERVER_CONNECT_TIMEOUT_MS: '10000',
  SQL_SERVER_REQUEST_TIMEOUT_MS: '30000',
  SQL_SERVER_MAX_RETRIES: '3',
  SQL_SERVER_RETRY_DELAY_MS: '1000'
};
const clone = values => Object.assign(Object.create(null), globalThis.structuredClone(values));
const abortCode = signal => (signal?.reason === 'SIGTERM' ? 143 : 130);
export async function editConfigCommand({
  cwd = process.cwd(),
  inherited = { ...process.env },
  prompts,
  output = createConfigOutput(),
  signal,
  input = process.stdin,
  terminal = process.stdout,
  validateImpl = runConfigValidation
} = {}) {
  if (!prompts && (!input.isTTY || !terminal.isTTY)) {
    output.error({ code: 'non-tty' });
    return 2;
  }
  if (signal?.aborted) return abortCode(signal);
  // Never mutate or use newly changed process.env as the editor's inherited baseline.
  inherited = Object.freeze({ ...inherited });
  output.addSecrets(inherited);
  let snapshot,
    draft,
    generation = 0,
    lastValidation;
  try {
    snapshot = await readConfigSnapshot(getConfigPath(inherited));
    output.addSecrets(snapshot.values);
    if (checkStoredConfig(snapshot.values).errors.some(e => e.code === 'duplicate-file-key')) {
      output.error({ code: 'duplicate-file-key' });
      return 2;
    }
    draft = clone(snapshot.exists ? snapshot.values : DEFAULTS);
    if (!prompts) {
      const { createPromptAdapter } = await import('./config-prompts.js');
      prompts = await createPromptAdapter({ input, output: terminal, signal, renderer: output });
    }
    const resolve = () => {
      const r = resolveEffectiveConfig({ inherited, fileValues: draft, cwd });
      output.addSecrets(r.environment, r.passwordCandidates);
      return r;
    };
    const dirty = () =>
      !snapshot.exists || JSON.stringify(draft) !== JSON.stringify(snapshot.values);
    const confirm = message =>
      prompts.confirm({ message: output.safe(message), defaultValue: false });
    const refresh = () => {
      const stored = checkStoredConfig(draft);
      output.checks(stored);
      if (stored.errors.length) return null;
      const r = resolve(),
        effective = checkEffectiveConfig(r);
      output.checks(effective);
      if (effective.errors.length) return null;
      return { resolved: r, warnings: effective.warnings };
    };
    const acknowledge = async codes => {
      if (!codes.length) return true;
      for (const code of codes) output.line(MESSAGES[code] || MESSAGES.runtime);
      return confirm('Acknowledge these effective security warnings?');
    };
    async function editField(field) {
      const key = Object.keys(draft).find(k => environmentKey(k) === field) ?? field;
      resolve();
      const secret = field === 'SQL_SERVER_PASSWORD';
      output.field(field, draft[key], 'draft');
      output.line(
        'Remove deletes only the saved key and can reveal inherited or dotenv values. Explicit empty values remain unchanged with Keep.'
      );
      const action = await prompts.select({
        message: secret ? 'Password action' : 'Field action',
        choices: choices(
          ['keep', 'Keep current'],
          [secret ? 'replace' : 'set', secret ? 'Replace' : 'Set value'],
          ['remove', secret ? 'Remove saved password' : 'Remove saved value']
        )
      });
      if (action === 'keep') return;
      const before = resolve();
      const oldDraft = clone(draft);
      if (action === 'remove') {
        if (
          secret &&
          !(await confirm('Remove saved password? Another source may become effective.'))
        )
          return;
        delete draft[key];
      } else if (secret) {
        const value = await prompts.password({
          message: 'New password (hidden, no length echo)',
          validate: value =>
            typeof value === 'string' && value.length > 0
              ? true
              : 'Use Remove to delete a saved password.'
        });
        if (typeof value !== 'string' || !value.length) return;
        draft[key] = value;
        output.addSecrets(draft);
      } else if (CONFIG_FIELDS[field].type === 'boolean') {
        draft[key] = await prompts.select({
          message: field,
          choices: choices(['true', 'true'], ['false', 'false'])
        });
      } else {
        const trim = ['SQL_SERVER_HOST', 'SQL_SERVER_DATABASE', 'SQL_SERVER_PORT'].includes(field);
        const accepted = await prompts.input({
          message:
            field === 'SQL_SERVER_MAX_RETRIES'
              ? 'Maximum connection attempts (SQL_SERVER_MAX_RETRIES)'
              : field,
          validate: value =>
            isValidValue(field, trim ? value.trim() : value)
              ? true
              : 'Use the documented type and range for this field.'
        });
        draft[key] = trim ? accepted.trim() : accepted;
      }
      const after = resolve();
      if (!(await acknowledge(assessSecurityChanges(before, after)))) {
        draft = oldDraft;
        return;
      }
      generation++;
      output.line('Draft updated. Validation results, if any, are stale.');
    }
    async function probe(resolved) {
      const probeController = new globalThis.AbortController(),
        ui = new globalThis.AbortController();
      const sessionAbort = () => {
        if (probeController.signal.aborted)
          probeController.signal.dispatchEvent(new globalThis.Event('abort'));
        else probeController.abort(signal.reason);
      };
      signal?.addEventListener('abort', sessionAbort);
      let promptFailure;
      const cancelPrompt = prompts
        .select({
          message: 'Validation running.',
          choices: choices(['cancel-probe', 'Cancel validation and return to editor']),
          signal: ui.signal
        })
        .then(
          action => {
            if (action === 'cancel-probe') probeController.abort('probe-cancel');
          },
          e => {
            if (!ui.signal.aborted) {
              promptFailure = e;
              probeController.abort('prompt-cancel');
            }
          }
        );
      try {
        const r = await validateImpl({ resolved, signal: probeController.signal });
        lastValidation = { generation, result: r };
        reportProbe(output, r);
      } finally {
        ui.abort();
        await cancelPrompt;
        signal?.removeEventListener('abort', sessionAbort);
      }
      if (promptFailure && !signal?.aborted && promptFailure.name !== 'AbortPromptError')
        throw promptFailure;
    }
    resolve(); // Register dotenv secret candidates before rendering any user-controlled field.
    output.line('Edit the saved configuration. Environment values are not copied into this draft.');
    if (process.platform === 'win32')
      output.line(
        'Windows: Node file modes do not guarantee a private DACL. Check your user-profile ACL.'
      );
    while (!signal?.aborted) {
      const action = await prompts.select({ message: 'Configuration', choices: MAIN });
      if (SECTIONS[action]) {
        while (!signal?.aborted) {
          const field = await prompts.select({
            message: MAIN.find(c => c.value === action).name,
            choices: [
              ...SECTIONS[action].map(k => ({ value: k, name: k })),
              { value: 'back', name: 'Back' }
            ]
          });
          if (field === 'back') break;
          if (SECTIONS[action].includes(field))
            try {
              await editField(field);
            } catch (e) {
              if (signal?.aborted || e?.name === 'ExitPromptError') throw e;
              output.error(e);
            }
        }
      } else if (action === 'review') {
        try {
          output.review(draft, resolve());
          output.checks(checkStoredConfig(draft));
          output.checks(checkEffectiveConfig(resolve()));
          if (lastValidation)
            output.line(
              `Last validation: ${generation === lastValidation.generation ? 'current draft (sources will be re-read before Save/Validate)' : 'stale'}.`
            );
        } catch (e) {
          output.error(e);
        }
      } else if (action === 'cancel') {
        if (!dirty() || (await confirm('Discard unsaved changes?'))) return 130;
      } else if (action === 'save' || action === 'validate') {
        try {
          const current = refresh();
          if (!current) continue;
          const { resolved, warnings } = current;
          output.review(draft, resolved);
          if (!(await acknowledge(warnings.map(w => w.code)))) continue;
          if (action === 'validate') {
            const unsupported = unsupportedStartupVariables(resolved.environment);
            if (unsupported.length) {
              output.line(
                'Validation requires a shell without these startup variables: ' +
                  unsupported.join(', ')
              );
              continue;
            }
            output.line(
              `Effective authentication: ${resolved.environment.SQL_SERVER_USER ? 'SQL authentication' : 'legacy NTLM branch'}; username source ${resolved.sources.SQL_SERVER_USER || 'absent'}, password source ${resolved.sources.SQL_SERVER_PASSWORD || 'absent'}.`
            );
            if (
              await confirm(
                'Connect to the displayed effective target and run SELECT 1? No file will be saved.'
              )
            )
              await probe(resolved);
          } else {
            output.line(
              'Saved passwords are plaintext in this permission-protected JSON file. You can supply credentials through the existing environment setup instead.'
            );
            output.line(
              'A hard crash can leave an owner-readable temporary file containing credentials; no backups are created.'
            );
            output.line('Save destination: ' + snapshot.path);
            if (!(await confirm('Save this configuration now?'))) continue;
            try {
              const saved = await saveConfigSnapshot(snapshot, draft, { signal });
              if (saved.committed) {
                output.line('Saved.');
                for (const code of saved.warningCodes)
                  output.line(MESSAGES[code] || 'Saved, but verification could not be completed.');
                return 0;
              }
            } catch (e) {
              output.error(e);
              if (e.code === 'conflict') {
                const choice = await prompts.select({
                  message: 'Reload changed configuration or keep editing?',
                  choices: choices(['reload', 'Reload'], ['back', 'Keep editing'])
                });
                if (choice === 'reload' && (await confirm('Discard draft changes and reload?'))) {
                  snapshot = await readConfigSnapshot(snapshot.path);
                  draft = clone(snapshot.values);
                  output.addSecrets(draft);
                  generation++;
                  lastValidation = undefined;
                }
              }
            }
          }
        } catch (e) {
          if (signal?.aborted || e?.name === 'ExitPromptError') throw e;
          output.error(e);
        }
      }
    }
    return abortCode(signal);
  } catch (e) {
    if (signal?.aborted || ['ExitPromptError', 'AbortPromptError'].includes(e?.name))
      return abortCode(signal);
    output.error(e);
    return 2;
  } finally {
    prompts?.dispose?.();
  }
}
