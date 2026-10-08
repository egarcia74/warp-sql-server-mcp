import { afterEach, describe, expect, test, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';
import winston from 'winston';
import { Logger } from '../../lib/utils/logger.js';

const loggerUrl = new URL('../../lib/utils/logger.js', import.meta.url).href;
const savedNodeEnv = process.env.NODE_ENV;
const savedTestLogging = process.env.ENABLE_TEST_LOGGING;

afterEach(() => {
  if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = savedNodeEnv;
  if (savedTestLogging === undefined) delete process.env.ENABLE_TEST_LOGGING;
  else process.env.ENABLE_TEST_LOGGING = savedTestLogging;
  vi.restoreAllMocks();
});

function captureFormatters() {
  const callbacks = [];
  const originalPrintf = winston.format.printf;
  vi.spyOn(winston.format, 'printf').mockImplementation(callback => {
    callbacks.push(callback);
    return originalPrintf(callback);
  });
  process.env.NODE_ENV = 'development';
  process.env.ENABLE_TEST_LOGGING = 'true';
  const logger = new Logger({ enableSecurityAudit: true });
  logger.logger.close();
  logger.securityLogger.close();
  return callbacks;
}

function runLogger(script, options = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env, NODE_ENV: options.nodeEnv || 'development' }
  });
}

describe('rendered Winston logger output', () => {
  test('ordinary development messages preserve layout, metadata, and escaped newlines', () => {
    const [main] = captureFormatters();
    expect(
      main({ level: 'info', timestamp: '2026-10-08T00:00:00Z', message: 'ready', id: 7 })
    ).toBe('2026-10-08T00:00:00Z [info] ready {"id":7}');
    expect(main({ level: 'info', timestamp: 'time', message: String.raw`first\nsecond` })).toBe(
      'time [info] first\nsecond'
    );
  });

  test('development messages and timestamps mark object values without exposing fields', () => {
    const [main] = captureFormatters();
    const rendered = main({
      level: 'warn',
      timestamp: { token: 'sensitive-timestamp' },
      message: { password: 'sensitive-message' }
    });
    expect(rendered).toBe('<object value omitted> [warn] <object value omitted>');
    expect(rendered).not.toContain('sensitive-timestamp');
    expect(rendered).not.toContain('sensitive-message');
    expect(rendered).not.toContain('[object Object]');
  });

  test('configuration layout keeps its summary and masks an object message', () => {
    const [main] = captureFormatters();
    const rendered = main({
      level: 'info',
      timestamp: 'time',
      message: { password: 'sensitive-config' },
      configuration: '=== banner ===\n🌐 Server:\n    Database: demo',
      summary: { server: 'db', database: 'demo', authType: 'sql' }
    });
    expect(rendered).toContain('db/demo (sql)');
    expect(rendered).toContain('Database:');
    expect(rendered).toContain('<object value omitted>');
    expect(rendered).not.toContain('sensitive-config');
    expect(rendered).not.toContain('[object Object]');
  });

  function expectOmittedSecurityValues(formatter) {
    const rendered = formatter({
      timestamp: { token: 'sensitive-audit-time' },
      message: { password: 'sensitive-audit-message' },
      event: 'QUERY_BLOCKED'
    });
    expect(rendered).toContain('[SECURITY]');
    expect(rendered).toContain('<object value omitted>');
    expect(rendered).not.toContain('sensitive-audit-time');
    expect(rendered).not.toContain('sensitive-audit-message');
    expect(rendered).toContain('"event":"QUERY_BLOCKED"');
    expect(rendered).not.toContain('[object Object]');
  }

  test('security console formatter marks object values without exposing fields', () => {
    const [, consoleFormatter] = captureFormatters();
    expectOmittedSecurityValues(consoleFormatter);
  });

  test('security base formatter marks object values without exposing fields', () => {
    const [, , baseFormatter] = captureFormatters();
    expectOmittedSecurityValues(baseFormatter);
  });

  test('real development Winston output keeps SQL audit on stderr and masks connection secrets', () => {
    const script = `
      import { Logger } from ${JSON.stringify(loggerUrl)};
      const logger = new Logger({ enableSecurityAudit: true });
      logger.info('First\\nsecond');
      logger.info({ password: 'sensitive-main' });
      logger.info({ password: 'sensitive-config' }, {
        configuration: '=== banner ===\\n🌐 Server:\\n    Database: demo',
        summary: { server: 'db', database: 'demo', authType: 'sql' }
      });
      logger.logConnection('CONNECTION_SUCCESS', {
        host: 'db', database: 'demo', password: 'hidden-password', connectionString: 'hidden-connection'
      });
      logger.logQueryExecution('execute_query', 'SELECT 1', { database: 'demo' }, { success: true });
      logger.security('QUERY_BLOCKED', 'Query blocked', { query: 'SELECT 1' });
      logger.security('QUERY_BLOCKED', { password: 'sensitive-audit' });
      logger.security('CONNECTION_FAILED', { password: 'sensitive-high' });
      logger.security('QUERY_BLOCKED', 'Query blocked', { message: { password: 'sensitive-override' } });
      await logger.flush();
    `;
    const result = runLogger(script);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('[info] First\nsecond');
    expect(result.stderr).toContain('SELECT 1');
    expect(result.stderr).toContain('[SECURITY]');
    expect(result.stderr).toContain('<object value omitted>');
    for (const secret of [
      'sensitive-main',
      'sensitive-config',
      'sensitive-audit',
      'sensitive-high',
      'sensitive-override'
    ]) {
      expect(result.stderr).not.toContain(secret);
    }
    expect(result.stderr).not.toContain('[object Object]');
    expect(result.stderr).not.toContain('hidden-password');
    expect(result.stderr).not.toContain('hidden-connection');
  });

  test('production main console is JSON while security console is text and audit file is JSON', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'wssm-logger-format-'));
    try {
      const mainFile = path.join(directory, 'main.log');
      const auditFile = path.join(directory, 'audit.log');
      const script = `
        import { Logger } from ${JSON.stringify(loggerUrl)};
        const logger = new Logger({
          enableSecurityAudit: true,
          logFile: ${JSON.stringify(mainFile)},
          securityLogFile: ${JSON.stringify(auditFile)}
        });
        logger.info('Ready');
        logger.security('QUERY_BLOCKED', 'Query blocked', { query: 'SELECT 1' });
        await logger.flush();
      `;
      const result = runLogger(script, { nodeEnv: 'production' });
      expect(result.status).toBe(0);
      expect(result.stdout).toBe('');
      const consoleLines = result.stderr.trim().split('\n');
      expect(JSON.parse(consoleLines[0]).message).toBe('Ready');
      expect(consoleLines[1]).toContain('[SECURITY]');
      expect(consoleLines[1]).toContain('Query blocked');
      expect(JSON.parse(readFileSync(mainFile, 'utf8').trim()).message).toBe('Ready');
      expect(JSON.parse(readFileSync(auditFile, 'utf8').trim()).event).toBe('QUERY_BLOCKED');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
