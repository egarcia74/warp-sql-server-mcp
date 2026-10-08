import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const reportPath = 'coverage/lcov.info';
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const cliPath = fileURLToPath(new URL('../../cli.js', import.meta.url));

try {
  if (process.argv.length > 2) throw new Error('report path arguments are not supported');
  const report = readFileSync(reportPath, 'utf8');
  let hasSource = false;
  let hasData = false;
  let hasAnyData = false;
  let hasZeroLineTotal = false;
  let pendingTitle = false;
  let completeRecords = 0;
  let cliRecords = 0;
  let isRootCli = false;
  let cliLineTotal;
  let cliHitTotal;
  let cliLines = new Map();

  for (const line of report.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === 'end_of_record') {
      if (!hasSource || (!hasData && !hasZeroLineTotal))
        throw new Error('incomplete coverage record');
      if (isRootCli) {
        cliRecords++;
        if (cliRecords !== 1) throw new Error('duplicate root CLI coverage record');
        if (
          cliLineTotal === undefined ||
          cliHitTotal === undefined ||
          cliLineTotal === 0 ||
          cliLines.size !== cliLineTotal ||
          [...cliLines.values()].filter(hits => hits > 0).length !== cliHitTotal
        ) {
          throw new Error('incomplete or inconsistent root CLI line coverage');
        }
        if (10 * cliHitTotal < 7 * cliLineTotal)
          throw new Error('root CLI line coverage is below 70%');
      }
      completeRecords++;
      hasSource = false;
      hasData = false;
      hasZeroLineTotal = false;
      isRootCli = false;
      cliLineTotal = undefined;
      cliHitTotal = undefined;
      cliLines = new Map();
    } else if (line.startsWith('TN:') && !hasSource) {
      pendingTitle = true;
    } else if (line.startsWith('SF:') && !hasSource && line.length > 3) {
      hasSource = true;
      pendingTitle = false;
      isRootCli = resolve(repositoryRoot, line.slice(3)) === cliPath;
    } else if (/^DA:[1-9]\d*,\d+(?:,[^\r\n,]+)?$/.test(line) && hasSource) {
      hasData = true;
      hasAnyData = true;
      if (isRootCli) {
        const [lineNumber, hits] = line.slice(3).split(',').map(Number);
        if (cliLines.has(lineNumber)) throw new Error('duplicate root CLI line data');
        cliLines.set(lineNumber, hits);
      }
    } else if (/^(?:FNF|FNH|LF|LH|BRF|BRH):\d+$/.test(line) && hasSource) {
      // File totals are non-negative integer counts.
      if (line === 'LF:0') hasZeroLineTotal = true;
      if (isRootCli && line.startsWith('LF:')) {
        if (cliLineTotal !== undefined) throw new Error('duplicate root CLI line total');
        cliLineTotal = Number(line.slice(3));
      }
      if (isRootCli && line.startsWith('LH:')) {
        if (cliHitTotal !== undefined) throw new Error('duplicate root CLI hit total');
        cliHitTotal = Number(line.slice(3));
      }
    } else if (/^(?:FN|FNDA|BRDA):/.test(line) && hasSource) {
      // Function and branch details are left for Codecov to parse.
    } else {
      throw new Error('malformed coverage record');
    }
  }
  if (hasSource || pendingTitle || completeRecords === 0 || !hasAnyData)
    throw new Error('incomplete coverage record');
  if (cliRecords !== 1) throw new Error('root CLI coverage record is missing');
  console.log(`LCOV report verified: ${reportPath}`);
} catch (error) {
  console.error(`LCOV report missing or invalid at ${reportPath}: ${error.message}`);
  process.exitCode = 1;
}
