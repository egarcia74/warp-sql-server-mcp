import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'coverage/lcov.info';

try {
  const report = readFileSync(reportPath, 'utf8');
  let hasSource = false;
  let hasData = false;
  let pendingTitle = false;
  let completeRecords = 0;

  for (const line of report.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line === 'end_of_record') {
      if (!hasSource || !hasData) throw new Error('incomplete coverage record');
      completeRecords++;
      hasSource = false;
      hasData = false;
    } else if (line.startsWith('TN:') && !hasSource) {
      pendingTitle = true;
    } else if (line.startsWith('SF:') && !hasSource && line.length > 3) {
      hasSource = true;
      pendingTitle = false;
    } else if (/^DA:\d+,\d+(?:,[^\r\n,]+)?$/.test(line) && hasSource) {
      hasData = true;
    } else if (/^(?:FN|FNDA|FNF|FNH|LF|LH|BRDA|BRF|BRH):/.test(line) && hasSource) {
      // Other standard LCOV fields are left for Codecov to parse.
    } else {
      throw new Error('malformed coverage record');
    }
  }
  if (hasSource || pendingTitle || completeRecords === 0)
    throw new Error('incomplete coverage record');
  console.log(`LCOV report verified: ${reportPath}`);
} catch (error) {
  console.error(`LCOV report missing or invalid at ${reportPath}: ${error.message}`);
  process.exitCode = 1;
}
