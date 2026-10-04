import { readFileSync } from 'node:fs';

const reportPath = 'coverage/lcov.info';

try {
  if (process.argv.length > 2) throw new Error('report path arguments are not supported');
  const report = readFileSync(reportPath, 'utf8');
  let hasSource = false;
  let hasData = false;
  let hasAnyData = false;
  let hasZeroLineTotal = false;
  let pendingTitle = false;
  let completeRecords = 0;

  for (const line of report.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === 'end_of_record') {
      if (!hasSource || (!hasData && !hasZeroLineTotal))
        throw new Error('incomplete coverage record');
      completeRecords++;
      hasSource = false;
      hasData = false;
      hasZeroLineTotal = false;
    } else if (line.startsWith('TN:') && !hasSource) {
      pendingTitle = true;
    } else if (line.startsWith('SF:') && !hasSource && line.length > 3) {
      hasSource = true;
      pendingTitle = false;
    } else if (/^DA:[1-9]\d*,\d+(?:,[^\r\n,]+)?$/.test(line) && hasSource) {
      hasData = true;
      hasAnyData = true;
    } else if (/^(?:FNF|FNH|LF|LH|BRF|BRH):\d+$/.test(line) && hasSource) {
      // File totals are non-negative integer counts.
      if (line === 'LF:0') hasZeroLineTotal = true;
    } else if (/^(?:FN|FNDA|BRDA):/.test(line) && hasSource) {
      // Function and branch details are left for Codecov to parse.
    } else {
      throw new Error('malformed coverage record');
    }
  }
  if (hasSource || pendingTitle || completeRecords === 0 || !hasAnyData)
    throw new Error('incomplete coverage record');
  console.log(`LCOV report verified: ${reportPath}`);
} catch (error) {
  console.error(`LCOV report missing or invalid at ${reportPath}: ${error.message}`);
  process.exitCode = 1;
}
