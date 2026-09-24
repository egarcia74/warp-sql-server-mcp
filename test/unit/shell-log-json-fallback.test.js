import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const scriptsDir = fileURLToPath(new URL('../../scripts/', import.meta.url));
const shellDescribe = process.platform === 'win32' ? describe.skip : describe;
const scripts = ['pretty-logs.sh', 'pretty-logs-detailed.sh', 'view-full-logs.sh'];
let fixtureDir;
let logFile;
let traceFile;

function executable(name, contents) {
  const file = path.join(fixtureDir, name);
  writeFileSync(file, `#!/bin/sh\n${contents}\n`);
  chmodSync(file, 0o755);
}

function runScript(name, parser, outcome) {
  const original = readFileSync(path.join(scriptsDir, name), 'utf8');
  let source = original.replace(/^LOG_FILE=.*$/m, 'LOG_FILE="$LOG_FIXTURE_PATH"');
  expect(source).not.toBe(original);

  if (parser === 'python3') {
    const withoutJq = source.replace(
      'command -v jq &> /dev/null',
      'command -v __missing_jq__ &> /dev/null'
    );
    expect(withoutJq).not.toBe(source);
    source = withoutJq;
  }

  const script = path.join(fixtureDir, name);
  writeFileSync(script, source);
  return spawnSync('bash', [script], {
    cwd: fixtureDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      LOG_FIXTURE_PATH: logFile,
      PARSER_OUTCOME: outcome,
      PATH: `${fixtureDir}${path.delimiter}${process.env.PATH}`,
      TRACE_FILE: traceFile
    },
    timeout: 15_000
  });
}

beforeEach(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 'shell-log-json-fallback-'));
  logFile = path.join(fixtureDir, 'mcp.log');
  traceFile = path.join(fixtureDir, 'parser-trace.txt');
  writeFileSync(
    logFile,
    String.raw`2026-09-24 00:00:00 MCP CLI: Sending notification: {\"message\":\"hello\"}` + '\n'
  );
  writeFileSync(traceFile, '');
  executable(
    'tail',
    'if [ "$1" = "-n" ]; then\n  for arg do :; done\n  /bin/cat "$arg"\nelse\n  /usr/bin/tail "$@"\nfi'
  );

  const parser = `input=$(/bin/cat)
printf '%s\\n' "$input" >> "$TRACE_FILE"
count=$(/usr/bin/wc -l < "$TRACE_FILE")
case "$PARSER_OUTCOME" in
  first) ;;
  second) [ "$count" -eq 1 ] && exit 1 ;;
  neither) exit 1 ;;
esac
printf 'formatted: %s\\n' "$input"`;
  executable('jq', parser);
  executable('python3', parser);
});

afterEach(() => {
  rmSync(fixtureDir, { recursive: true, force: true });
});

shellDescribe('MCP log JSON parser fallback', () => {
  it.each(scripts.flatMap(script => ['jq', 'python3'].map(parser => [script, parser])))(
    '%s uses %s once when the unescaped JSON formats successfully',
    (script, parser) => {
      const result = runScript(script, parser, 'first');
      const calls = readFileSync(traceFile, 'utf8').trim().split('\n');

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('MCP: Sending notification');
      expect(result.stdout).toContain('formatted: {"message":"hello"}');
      expect(result.stdout).not.toContain('JSON formatting skipped');
      expect(calls).toEqual(['{"message":"hello"}']);
    }
  );

  it.each(scripts.flatMap(script => ['jq', 'python3'].map(parser => [script, parser])))(
    '%s retries the original JSON with %s after the first failure',
    (script, parser) => {
      const result = runScript(script, parser, 'second');
      const calls = readFileSync(traceFile, 'utf8').trim().split('\n');

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain(`formatted: ${String.raw`{\"message\":\"hello\"}`}`);
      expect(result.stdout).not.toContain('JSON formatting skipped');
      expect(calls).toEqual(['{"message":"hello"}', String.raw`{\"message\":\"hello\"}`]);
    }
  );

  it.each(scripts.flatMap(script => ['jq', 'python3'].map(parser => [script, parser])))(
    '%s warns only after both %s attempts fail',
    (script, parser) => {
      const result = runScript(script, parser, 'neither');
      const calls = readFileSync(traceFile, 'utf8').trim().split('\n');

      expect(result.status).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('JSON formatting skipped (escaped): notifications message');
      expect(result.stdout).not.toContain('formatted:');
      expect(calls).toEqual(['{"message":"hello"}', String.raw`{\"message\":\"hello\"}`]);
    }
  );
});
