import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createManifest,
  verifyOrigin,
  verifyDownloaded
} from '../../scripts/ci/sonar-pr-artifact.mjs';

const sha = 'a'.repeat(40);
const digest = 'sha256:' + 'b'.repeat(64);
const report =
  'SF:index.js\nDA:1,1\nBRDA:1,0,0,1\nend_of_record\nSF:lib/a.js\nDA:1,1\nend_of_record\n';
const reportDigest = createHash('sha256').update(report).digest('hex');
const archiveHelper = resolve('scripts/ci/sonar-artifact-archive.py');
const manifestCli = resolve('scripts/ci/sonar-pr-artifact.mjs');
const roots = [];
const temp = () => {
  const root = mkdtempSync(join(tmpdir(), 'sonar-artifact-'));
  roots.push(root);
  return root;
};
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function validOrigin() {
  const association = {
    number: 1403,
    head: { repo: { id: 9 }, sha, ref: 'feature/coverage' },
    base: { repo: { id: 7 }, sha: 'c'.repeat(40), ref: 'main' }
  };
  const run = {
    id: 42,
    run_attempt: 2,
    workflow_id: 11,
    path: '.github/workflows/ci.yml',
    name: 'CI',
    event: 'pull_request',
    status: 'completed',
    conclusion: 'failure',
    repository: { id: 7 },
    head_repository: { id: 9 },
    head_sha: sha,
    head_branch: 'feature/coverage',
    pull_requests: [association]
  };
  return {
    repositoryId: 7,
    eventRun: globalThis.structuredClone(run),
    apiRun: globalThis.structuredClone(run),
    associatedPrs: [
      {
        association: globalThis.structuredClone(association),
        detail: {
          ...globalThis.structuredClone(association),
          state: 'open',
          merged: false,
          user: { login: 'contributor', type: 'User' }
        }
      }
    ],
    attemptJobs: [
      {
        id: 100,
        run_id: 42,
        run_attempt: 2,
        name: 'Test Coverage',
        head_sha: sha,
        status: 'completed',
        conclusion: 'success',
        started_at: '2026-10-03T01:00:00Z',
        completed_at: '2026-10-03T01:05:00Z'
      }
    ],
    artifacts: [
      {
        id: 12,
        name: 'sonar-coverage-42-2',
        expired: false,
        size_in_bytes: 500,
        digest,
        created_at: '2026-10-03T01:04:00Z',
        workflow_run: {
          id: 42,
          repository_id: 7,
          head_repository_id: 9,
          head_sha: sha,
          head_branch: 'feature/coverage'
        }
      }
    ]
  };
}

function oldAttemptArtifact() {
  const input = validOrigin();
  input.artifacts[0].name = 'sonar-coverage-42-1';
  return input;
}

function manifestInput() {
  return {
    runId: 42,
    runAttempt: 2,
    prNumber: 1403,
    headRepositoryId: 9,
    headSha: sha,
    baseRef: 'main',
    lcovSha256: reportDigest
  };
}

function downloaded() {
  return {
    expected: verifyOrigin(validOrigin()),
    manifest: createManifest(manifestInput()),
    entries: [
      { name: 'manifest.json', type: 'file', size: 400 },
      { name: 'lcov.info', type: 'file', size: Buffer.byteLength(report) }
    ],
    reportText: report,
    trackedFiles: new Set(['index.js', 'lib/a.js', 'cli.js'])
  };
}

describe('verifyOrigin', () => {
  it('binds a successful attempt even when an unrelated job failed', () => {
    expect(verifyOrigin(validOrigin())).toEqual({
      runId: 42,
      runAttempt: 2,
      prNumber: 1403,
      headRepositoryId: 9,
      headSha: sha,
      headRef: 'feature/coverage',
      baseRef: 'main',
      artifactName: 'sonar-coverage-42-2',
      artifactId: 12,
      archiveDigest: digest
    });
  });
  it('rejects old-attempt artifact', () =>
    expect(() => verifyOrigin(oldAttemptArtifact())).toThrow(/attempt/i));
  it('binds a commit-to-PR fallback association to current detail', () => {
    const input = validOrigin();
    input.apiRun.pull_requests = [];
    input.eventRun.pull_requests = [];
    expect(verifyOrigin(input)).toMatchObject({ prNumber: 1403, baseRef: 'main' });
  });
  it('accepts a non-main base proved by API association and detail', () => {
    const input = validOrigin();
    input.apiRun.pull_requests[0].base.ref = 'release/2';
    input.eventRun.pull_requests[0].base.ref = 'release/2';
    input.associatedPrs[0].association.base.ref = 'release/2';
    input.associatedPrs[0].detail.base.ref = 'release/2';
    expect(verifyOrigin(input)).toMatchObject({ baseRef: 'release/2' });
  });
  it.each([
    [
      'wrong workflow',
      x => {
        x.apiRun.path = '.github/workflows/evil.yml';
      }
    ],
    [
      'wrong workflow ID',
      x => {
        x.apiRun.workflow_id = 99;
      }
    ],
    [
      'wrong repository',
      x => {
        x.apiRun.repository.id = 99;
      }
    ],
    [
      'wrong source event',
      x => {
        x.apiRun.event = 'push';
      }
    ],
    [
      'incomplete run',
      x => {
        x.apiRun.status = 'in_progress';
      }
    ],
    [
      'wrong run',
      x => {
        x.apiRun.id = 99;
      }
    ],
    [
      'old event attempt',
      x => {
        x.eventRun.run_attempt = 1;
      }
    ],
    [
      'failed-jobs-only rerun without fresh coverage',
      x => {
        x.attemptJobs = [];
      }
    ],
    [
      'old coverage attempt',
      x => {
        x.attemptJobs[0].run_attempt = 1;
      }
    ],
    [
      'wrong coverage run',
      x => {
        x.attemptJobs[0].run_id = 99;
      }
    ],
    [
      'failed coverage job',
      x => {
        x.attemptJobs[0].conclusion = 'failure';
      }
    ],
    [
      'duplicate coverage job',
      x => {
        x.attemptJobs.push(x.attemptJobs[0]);
      }
    ],
    [
      'missing artifact',
      x => {
        x.artifacts = [];
      }
    ],
    [
      'duplicate artifact',
      x => {
        x.artifacts.push(x.artifacts[0]);
      }
    ],
    [
      'expired artifact',
      x => {
        x.artifacts[0].expired = true;
      }
    ],
    [
      'artifact from another run',
      x => {
        x.artifacts[0].workflow_run.id = 99;
      }
    ],
    [
      'artifact with wrong head repository',
      x => {
        x.artifacts[0].workflow_run.head_repository_id = 99;
      }
    ],
    [
      'artifact with wrong head SHA',
      x => {
        x.artifacts[0].workflow_run.head_sha = 'd'.repeat(40);
      }
    ],
    [
      'artifact uploaded before coverage job',
      x => {
        x.artifacts[0].created_at = '2026-10-02T01:04:00Z';
      }
    ],
    [
      'artifact uploaded after coverage job',
      x => {
        x.artifacts[0].created_at = '2026-10-03T01:06:00Z';
      }
    ],
    [
      'missing artifact timestamp',
      x => {
        delete x.artifacts[0].created_at;
      }
    ],
    [
      'absent archive digest',
      x => {
        delete x.artifacts[0].digest;
      }
    ],
    [
      'malformed archive digest',
      x => {
        x.artifacts[0].digest = 'sha256:bad';
      }
    ],
    [
      'oversized artifact',
      x => {
        x.artifacts[0].size_in_bytes = 10 * 1024 * 1024 + 1;
      }
    ],
    [
      'ambiguous PR',
      x => {
        x.associatedPrs.push(x.associatedPrs[0]);
      }
    ],
    [
      'ambiguous run association',
      x => {
        x.apiRun.pull_requests.push(x.apiRun.pull_requests[0]);
      }
    ],
    [
      'wrong associated PR',
      x => {
        x.associatedPrs[0].detail.number = 22;
      }
    ],
    [
      'mismatched head repository',
      x => {
        x.associatedPrs[0].detail.head.repo.id = 99;
      }
    ],
    [
      'mismatched base ref',
      x => {
        x.associatedPrs[0].detail.base.ref = 'release';
      }
    ],
    [
      'mismatched base repository',
      x => {
        x.associatedPrs[0].detail.base.repo.id = 99;
      }
    ],
    [
      'control-character head ref',
      x => {
        x.apiRun.head_branch += '\nforged=true';
      }
    ],
    [
      'control-character base ref',
      x => {
        x.associatedPrs[0].detail.base.ref += '\n';
      }
    ],
    [
      'invalid artifact ID',
      x => {
        x.artifacts[0].id = '12\nfoo';
      }
    ],
    [
      'invalid run ID',
      x => {
        x.apiRun.id = 0;
      }
    ]
  ])('rejects %s', (_label, mutate) => {
    const input = validOrigin();
    mutate(input);
    expect(() => verifyOrigin(input)).toThrow();
  });
  it('marks a head-changed fork superseded', () => {
    const input = validOrigin();
    input.associatedPrs[0].detail.head.sha = 'd'.repeat(40);
    expect(verifyOrigin(input)).toEqual({ superseded: true });
  });
  it('marks a closed fork superseded', () => {
    const input = validOrigin();
    input.associatedPrs[0].detail.state = 'closed';
    expect(verifyOrigin(input)).toEqual({ superseded: true });
  });
  it('returns only the API-verified merge SHA for merged Dependabot', () => {
    const input = validOrigin();
    Object.assign(input.associatedPrs[0].detail, {
      state: 'closed',
      merged: true,
      merge_commit_sha: 'e'.repeat(40),
      user: { login: 'dependabot[bot]', type: 'Bot' }
    });
    expect(verifyOrigin(input)).toEqual({ mergedDependabot: true, mergeSha: 'e'.repeat(40) });
  });
  it('rejects a malformed merged Dependabot SHA', () => {
    const input = validOrigin();
    Object.assign(input.associatedPrs[0].detail, {
      state: 'closed',
      merged: true,
      merge_commit_sha: 'bad',
      user: { login: 'dependabot[bot]', type: 'Bot' }
    });
    expect(() => verifyOrigin(input)).toThrow();
  });
  it('rejects ordinary same-repository PRs', () => {
    const input = validOrigin();
    input.repositoryId = 9;
    input.apiRun.repository.id = 9;
    input.eventRun.repository.id = 9;
    input.associatedPrs[0].detail.base.repo.id = 9;
    input.apiRun.pull_requests[0].base.repo.id = 9;
    expect(() => verifyOrigin(input)).toThrow();
  });
});

describe('manifest and downloaded report', () => {
  it('round-trips all provenance claims and LCOV digest', () => {
    expect(createManifest(manifestInput())).toEqual({ schemaVersion: 1, ...manifestInput() });
    expect(verifyDownloaded(downloaded())).toEqual({
      headSha: sha,
      prNumber: 1403,
      sha256: reportDigest
    });
  });
  it.each([
    'runId',
    'runAttempt',
    'prNumber',
    'headRepositoryId',
    'headSha',
    'baseRef',
    'lcovSha256',
    'schemaVersion'
  ])('rejects forged manifest field %s', field => {
    const input = downloaded();
    input.manifest[field] = 'forged';
    expect(() => verifyDownloaded(input)).toThrow();
  });
  it.each([
    [
      'extra file',
      x => {
        x.entries.push({ name: 'evil', type: 'file', size: 1 });
      }
    ],
    [
      'duplicate file',
      x => {
        x.entries[1] = x.entries[0];
      }
    ],
    [
      'symlink',
      x => {
        x.entries[0].type = 'symlink';
      }
    ],
    [
      'traversal',
      x => {
        x.entries[0].name = '../manifest.json';
      }
    ],
    [
      'oversized files',
      x => {
        x.entries[1].size = 10 * 1024 * 1024;
      }
    ],
    [
      'bad LCOV paths',
      x => {
        x.reportText = report.replace('lib/a.js', '../a.js');
      }
    ],
    [
      'tracked file outside measured set',
      x => {
        x.reportText = report + 'SF:cli.js\nDA:1,1\nend_of_record\n';
      }
    ],
    [
      'incorrect LCOV digest',
      x => {
        x.reportText = report.replace('DA:1,1', 'DA:1,0');
      }
    ]
  ])('rejects %s', (_label, mutate) => {
    const input = downloaded();
    mutate(input);
    expect(() => verifyDownloaded(input)).toThrow();
  });
  it.each(['main\noutput=bad', '-Dsonar.token=x', '../main', 'refs//main', 'bad name'])(
    'rejects unsafe manifest ref %s',
    baseRef => {
      expect(() => createManifest({ ...manifestInput(), baseRef })).toThrow();
    }
  );
  it('creates the two-file producer artifact through the CLI', () => {
    const root = temp();
    mkdirSync(join(root, 'coverage'));
    writeFileSync(join(root, 'coverage/lcov.info'), report);
    const eventPath = join(root, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({
        number: 1403,
        pull_request: {
          number: 1403,
          head: { repo: { id: 9 }, sha },
          base: { ref: 'main' }
        }
      })
    );
    const result = spawnSync(process.execPath, [manifestCli, 'create', 'coverage/lcov.info'], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_RUN_ID: '42',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_EVENT_PATH: eventPath
      }
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(root, 'coverage/manifest.json'), 'utf8'))).toEqual({
      schemaVersion: 1,
      ...manifestInput()
    });
  });
});

// Generate actual ZIP bytes independently with Python's standard library, including
// adversarial metadata; run the production inspector, then assert no output exists.
function runArchive(kind) {
  const root = temp();
  const output = join(root, 'out');
  mkdirSync(output);
  const python = `
import hashlib, importlib.util, io, json, pathlib, stat, struct, sys, urllib.error, zipfile
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('archive', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
kind = sys.argv[3]
buffer = io.BytesIO()
with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.writestr('lcov.info' if kind == 'duplicate' else 'manifest.json', '{}')
    info = zipfile.ZipInfo('../lcov.info' if kind == 'traversal' else 'lcov.info')
    info.create_system = 3
    info.external_attr = (stat.S_IFLNK | 0o777 if kind == 'symlink' else stat.S_IFREG | 0o600) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    archive.writestr(info, 'x' * (10 * 1024 * 1024 + 1) if kind == 'bomb' else 'report')
    if kind == 'extra': archive.writestr('extra', 'bad')
raw = buffer.getvalue()
if kind == 'false-size':
    raw = bytearray(raw)
    central = raw.index(b'PK\\x01\\x02', raw.index(b'PK\\x01\\x02') + 4)
    struct.pack_into('<I', raw, central + 24, 2)
    raw = bytes(raw)
if kind == 'bad-crc':
    raw = bytearray(raw)
    central = raw.index(b'PK\\x01\\x02', raw.index(b'PK\\x01\\x02') + 4)
    struct.pack_into('<I', raw, central + 16, 0)
    raw = bytes(raw)
if kind == 'raw-oversize': raw += b'x' * (10 * 1024 * 1024)
digest = 'sha256:' + hashlib.sha256(raw).hexdigest()
if kind == 'digest-mismatch': digest = 'sha256:' + '0' * 64
if kind == 'nonempty': pathlib.Path(sys.argv[2], 'existing').write_text('keep')
try:
    if kind.startswith('download-'):
        class Response(io.BytesIO):
            status = 200
        class Opener:
            calls = 0
            def open(self, request, timeout):
                self.calls += 1
                if self.calls == 1:
                    assert request.full_url == 'https://api.github.com/repos/owner/repo/actions/artifacts/12/zip'
                    assert request.get_header('Authorization') == 'Bearer secret'
                    location = 'http://storage.example/archive' if kind == 'download-http' else 'https://storage.example/archive'
                    raise urllib.error.HTTPError(request.full_url, 302, 'redirect', {'Location': location}, None)
                assert self.calls == 2
                assert request.full_url == 'https://storage.example/archive'
                assert request.get_header('Authorization') is None
                return Response(raw)
        opener = Opener()
        module.urllib.request.build_opener = lambda *args: opener
        result = module.download_artifact('owner/repo', 12, digest, pathlib.Path(sys.argv[2]), 'secret')
    else:
        result = module.extract_archive(raw, digest, pathlib.Path(sys.argv[2]))
    print(json.dumps(result))
except Exception as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;
  return {
    output,
    result: spawnSync('python3', ['-c', python, archiveHelper, output, kind], { encoding: 'utf8' })
  };
}

describe('bounded artifact ZIP extraction', () => {
  it('extracts only two verified regular files', () => {
    const { output, result } = runArchive('valid');
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(output).sort()).toEqual(['lcov.info', 'manifest.json']);
    expect(readFileSync(join(output, 'lcov.info'), 'utf8')).toBe('report');
    expect(JSON.parse(result.stdout)).toEqual([
      { name: 'manifest.json', type: 'file', size: 2 },
      { name: 'lcov.info', type: 'file', size: 6 }
    ]);
  });
  it.each([
    'digest-mismatch',
    'raw-oversize',
    'bomb',
    'duplicate',
    'traversal',
    'symlink',
    'extra',
    'false-size',
    'bad-crc',
    'download-http'
  ])('rejects %s before extraction', kind => {
    const { output, result } = runArchive(kind);
    expect(result.status).toBe(1);
    expect(result.stderr).not.toMatch(/FileNotFoundError|AttributeError|ModuleNotFoundError/);
    if (kind === 'raw-oversize') expect(result.stderr).toMatch(/Raw artifact exceeds/);
    if (kind === 'duplicate') expect(result.stderr).toMatch(/duplicate ZIP entry/);
    expect(readdirSync(output)).toEqual([]);
  });
  it('downloads the artifact ID and strips authorization on the storage request', () => {
    const { output, result } = runArchive('download-valid');
    expect(result.status, result.stderr).toBe(0);
    expect(readdirSync(output).sort()).toEqual(['lcov.info', 'manifest.json']);
  });
  it('refuses a nonempty output directory', () => {
    const { output, result } = runArchive('nonempty');
    expect(result.status).toBe(1);
    expect(readdirSync(output)).toEqual(['existing']);
    expect(readFileSync(join(output, 'existing'), 'utf8')).toBe('keep');
  });
});
