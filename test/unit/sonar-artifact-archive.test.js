import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

const script = fileURLToPath(
  new URL('../../scripts/ci/sonar-artifact-archive.py', import.meta.url)
);
const temporaryDirectories = [];
const manifest = '{"version":1}';
const report = 'SF:index.js\nDA:1,1\nend_of_record\n';

function makeArchive(entries) {
  const directory = mkdtempSync(join(tmpdir(), 'wssm-sonar-zip-'));
  temporaryDirectories.push(directory);
  const archive = join(directory, 'artifact.zip');
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json, stat, sys, zipfile
archive, entries = sys.argv[1], json.loads(sys.argv[2])
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as target:
    for entry in entries:
        info = zipfile.ZipInfo(entry['name'])
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = ((stat.S_IFLNK if entry.get('symlink') else stat.S_IFREG) | 0o644) << 16
        target.writestr(info, 'x' * entry['repeatBytes'] if 'repeatBytes' in entry else entry['data'])`,
      archive,
      JSON.stringify(entries)
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return { archive, directory };
}

function extract(entries, expectedDigest) {
  const { archive, directory } = makeArchive(entries);
  const destination = join(directory, 'extracted');
  const digest = expectedDigest ?? createHash('sha256').update(readFileSync(archive)).digest('hex');
  const harness = `import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('sonar_archive', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.extract_archive(pathlib.Path(sys.argv[2]).read_bytes(), sys.argv[3], sys.argv[4])`;
  const result = spawnSync('python3', ['-B', '-c', harness, script, archive, digest, destination], {
    encoding: 'utf8'
  });
  return { ...result, destination };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true });
});

describe('bounded Sonar artifact archive extraction', () => {
  const validEntries = [
    { name: 'manifest.json', data: manifest },
    { name: 'lcov.info', data: report }
  ];

  it('exposes no command-line mode for opening an arbitrary archive path', () => {
    const result = spawnSync(
      'python3',
      [script, 'extract', '/tmp/other.zip', '0'.repeat(64), '/tmp/output'],
      {
        encoding: 'utf8'
      }
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/usage/i);
  });

  it('extracts only the expected two regular files after digest verification', () => {
    const result = extract(validEntries);
    expect(result.status).toBe(0);
    expect(readdirSync(result.destination).sort()).toEqual(['lcov.info', 'manifest.json']);
    expect(readFileSync(join(result.destination, 'lcov.info'), 'utf8')).toBe(report);
  });

  it.each([
    ['bad archive digest', validEntries, '0'.repeat(64)],
    ['extra entry', [...validEntries, { name: 'secret.txt', data: 'bad' }]],
    ['duplicate entry', [...validEntries, { name: 'lcov.info', data: 'bad' }]],
    ['traversal entry', [{ name: '../manifest.json', data: manifest }, validEntries[1]]],
    ['symlink entry', [validEntries[0], { name: 'lcov.info', data: report, symlink: true }]],
    [
      'uncompressed bomb',
      [validEntries[0], { name: 'lcov.info', repeatBytes: 10 * 1024 * 1024 + 1 }]
    ]
  ])('rejects %s before extraction', (_name, entries, expectedDigest) => {
    const result = extract(entries, expectedDigest);
    expect(result.status).not.toBe(0);
    expect(() => readdirSync(result.destination)).toThrow();
  });
});
